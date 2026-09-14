import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import * as vscode from 'vscode';
import { CommandExecution, CommandExecutionMode, SqlColumnMetadata, determineOutcome, mapCommandMessages } from './commandEntryModel';
import { getUDTFLibrary } from './components/hostFunctions';
import { CommandEntryJobManager, RunSQLWithDetailsResult, SqlContinuationTuple } from './commandEntryJobManager';
import { detectCommandEntryPrefix } from './commandEntryPrefixes';
import { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId } from './commandEntrySqlHelpers';
import { getConnectionSqlSettings } from './commandEntrySqlSettings';
import { checkSQLBeforePaging, checkSQLForExecution } from './sqlSyntaxChecker';

export { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId };

const DEFAULT_SQL_RESULT_ROWS = 1000;
const DEDICATED_SQL_PAGE_SIZE = 200;
const NOMAX_SENTINEL = Number.MAX_SAFE_INTEGER;
const SCROLL_PREFETCH_ROWS = 200;
const LOAD_ALL_MAX_ITERATIONS = 10000;
const DISABLE_OFFSET_FALLBACK_ENV = 'CLPROMPTER_DEBUG_DISABLE_OFFSET_FALLBACK';

interface SqlPagingSession {
    id: string;
    connectionKey: string;
    statement: string;
    resultTitle?: string;
    rows: Record<string, unknown>[];
    columnMetadata?: SqlColumnMetadata[];
    columns: string[];
    nextOffset: number;
    fetchSize: number;
    prefetchSize: number;
    pagingMode: 'continuation' | 'offset';
    continuation?: SqlContinuationTuple;
    continuationRawResult?: unknown;
    hasMoreRows: boolean;
    createdAt: number;
    lastUsedAt: number;
}

interface OffsetFallbackDebugPolicy {
    disabled: boolean;
    configValue?: boolean;
    envRaw: string;
}

function buildCmdRunSql(library: string): string {
    return `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(${library}.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;
}

function extractSqlStatement(command: string): string | undefined {
    const text = String(command ?? '');

    const explicitPrefix = detectCommandEntryPrefix(text);

    // Explicit CL mode takes precedence over implicit SQL detection.
    if (explicitPrefix === 'CL') {
        return undefined;
    }

    // Explicit SQL mode remains the primary path.
    const match = text.match(/^\s*sql\s*:\s*([\s\S]*)$/i);
    if (match) {
        const statement = (match[1] || '').trim();
        return statement || undefined;
    }

    // Smart fallback: if SQL prefix is omitted, treat SELECT/VALUES/WITH as SQL.
    const trimmed = text.trim();
    if (/^(SELECT|VALUES|WITH)\b/i.test(trimmed)) {
        return trimmed;
    }

    return undefined;
}

function toIsoTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').replace('Z', '');
}

function deriveSqlColumns(rows: Record<string, unknown>[]): string[] {
    if (rows.length === 0) { return []; }
    const seen = new Set<string>();
    const columns: string[] = [];
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            if (!seen.has(key)) {
                seen.add(key);
                columns.push(key);
            }
        }
    }
    return columns;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function hasUsefulColumnMetadata(metadata: SqlColumnMetadata[] | undefined): boolean {
    if (!metadata || metadata.length === 0) {
        return false;
    }

    return metadata.some((entry) => {
        const name = (entry.name || '').trim().toUpperCase();
        const label = (entry.label || '').trim().toUpperCase();
        const typeName = (entry.typeName || '').trim();
        const hasDisplaySize = typeof entry.displaySize === 'number' && entry.displaySize > 0;
        return typeName.length > 0 || hasDisplaySize || (label.length > 0 && label !== name);
    });
}

function normalizeColumnKey(value: string | undefined): string {
    return (value ?? '').trim().toUpperCase();
}

function toOptionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        const parsed = Number(trimmed);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    return undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'number') {
        if (value === 1) { return true; }
        if (value === 0) { return false; }
        return undefined;
    }

    if (typeof value === 'string') {
        const normalized = value.trim().toUpperCase();
        if (!normalized) {
            return undefined;
        }
        if (normalized === 'Y' || normalized === 'YES' || normalized === 'TRUE' || normalized === '1') {
            return true;
        }
        if (normalized === 'N' || normalized === 'NO' || normalized === 'FALSE' || normalized === '0') {
            return false;
        }
    }

    return undefined;
}

function mergeColumnMetadata(
    columns: string[],
    primary: SqlColumnMetadata[] | undefined,
    fallback: SqlColumnMetadata[] | undefined
): SqlColumnMetadata[] {
    const primaryByName = new Map((primary ?? []).map((entry) => [normalizeColumnKey(entry.name), entry]));
    const fallbackByName = new Map((fallback ?? []).map((entry) => [normalizeColumnKey(entry.name), entry]));

    return columns.map((column, index) => {
        const primaryEntry = primaryByName.get(normalizeColumnKey(column)) ?? primary?.[index];
        const fallbackEntry = fallbackByName.get(normalizeColumnKey(column)) ?? fallback?.[index];

        const merged: SqlColumnMetadata = {
            name: column,
            label: primaryEntry?.label && primaryEntry.label.trim().length > 0
                ? primaryEntry.label
                : fallbackEntry?.label,
            typeName: primaryEntry?.typeName && primaryEntry.typeName.trim().length > 0
                ? primaryEntry.typeName
                : fallbackEntry?.typeName,
            displaySize: typeof primaryEntry?.displaySize === 'number'
                ? primaryEntry.displaySize
                : fallbackEntry?.displaySize,
            scale: typeof primaryEntry?.scale === 'number'
                ? primaryEntry.scale
                : fallbackEntry?.scale,
            textDescription: primaryEntry?.textDescription && primaryEntry.textDescription.trim().length > 0
                ? primaryEntry.textDescription
                : fallbackEntry?.textDescription,
            ddsType: primaryEntry?.ddsType && primaryEntry.ddsType.trim().length > 0
                ? primaryEntry.ddsType
                : fallbackEntry?.ddsType,
            isIdentity: typeof primaryEntry?.isIdentity === 'boolean'
                ? primaryEntry.isIdentity
                : fallbackEntry?.isIdentity,
            schema: primaryEntry?.schema || fallbackEntry?.schema,
            table: primaryEntry?.table || fallbackEntry?.table
        };

        if (!merged.label || merged.label.trim().length === 0) {
            merged.label = column;
        }

        return merged;
    });
}

function extractSqlColumnMetadata(raw: unknown, fallbackNames: string[]): SqlColumnMetadata[] {
    const collectMetadataEntries = (value: unknown): unknown[] => {
        if (Array.isArray(value)) {
            return value;
        }

        if (!value || typeof value !== 'object') {
            return [];
        }

        const candidate = value as Record<string, unknown>;
        const entries: unknown[] = [];

        const push = (...items: unknown[]) => {
            for (const item of items) {
                if (Array.isArray(item)) {
                    entries.push(...item);
                }
            }
        };

        push(candidate.columns, candidate.columnMetadata, candidate.metadata, candidate.fields, candidate.result);

        const nestedMetadata = candidate.metadata && typeof candidate.metadata === 'object' && !Array.isArray(candidate.metadata)
            ? candidate.metadata as Record<string, unknown>
            : undefined;

        if (nestedMetadata) {
            push(nestedMetadata.columns, nestedMetadata.columnMetadata, nestedMetadata.fields, nestedMetadata.metadata);
        }

        return entries;
    };

    const metadata = collectMetadataEntries(raw);

    if (!Array.isArray(metadata) || metadata.length === 0) {
        return fallbackNames.map(name => ({ name, label: name }));
    }

    return metadata.map((entry, index) => {
        const candidate = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
        const rawName = String(
            candidate.name ?? candidate.COLUMN_NAME ?? candidate.columnName ?? candidate.column_name ?? candidate.NAME ?? fallbackNames[index] ?? ''
        ).trim();
        const rawLabel = String(
            candidate.label ?? candidate.COLUMN_LABEL ?? candidate.columnLabel ?? candidate.column_label ?? candidate.LABEL ?? candidate.heading ?? candidate.HEADING ?? ''
        ).trim();

        const displaySize = toOptionalNumber(candidate.displaySize)
            ?? toOptionalNumber(candidate.DISPLAY_SIZE)
            ?? toOptionalNumber(candidate.columnSize)
            ?? toOptionalNumber(candidate.COLUMN_SIZE)
            ?? toOptionalNumber(candidate.precision)
            ?? toOptionalNumber(candidate.PRECISION)
            ?? toOptionalNumber(candidate.length)
            ?? toOptionalNumber(candidate.LENGTH);

        const typeName = candidate.typeName
            ?? candidate.TYPE_NAME
            ?? candidate.DATA_TYPE
            ?? candidate.dataType
            ?? candidate.data_type
            ?? candidate.sqlType
            ?? candidate.SQL_TYPE
            ?? candidate.sql_type
            ?? candidate.nativeType
            ?? candidate.NATIVE_TYPE
            ?? candidate.dbType
            ?? candidate.DB_TYPE
            ?? candidate.type
            ?? candidate.TYPE
            ?? candidate.typename
            ?? candidate.TYPE_NAME_LONG;

        return {
            name: rawName || fallbackNames[index] || `COLUMN_${index + 1}`,
            label: rawLabel || rawName || fallbackNames[index] || undefined,
            typeName: typeName != null ? String(typeName) : undefined,
            displaySize,
            scale: toOptionalNumber(candidate.scale)
                ?? toOptionalNumber(candidate.SCALE)
                ?? toOptionalNumber(candidate.numericScale)
                ?? toOptionalNumber(candidate.NUMERIC_SCALE)
                ?? toOptionalNumber(candidate.decimalDigits)
                ?? toOptionalNumber(candidate.DECIMAL_DIGITS),
            textDescription: candidate.textDescription
                ? String(candidate.textDescription)
                : candidate.COLUMN_TEXT
                    ? String(candidate.COLUMN_TEXT)
                    : candidate.column_text
                        ? String(candidate.column_text)
                        : undefined,
            ddsType: candidate.ddsType
                ? String(candidate.ddsType)
                : candidate.DDS_TYPE
                    ? String(candidate.DDS_TYPE)
                    : candidate.dds_type
                        ? String(candidate.dds_type)
                        : undefined,
            isIdentity: toOptionalBoolean(candidate.isIdentity)
                ?? toOptionalBoolean(candidate.IS_IDENTITY)
                ?? toOptionalBoolean(candidate.is_identity),
            schema: typeof candidate.schema === 'string' ? candidate.schema : undefined,
            table: typeof candidate.table === 'string' ? candidate.table : undefined
        };
    }).map((entry, index) => ({
        ...entry,
        name: entry.name || fallbackNames[index] || `COLUMN_${index + 1}`,
        label: entry.label || entry.name || fallbackNames[index] || undefined
    }));
}

function inferTypeNameFromValue(value: unknown): { typeName: string } {
    if (value === null || value === undefined) {
        return { typeName: 'UNKNOWN' };
    }

    if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return { typeName: 'INTEGER' };
        }
        return { typeName: 'DECIMAL' };
    }

    if (typeof value === 'boolean') {
        return { typeName: 'BOOLEAN' };
    }

    if (value instanceof Date) {
        return { typeName: 'TIMESTAMP' };
    }

    const text = String(value).trim();
    if (!text) {
        return { typeName: 'VARCHAR' };
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        return { typeName: 'DATE' };
    }
    if (/^\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) {
        return { typeName: 'TIME' };
    }
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text)) {
        return { typeName: 'TIMESTAMP' };
    }

    return { typeName: 'VARCHAR' };
}

function inferMetadataFromRows(columns: string[], rows: Record<string, unknown>[]): SqlColumnMetadata[] {
    return columns.map((column) => {
        let inferred: { typeName: string } = { typeName: 'UNKNOWN' };
        for (const row of rows) {
            const value = row[column];
            if (value === null || value === undefined || String(value).trim() === '') {
                continue;
            }
            inferred = inferTypeNameFromValue(value);
            break;
        }

        return {
            name: column,
            label: column,
            typeName: inferred.typeName
        };
    });
}

function enrichMetadataWithInferredTypes(columns: string[], metadata: SqlColumnMetadata[] | undefined, rows: Record<string, unknown>[]): SqlColumnMetadata[] {
    const inferredByName = new Map(inferMetadataFromRows(columns, rows).map(entry => [normalizeColumnKey(entry.name), entry]));

    return columns.map((column, index) => {
        const existing = metadata?.find(entry => normalizeColumnKey(entry.name) === normalizeColumnKey(column)) ?? metadata?.[index] ?? { name: column, label: column };
        const inferred = inferredByName.get(normalizeColumnKey(column));
        const typeName = (existing.typeName || '').trim();
        const hasKnownType = typeName.length > 0 && typeName.toUpperCase() !== 'UNKNOWN';

        return {
            ...existing,
            name: existing.name || column,
            label: existing.label || column,
            typeName: hasKnownType ? existing.typeName : inferred?.typeName || existing.typeName || 'UNKNOWN',
            displaySize: typeof existing.displaySize === 'number' ? existing.displaySize : undefined,
            scale: typeof existing.scale === 'number' ? existing.scale : undefined
        };
    });
}

function trimSqlIdentifier(value: string): string {
    return value.trim().replace(/^"|"$/g, '').replace(/\s+/g, ' ').trim();
}

function splitSqlList(value: string): string[] {
    const items: string[] = [];
    let buffer = '';
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;

    for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        const next = value[i + 1];

        if (inSingleQuote) {
            buffer += ch;
            if (ch === "'" && next === "'") {
                buffer += next;
                i++;
            } else if (ch === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            buffer += ch;
            if (ch === '"' && next === '"') {
                buffer += next;
                i++;
            } else if (ch === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (ch === '(') {
            depth++;
            buffer += ch;
            continue;
        }

        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            buffer += ch;
            continue;
        }

        if (ch === "'") {
            inSingleQuote = true;
            buffer += ch;
            continue;
        }

        if (ch === '"') {
            inDoubleQuote = true;
            buffer += ch;
            continue;
        }

        if (ch === ',' && depth === 0) {
            items.push(buffer.trim());
            buffer = '';
            continue;
        }

        buffer += ch;
    }

    if (buffer.trim()) {
        items.push(buffer.trim());
    }

    return items.filter(item => item.length > 0);
}

function parseSelectAliases(statement: string, fallbackNames: string[]): Map<string, string> {
    const aliasMap = new Map<string, string>();
    const match = statement.match(/\bSELECT\b([\s\S]*?)\bFROM\b/i);
    if (!match) {
        return aliasMap;
    }

    const selectList = match[1];
    const items = splitSqlList(selectList);
    items.forEach((item, index) => {
        const normalizedName = fallbackNames[index] ?? '';
        if (!normalizedName) {
            return;
        }

        const aliasMatch = item.match(/(?:\bAS\b\s+|\s+)(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_#$@]+))\s*$/i);
        const aliasValue = aliasMatch ? (aliasMatch[1] || aliasMatch[2] || aliasMatch[3] || '').trim() : '';
        if (aliasValue) {
            aliasMap.set(normalizedName.toUpperCase(), aliasValue);
        }
    });

    return aliasMap;
}

function extractTableReference(statement: string): { schema?: string; table?: string } | undefined {
    const match = statement.match(/\bFROM\b\s+((?:"[^"]+"|'[^']+'|[A-Za-z0-9_#$@]+)(?:\.(?:"[^"]+"|'[^']+'|[A-Za-z0-9_#$@]+))?)(?:\s+AS\s+|\s+|$)/i);
    if (!match) {
        return undefined;
    }

    const part = trimSqlIdentifier(match[1]);
    if (!part) {
        return undefined;
    }

    const normalized = part.replace(/\./g, '.');
    const pieces = normalized.split('.');
    if (pieces.length === 1) {
        return { table: pieces[0].toUpperCase() };
    }

    return {
        schema: pieces.slice(0, -1).join('.').toUpperCase(),
        table: pieces[pieces.length - 1].toUpperCase()
    };
}

async function runCmdEntrySql(
    connection: IBMi,
    jobManager: CommandEntryJobManager | undefined,
    sql: string,
    options?: { bindings?: unknown[]; rows?: number; skipSyntaxCheck?: boolean }
): Promise<Record<string, unknown>[]> {
    if (!options?.skipSyntaxCheck) {
        await checkSQLForExecution(connection, sql, jobManager);
    }

    const executeOptions = options ? { bindings: options.bindings, rows: options.rows } : undefined;
    if (jobManager) {
        return await jobManager.runSQL(connection, sql, executeOptions);
    }

    return await connection.runSQL(sql, executeOptions as never) as Record<string, unknown>[];
}

async function fetchColumnMetadataFromCatalog(
    connection: IBMi,
    statement: string,
    fallbackNames: string[],
    jobManager?: CommandEntryJobManager
): Promise<SqlColumnMetadata[]> {
    if (fallbackNames.length === 0) {
        return [];
    }

    const tableRef = extractTableReference(statement);
    if (!tableRef?.table) {
        return fallbackNames.map(name => ({ name, label: name }));
    }
    const tableName = tableRef.table;

    const resolveCurrentSchema = async (): Promise<string | undefined> => {
        try {
            const rows = await runCmdEntrySql(connection, jobManager, 'VALUES CURRENT SCHEMA', { skipSyntaxCheck: true });
            const row = rows?.[0];
            if (!row) {
                return undefined;
            }
            const value = Object.values(row)[0];
            const schemaName = String(value ?? '').trim();
            return schemaName ? schemaName.toUpperCase() : undefined;
        } catch {
            return undefined;
        }
    };

    const parseSchemaList = (value: string): string[] => {
        return value
            .split(',')
            .map(part => part.trim().replace(/^"|"$/g, ''))
            .map(part => part.toUpperCase())
            .filter(part => part.length > 0);
    };

    const resolveCurrentPathSchemas = async (): Promise<string[]> => {
        try {
            const rows = await runCmdEntrySql(connection, jobManager, 'VALUES CURRENT PATH', { skipSyntaxCheck: true });
            const row = rows?.[0];
            if (!row) {
                return [];
            }
            const value = String(Object.values(row)[0] ?? '').trim();
            if (!value) {
                return [];
            }
            return parseSchemaList(value);
        } catch {
            return [];
        }
    };

    const querySchema = async (schema: string): Promise<Record<string, unknown>[] | undefined> => {
        const sql = `SELECT COLUMN_NAME, COLUMN_HEADING, COLUMN_TEXT, DATA_TYPE, LENGTH, NUMERIC_SCALE, DDS_TYPE, IS_IDENTITY, ORDINAL_POSITION
FROM QSYS2.SYSCOLUMNS2
WHERE TABLE_SCHEMA = '${schema.replace(/'/g, "''")}'
    AND TABLE_NAME = '${tableName.replace(/'/g, "''")}'
ORDER BY ORDINAL_POSITION`;

        const rows = await runCmdEntrySql(connection, jobManager, sql, { skipSyntaxCheck: true });
        return rows;
    };

    const schemaCandidates: string[] = [];
    const addCandidate = (schema: string | undefined) => {
        if (!schema) {
            return;
        }
        const normalized = schema.trim().toUpperCase();
        if (!normalized) {
            return;
        }
        if (!schemaCandidates.includes(normalized)) {
            schemaCandidates.push(normalized);
        }
    };

    if (tableRef.schema) {
        addCandidate(tableRef.schema);
    } else {
        addCandidate(await resolveCurrentSchema());
        for (const pathSchema of await resolveCurrentPathSchemas()) {
            addCandidate(pathSchema);
        }
    }

    if (schemaCandidates.length === 0) {
        return fallbackNames.map(name => ({ name, label: name }));
    }

    try {
        let rows: Record<string, unknown>[] = [];
        for (const schema of schemaCandidates) {
            rows = await querySchema(schema) ?? [];
            if (rows.length > 0) {
                break;
            }
        }

        if (!rows || rows.length === 0) {
            return fallbackNames.map(name => ({ name, label: name }));
        }

        const byName = new Map<string, SqlColumnMetadata>();
        for (const row of rows) {
            const columnName = String(row.COLUMN_NAME ?? row.column_name ?? '').trim();
            if (!columnName) {
                continue;
            }
            const label = String(row.COLUMN_HEADING ?? row.column_heading ?? row.COLUMN_TEXT ?? row.column_text ?? '').trim();
            const textDescription = String(row.COLUMN_TEXT ?? row.column_text ?? '').trim();
            const typeName = String(row.DATA_TYPE ?? row.data_type ?? row.SYSTEM_TYPE_NAME ?? row.system_type_name ?? 'UNKNOWN').trim();
            const lengthValue = row.LENGTH ?? row.length ?? row.CHARACTER_MAXIMUM_LENGTH ?? row.character_maximum_length;
            const scaleValue = row.NUMERIC_SCALE ?? row.numeric_scale ?? row.SCALE ?? row.scale;
            const ddsType = String(row.DDS_TYPE ?? row.dds_type ?? '').trim();
            const isIdentity = toOptionalBoolean(row.IS_IDENTITY ?? row.is_identity);
            byName.set(columnName.toUpperCase(), {
                name: columnName,
                label: label || columnName,
                typeName: typeName || 'UNKNOWN',
                displaySize: toOptionalNumber(lengthValue),
                scale: toOptionalNumber(scaleValue),
                textDescription: textDescription || undefined,
                ddsType: ddsType || undefined,
                isIdentity
            });
        }

        const aliases = parseSelectAliases(statement, fallbackNames);
        return fallbackNames.map((name, index) => {
            const normalized = name.toUpperCase();
            const aliasLabel = aliases.get(normalized);
            const metadata = byName.get(normalized) ?? byName.get(name.toUpperCase());
            const actualLabel = aliasLabel || metadata?.label || name;
            return {
                name,
                label: actualLabel,
                typeName: metadata?.typeName || 'UNKNOWN',
                displaySize: metadata?.displaySize,
                scale: metadata?.scale,
                textDescription: metadata?.textDescription,
                ddsType: metadata?.ddsType,
                isIdentity: metadata?.isIdentity
            };
        });
    } catch {
        return fallbackNames.map(name => ({ name, label: name }));
    }
}

async function tryRunSharedMapepireQuery(
    connection: IBMi,
    statement: string,
    rows?: number
): Promise<unknown | undefined> {
    const sqlJob = (connection as any).sqlJob;
    if (!sqlJob || typeof sqlJob.query !== 'function') {
        return undefined;
    }

    let query: any;
    try {
        query = sqlJob.query(statement, { isTerseResults: false });
        if (!query || typeof query.execute !== 'function') {
            return undefined;
        }

        if (isPositiveInteger(rows)) {
            try {
                return await query.execute(rows);
            } catch {
                return await query.execute();
            }
        }

        return await query.execute();
    } catch {
        return undefined;
    } finally {
        try {
            if (query && typeof query.close === 'function') {
                await query.close();
            }
        } catch {
            // Ignore close failures on best-effort metadata path.
        }
    }
}

function stripTrailingSemicolon(sql: string): string {
    return sql.replace(/;\s*$/, '').trim();
}

function isPagedQueryCandidate(sql: string): boolean {
    const normalized = stripTrailingSemicolon(sql).toUpperCase();
    // Wrapping LATERAL queries in a derived-table/OFFSET shell can break parsing
    // on IBM i (e.g., table functions correlated to prior FROM items).
    if (normalized.includes('LATERAL')) {
        return false;
    }
    return normalized.startsWith('SELECT ') || normalized.startsWith('WITH ');
}

function isWordBoundaryChar(ch: string | undefined): boolean {
    if (!ch) {
        return true;
    }
    return !/[A-Z0-9_#$@]/i.test(ch);
}

function findTopLevelOrderByIndex(sql: string): number {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;
    let lastIndex = -1;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        const next = sql[i + 1];

        if (inLineComment) {
            if (ch === '\n' || ch === '\r') {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }

        if (inSingleQuote) {
            if (ch === "'" && next === "'") {
                i += 1;
                continue;
            }
            if (ch === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (ch === '"' && next === '"') {
                i += 1;
                continue;
            }
            if (ch === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (ch === '-' && next === '-') {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }

        if (ch === "'") {
            inSingleQuote = true;
            continue;
        }

        if (ch === '"') {
            inDoubleQuote = true;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            continue;
        }

        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (depth !== 0) {
            continue;
        }

        if (i + 8 > sql.length) {
            continue;
        }

        if (sql.slice(i, i + 5).toUpperCase() !== 'ORDER') {
            continue;
        }

        let j = i + 5;
        while (j < sql.length && /\s/.test(sql[j])) {
            j += 1;
        }

        if (sql.slice(j, j + 2).toUpperCase() !== 'BY') {
            continue;
        }

        const before = sql[i - 1];
        const after = sql[j + 2];
        if (!isWordBoundaryChar(before) || !isWordBoundaryChar(after)) {
            continue;
        }

        lastIndex = i;
    }

    return lastIndex;
}

function findTopLevelKeywordIndex(sql: string, keyword: string): number {
    const upperKeyword = keyword.toUpperCase();
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        const next = sql[i + 1];

        if (inLineComment) {
            if (ch === '\n' || ch === '\r') {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }

        if (inSingleQuote) {
            if (ch === "'" && next === "'") {
                i += 1;
                continue;
            }
            if (ch === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (ch === '"' && next === '"') {
                i += 1;
                continue;
            }
            if (ch === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (ch === '-' && next === '-') {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }

        if (ch === "'") {
            inSingleQuote = true;
            continue;
        }

        if (ch === '"') {
            inDoubleQuote = true;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            continue;
        }

        if (ch === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (depth !== 0) {
            continue;
        }

        if (i + upperKeyword.length > sql.length) {
            continue;
        }

        if (sql.slice(i, i + upperKeyword.length).toUpperCase() !== upperKeyword) {
            continue;
        }

        const before = sql[i - 1];
        const after = sql[i + upperKeyword.length];
        if (!isWordBoundaryChar(before) || !isWordBoundaryChar(after)) {
            continue;
        }

        return i;
    }

    return -1;
}

function hasTopLevelUserRowLimiter(sql: string): boolean {
    const normalized = stripTrailingSemicolon(sql);

    if (findTopLevelKeywordIndex(normalized, 'LIMIT') >= 0) {
        return true;
    }

    if (findTopLevelKeywordIndex(normalized, 'OFFSET') >= 0) {
        return true;
    }

    const fetchIndex = findTopLevelKeywordIndex(normalized, 'FETCH');
    if (fetchIndex >= 0) {
        const remainder = normalized.slice(fetchIndex + 'FETCH'.length);
        if (/^\s+(FIRST|NEXT)\b/i.test(remainder)) {
            return true;
        }
    }

    return false;
}

function splitTopLevelOrderBy(sql: string): { baseSql: string; orderByClause?: string } {
    const orderByIndex = findTopLevelOrderByIndex(sql);
    if (orderByIndex < 0) {
        return { baseSql: sql };
    }

    const baseSql = sql.slice(0, orderByIndex).trim();
    const orderByClause = sql.slice(orderByIndex + 5).trim();
    if (!baseSql || !orderByClause) {
        return { baseSql: sql };
    }

    // Remove leading BY from "ORDER BY ..." remainder.
    const normalized = orderByClause.replace(/^BY\b/i, '').trim();
    if (!normalized) {
        return { baseSql: sql };
    }

    return {
        baseSql,
        orderByClause: normalized
    };
}

function buildPagedSql(sql: string, offset: number, fetchRows: number): string {
    const baseSql = stripTrailingSemicolon(sql);
    checkSQLBeforePaging(baseSql);
    const split = splitTopLevelOrderBy(baseSql);
    if (split.orderByClause) {
        return `${split.baseSql} ORDER BY ${split.orderByClause} OFFSET ${offset} ROWS FETCH NEXT ${fetchRows} ROWS ONLY`;
    }

    return `${baseSql} OFFSET ${offset} ROWS FETCH NEXT ${fetchRows} ROWS ONLY`;
}

function resolveConfiguredSqlFetchLimit(connection?: IBMi, context?: vscode.ExtensionContext): number {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const connectionSettings = connection && context ? getConnectionSqlSettings(context, connection) : undefined;
    const enabled = connectionSettings?.limitFetch
        ?? config.get<boolean | undefined>('cmdEntrySQLLimitFetch')
        ?? config.get<boolean | undefined>('cmdEntryLimitSqlFetch')
        ?? config.get<boolean | undefined>('cmdEntrySqlFetchLimitEnabled')
        ?? config.get<boolean>('commandEntrySqlFetchLimitEnabled', true);
    if (!enabled) {
        return NOMAX_SENTINEL;
    }

    const configuredRows = connectionSettings?.fetchRowLimit
        ?? config.get<number | undefined>('cmdEntrySqlFetchRowLimit')
        ?? config.get<number | undefined>('cmdEntrySqlFetchLimitRows')
        ?? config.get<number>('commandEntrySqlFetchLimitRows', DEFAULT_SQL_RESULT_ROWS);
    if (Number.isInteger(configuredRows) && configuredRows > 0) {
        return configuredRows;
    }

    // Backward compatibility for pre-split setting values still in settings.json.
    const legacy = config.get<number | string>('commandEntrySqlFetchLimit');
    if (typeof legacy === 'string' && legacy.trim().toUpperCase() === '*NOMAX') {
        return NOMAX_SENTINEL;
    }
    if (typeof legacy === 'number' && Number.isInteger(legacy) && legacy > 0) {
        return legacy;
    }

    return DEFAULT_SQL_RESULT_ROWS;
}

function resolveConfiguredSqlPrefetchRows(connection?: IBMi, context?: vscode.ExtensionContext): number {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const connectionSettings = connection && context ? getConnectionSqlSettings(context, connection) : undefined;
    const configuredRows = connectionSettings?.firstPageRowsToFetch
        ?? config.get<number | undefined>('cmdEntrySqlFirstPageRowsToFetch')
        ?? config.get<number | undefined>('cmdEntrySqlPrefetchRows')
        ?? config.get<number>('commandEntrySqlPrefetchRows', SCROLL_PREFETCH_ROWS);
    if (Number.isInteger(configuredRows) && configuredRows > 0) {
        return configuredRows;
    }

    return SCROLL_PREFETCH_ROWS;
}

/** Executes CMD_RUN on Code for IBM i's existing shared SQL job. */
export class CommandEntryService {
    private activeSqlSession: SqlPagingSession | undefined;

    constructor(
        private readonly jobManager?: CommandEntryJobManager,
        private readonly context?: vscode.ExtensionContext
    ) { }

    getConfiguredPrefetchRows(connection?: IBMi): number {
        return resolveConfiguredSqlPrefetchRows(connection, this.context);
    }

    async closeSqlSession(sessionId?: string): Promise<void> {
        if (!this.activeSqlSession) {
            return;
        }

        if (sessionId && this.activeSqlSession.id !== sessionId) {
            return;
        }

        const closeContinuation = (this.activeSqlSession.continuationRawResult as { close?: () => Promise<void> | void } | undefined)?.close;
        if (typeof closeContinuation === 'function') {
            try {
                await closeContinuation();
            } catch (error) {
                this.logSqlDiag(`closeSqlSession.continuationCloseFailed error=${error instanceof Error ? error.message : String(error)}`);
            }
        }

        this.activeSqlSession = undefined;
    }

    private createSessionId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    private logSqlDiag(message: string): void {
        this.jobManager?.logDiagnostic(`[Cmd Entry][SQLDiag] ${message}`);
    }

    private logSqlInfo(message: string): void {
        this.jobManager?.logInfo(`[Cmd Entry][SQLPolicy] ${message}`);
    }

    private isOffsetFallbackDisabledForDiagnostics(): boolean {
        return this.resolveOffsetFallbackDebugPolicy().disabled;
    }

    private resolveOffsetFallbackDebugPolicy(): OffsetFallbackDebugPolicy {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const configValue = config.get<boolean | undefined>('cmdEntryDebugDisableOffsetFallback');
        if (typeof configValue === 'boolean') {
            return {
                disabled: configValue,
                configValue,
                envRaw: String(process.env[DISABLE_OFFSET_FALLBACK_ENV] ?? '').trim()
            };
        }

        const envRaw = String(process.env[DISABLE_OFFSET_FALLBACK_ENV] ?? '').trim();
        const envValue = envRaw.toLowerCase();
        return {
            disabled: envValue === '1' || envValue === 'true' || envValue === 'yes' || envValue === 'on',
            configValue,
            envRaw
        };
    }

    private buildConnectionKey(connection: IBMi): string {
        return `${connection.currentConnectionName}|${connection.currentUser}|${connection.currentHost}|${connection.currentPort}`;
    }

    private async runSqlRows(
        connection: IBMi,
        statement: string,
        rows?: number,
        options?: { skipSyntaxCheck?: boolean }
    ): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[] }> {
        if (!options?.skipSyntaxCheck) {
            await checkSQLForExecution(connection, statement, this.jobManager);
        }

        const rawResult = this.jobManager
            ? await this.jobManager.runSQLWithDetails(connection, statement, { rows })
            : await tryRunSharedMapepireQuery(connection, statement, rows)
            ?? await runCmdEntrySql(connection, this.jobManager, statement, { rows, skipSyntaxCheck: true });

        const detailedRawResult = rawResult
            && typeof rawResult === 'object'
            && 'rawResult' in (rawResult as Record<string, unknown>)
            ? (rawResult as { rawResult?: unknown }).rawResult
            : undefined;

        const rowSource = rawResult && typeof rawResult === 'object' && 'rows' in (rawResult as Record<string, unknown>)
            ? (rawResult as { rows: unknown }).rows
            : rawResult;

        const normalizedRows = Array.isArray(rowSource)
            ? rowSource as Record<string, unknown>[]
            : Array.isArray((rowSource as { data?: unknown[] }).data)
                ? (rowSource as { data: Record<string, unknown>[] }).data
                : Array.isArray((rowSource as { rows?: unknown[] }).rows)
                    ? (rowSource as { rows: Record<string, unknown>[] }).rows
                    : [];

        const metadataSource = detailedRawResult ?? rawResult;
        const metadata = extractSqlColumnMetadata(metadataSource, deriveSqlColumns(normalizedRows));
        return { rows: normalizedRows, metadata };
    }

    private async runSqlRowsWithDetails(
        connection: IBMi,
        statement: string,
        rows?: number,
        options?: { skipSyntaxCheck?: boolean }
    ): Promise<(RunSQLWithDetailsResult & { metadata?: SqlColumnMetadata[] })> {
        if (!options?.skipSyntaxCheck) {
            await checkSQLForExecution(connection, statement, this.jobManager);
        }

        if (this.jobManager) {
            const detailed = await this.jobManager.runSQLWithDetails(connection, statement, { rows });
            const metadata = extractSqlColumnMetadata(detailed.rawResult ?? detailed.rows, deriveSqlColumns(detailed.rows));
            return { ...detailed, metadata };
        }

        const basic = await this.runSqlRows(connection, statement, rows, { skipSyntaxCheck: true });
        return {
            rows: basic.rows,
            metadata: basic.metadata
        };
    }

    private getBackendFetchSize(targetRows: number): number {
        if (targetRows <= 0) {
            return 0;
        }

        if (this.jobManager?.isDedicatedEnabled()) {
            return Math.min(DEDICATED_SQL_PAGE_SIZE, targetRows);
        }

        return targetRows;
    }

    private async runDedicatedSqlWithPaging(connection: IBMi, sqlStatement: string, maxRows: number): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[] }> {
        if (!this.jobManager) {
            const result = await this.runSqlRows(connection, sqlStatement, maxRows === NOMAX_SENTINEL ? undefined : maxRows);
            return result;
        }

        const statement = stripTrailingSemicolon(sqlStatement);
        await checkSQLForExecution(connection, statement, this.jobManager);
        if (!isPagedQueryCandidate(statement)) {
            const rawRows = maxRows === NOMAX_SENTINEL
                ? await runCmdEntrySql(connection, this.jobManager, statement, { skipSyntaxCheck: true })
                : await runCmdEntrySql(connection, this.jobManager, statement, { rows: maxRows, skipSyntaxCheck: true });
            const normalizedRows = Array.isArray(rawRows)
                ? rawRows as Record<string, unknown>[]
                : Array.isArray((rawRows as { data?: unknown[] }).data)
                    ? (rawRows as { data: Record<string, unknown>[] }).data
                    : Array.isArray((rawRows as { rows?: unknown[] }).rows)
                        ? (rawRows as { rows: Record<string, unknown>[] }).rows
                        : [];
            return { rows: normalizedRows, metadata: extractSqlColumnMetadata(rawRows, deriveSqlColumns(normalizedRows)) };
        }

        const unlimited = maxRows === NOMAX_SENTINEL;
        if (!unlimited) {
            const limitedResult = await this.runSqlRowsWithDetails(connection, statement, maxRows, { skipSyntaxCheck: true });
            return { rows: limitedResult.rows, metadata: limitedResult.metadata };
        }

        const initialResult = await this.runSqlRowsWithDetails(connection, statement, undefined, { skipSyntaxCheck: true });
        const rows: Record<string, unknown>[] = [...initialResult.rows];
        let metadata: SqlColumnMetadata[] | undefined = initialResult.metadata;

        if (!initialResult.rawResult || !this.jobManager) {
            return { rows, metadata };
        }

        let continuationResult = await this.jobManager.continueSQLFromResult(initialResult.rawResult, {
            statement
        });
        let guardIterations = 0;
        while (continuationResult.rows.length > 0) {
            guardIterations += 1;
            if (guardIterations > LOAD_ALL_MAX_ITERATIONS) {
                throw new Error('SQL continuation stopped after too many iterations.');
            }

            rows.push(...continuationResult.rows);
            if (!hasUsefulColumnMetadata(metadata)) {
                const continuationMetadata = extractSqlColumnMetadata(
                    continuationResult.rawResult ?? continuationResult.rows,
                    deriveSqlColumns(continuationResult.rows)
                );
                if (hasUsefulColumnMetadata(continuationMetadata)) {
                    metadata = continuationMetadata;
                }
            }

            const hasMore = !!continuationResult.continuation?.hasFetchMore
                && continuationResult.continuation?.isDone !== true;
            if (!hasMore || !continuationResult.rawResult) {
                break;
            }

            continuationResult = await this.jobManager.continueSQLFromResult(continuationResult.rawResult, {
                statement
            });
        }

        return { rows, metadata };
    }

    private async fetchSqlPage(
        connection: IBMi,
        sqlStatement: string,
        offset: number,
        fetchRows: number
    ): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[] }> {
        const pageSql = buildPagedSql(sqlStatement, offset, fetchRows);
        return this.runSqlRows(connection, pageSql, fetchRows, { skipSyntaxCheck: true });
    }

    private async fetchSqlChunk(
        connection: IBMi,
        sqlStatement: string,
        offset: number,
        chunkRows: number
    ): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[] }> {
        if (chunkRows <= 0) {
            return { rows: [] };
        }

        const rows: Record<string, unknown>[] = [];
        let metadata: SqlColumnMetadata[] | undefined;
        let localOffset = offset;

        while (rows.length < chunkRows) {
            const remaining = chunkRows - rows.length;
            const backendRows = this.getBackendFetchSize(remaining);
            if (backendRows <= 0) {
                break;
            }

            const pageResult = await this.fetchSqlPage(connection, sqlStatement, localOffset, backendRows);
            const pageRows = pageResult.rows;
            if (pageRows.length === 0) {
                break;
            }

            if (!hasUsefulColumnMetadata(metadata) && hasUsefulColumnMetadata(pageResult.metadata)) {
                metadata = pageResult.metadata;
            }

            rows.push(...pageRows);
            localOffset += pageRows.length;

            if (pageRows.length < backendRows) {
                const hasMoreAfterShortPage = await this.detectMoreRows(connection, sqlStatement, localOffset);
                if (!hasMoreAfterShortPage) {
                    break;
                }
            }
        }

        return { rows, metadata };
    }

    private async detectMoreRows(connection: IBMi, sqlStatement: string, offset: number): Promise<boolean> {
        const probeRows = (await this.fetchSqlPage(connection, sqlStatement, offset, 1)).rows;
        return probeRows.length > 0;
    }

    private async buildSqlResultPayload(
        connection: IBMi,
        statement: string,
        rows: Record<string, unknown>[],
        options?: {
            sessionId?: string;
            hasMoreRows?: boolean;
            fetchSize?: number;
            prefetchSize?: number;
            columnMetadata?: SqlColumnMetadata[];
            resultTitle?: string;
        }
    ) {
        const columns = deriveSqlColumns(rows);
        const runtimeMetadata = hasUsefulColumnMetadata(options?.columnMetadata)
            ? options?.columnMetadata
            : undefined;
        const catalogMetadata = runtimeMetadata
            ? undefined
            : await fetchColumnMetadataFromCatalog(connection, statement, columns, this.jobManager);
        const metadataFromSql = runtimeMetadata
            ? mergeColumnMetadata(columns, runtimeMetadata, catalogMetadata)
            : catalogMetadata;
        const finalMetadata = enrichMetadataWithInferredTypes(columns, metadataFromSql, rows);
        return {
            statement,
            resultTitle: options?.resultTitle,
            columns,
            columnMetadata: finalMetadata,
            rows,
            rowCount: rows.length,
            displayedRowCount: rows.length,
            truncated: !!options?.hasMoreRows,
            sessionId: options?.sessionId,
            hasMoreRows: options?.hasMoreRows,
            fetchSize: options?.fetchSize,
            prefetchSize: options?.prefetchSize
        };
    }

    async loadMoreSql(
        connection: IBMi,
        sessionId: string,
        fetchAll = false,
        fetchRowsOverride?: number
    ) {
        const session = this.activeSqlSession;
        if (!session || session.id !== sessionId) {
            throw new Error('SQL result session is no longer available. Run the SQL statement again.');
        }

        const connectionKey = this.buildConnectionKey(connection);
        if (session.connectionKey !== connectionKey) {
            await this.closeSqlSession(session.id);
            throw new Error('SQL result session belongs to a different connection. Run the SQL statement again.');
        }

        const fetchOnce = async (effectiveFetchSize: number): Promise<{ fetched: number; continuationHasMore?: boolean; }> => {
            if (session.pagingMode === 'continuation' && this.jobManager && session.continuationRawResult) {
                const lastTuple = session.continuation;
                const canInvokeFetchMore = !!lastTuple?.hasFetchMore;
                const continuationUsable = this.jobManager.isContinuationUsable(lastTuple);
                const disableOffsetFallback = this.isOffsetFallbackDisabledForDiagnostics();
                this.logSqlInfo(`loadMore.start mode=continuation session=${session.id} nextOffset=${session.nextOffset} targetRows=${effectiveFetchSize} tuple(type=${lastTuple?.type ?? '<none>'},id=${lastTuple?.id ?? '<none>'},cont_id=${lastTuple?.contId ?? '<none>'},is_done=${lastTuple?.isDone ?? '<unknown>'},hasFetchMore=${canInvokeFetchMore}) disableOffsetFallback=${disableOffsetFallback}`);
                this.logSqlDiag(`loadMore.begin mode=continuation session=${session.id} nextOffset=${session.nextOffset} targetRows=${effectiveFetchSize} hasFetchMore=${canInvokeFetchMore} continuationUsable=${continuationUsable} isDone=${lastTuple?.isDone ?? '<unknown>'} disableOffsetFallback=${disableOffsetFallback}`);

                const continuationResult = continuationUsable
                    ? await this.jobManager.continueSQLFromResult(session.continuationRawResult, {
                        statement: session.statement,
                        targetRows: effectiveFetchSize
                    })
                    : {
                        rows: [] as Record<string, unknown>[],
                        rawResult: session.continuationRawResult,
                        continuation: lastTuple
                    };

                const pageRows = continuationResult.rows;
                const pageMetadata = extractSqlColumnMetadata(
                    continuationResult.rawResult ?? continuationResult.rows,
                    deriveSqlColumns(pageRows)
                );

                if (!hasUsefulColumnMetadata(session.columnMetadata) && hasUsefulColumnMetadata(pageMetadata)) {
                    session.columnMetadata = pageMetadata;
                }

                if (pageRows.length > 0) {
                    session.rows.push(...pageRows);
                    session.nextOffset += pageRows.length;
                }

                session.continuationRawResult = continuationResult.rawResult;
                session.continuation = continuationResult.continuation;

                let continuationHasMore = !!continuationResult.continuation
                    && continuationResult.continuation.isDone !== true;

                // Some providers expose continuation tuple metadata (is_done/id/cont_id)
                // before a callable fetchMore appears. In that mismatch case, allow the
                // session to keep moving via paged SQL as a safety fallback.
                if (continuationHasMore && !canInvokeFetchMore && pageRows.length === 0) {
                    if (disableOffsetFallback) {
                        this.logSqlDiag('loadMore.fallbackSuppressed reason=continuationTupleWithoutFetchMore');
                        this.logSqlInfo('loadMore.branch continuationStalled action=keepContinuationSession');
                        return {
                            fetched: 0,
                            continuationHasMore: true
                        };
                    }

                    this.logSqlDiag('loadMore.fallbackToOffset reason=continuationTupleWithoutFetchMore');
                    this.logSqlInfo(`loadMore.branch action=offsetFallback nextOffset=${session.nextOffset} targetRows=${effectiveFetchSize}`);

                    const fallbackPage = await this.fetchSqlChunk(connection, session.statement, session.nextOffset, effectiveFetchSize);
                    const fallbackRows = fallbackPage.rows;
                    if (!hasUsefulColumnMetadata(session.columnMetadata) && hasUsefulColumnMetadata(fallbackPage.metadata)) {
                        session.columnMetadata = fallbackPage.metadata;
                    }

                    if (fallbackRows.length > 0) {
                        session.rows.push(...fallbackRows);
                        session.nextOffset += fallbackRows.length;
                    }

                    continuationHasMore = fallbackRows.length === effectiveFetchSize;
                    this.logSqlDiag(`loadMore.end mode=offset-fallback fetched=${fallbackRows.length} nextOffset=${session.nextOffset} hasMore=${continuationHasMore}`);
                    return {
                        fetched: fallbackRows.length,
                        continuationHasMore
                    };
                }

                this.logSqlDiag(`loadMore.end mode=continuation fetched=${pageRows.length} nextOffset=${session.nextOffset} hasMore=${continuationHasMore}`);

                return {
                    fetched: pageRows.length,
                    continuationHasMore
                };
            }

            this.logSqlDiag(`loadMore.begin mode=offset session=${session.id} nextOffset=${session.nextOffset} targetRows=${effectiveFetchSize}`);
            const pageResult = await this.fetchSqlChunk(connection, session.statement, session.nextOffset, effectiveFetchSize);
            const pageRows = pageResult.rows;
            if (!hasUsefulColumnMetadata(session.columnMetadata) && hasUsefulColumnMetadata(pageResult.metadata)) {
                session.columnMetadata = pageResult.metadata;
            }
            if (pageRows.length > 0) {
                session.rows.push(...pageRows);
                session.nextOffset += pageRows.length;
            }

            this.logSqlDiag(`loadMore.end mode=offset fetched=${pageRows.length} nextOffset=${session.nextOffset}`);

            return { fetched: pageRows.length };
        };

        if (fetchAll) {
            let iteration = 0;
            session.hasMoreRows = true;
            while (session.hasMoreRows) {
                iteration += 1;
                if (iteration > LOAD_ALL_MAX_ITERATIONS) {
                    throw new Error('Load all stopped after too many fetch iterations. Add ORDER BY to the SQL statement and try again.');
                }

                const outcome = await fetchOnce(session.fetchSize);
                const fetched = outcome.fetched;
                if (session.pagingMode === 'continuation') {
                    session.hasMoreRows = !!outcome.continuationHasMore;
                    if (session.hasMoreRows && fetched === 0) {
                        this.logSqlInfo('loadAll.branch continuationStalled action=stopLoopKeepSession');
                        break;
                    }
                } else {
                    session.hasMoreRows = !(fetched === 0 || fetched < session.fetchSize);
                }
            }
        } else {
            if (!session.hasMoreRows) {
                const payload = await this.buildSqlResultPayload(connection, session.statement, session.rows, {
                    sessionId: undefined,
                    hasMoreRows: false,
                    fetchSize: session.fetchSize,
                    prefetchSize: session.prefetchSize,
                    columnMetadata: session.columnMetadata,
                    resultTitle: session.resultTitle
                });
                await this.closeSqlSession(session.id);
                return payload;
            }

            const effectiveFetchSize = Number.isInteger(fetchRowsOverride) && (fetchRowsOverride as number) > 0
                ? Math.min(fetchRowsOverride as number, session.fetchSize)
                : session.fetchSize;
            const outcome = await fetchOnce(effectiveFetchSize);
            const fetched = outcome.fetched;
            if (session.pagingMode === 'continuation') {
                session.hasMoreRows = !!outcome.continuationHasMore;
            } else if (fetched === 0) {
                session.hasMoreRows = false;
            } else {
                session.hasMoreRows = await this.detectMoreRows(connection, session.statement, session.nextOffset);
            }
        }

        session.lastUsedAt = Date.now();

        const hasMoreRows = session.hasMoreRows;
        const payload = await this.buildSqlResultPayload(connection, session.statement, session.rows, {
            sessionId: hasMoreRows ? session.id : undefined,
            hasMoreRows,
            fetchSize: session.fetchSize,
            prefetchSize: session.prefetchSize,
            columnMetadata: session.columnMetadata,
            resultTitle: session.resultTitle
        });

        if (!hasMoreRows) {
            await this.closeSqlSession(session.id);
        }

        return payload;
    }

    async execute(
        connection: IBMi,
        command: string,
        mode: CommandExecutionMode,
        id?: string,
        options?: { resultTitle?: string }
    ): Promise<CommandExecution> {
        const started = Date.now();
        const startedDate = new Date(started);
        const startedAt = startedDate.toISOString();
        try {
            const sqlStatement = extractSqlStatement(command);
            if (sqlStatement) {
                await this.closeSqlSession();

                const maxRows = resolveConfiguredSqlFetchLimit(connection, this.context);
                const prefetchRows = resolveConfiguredSqlPrefetchRows(connection, this.context);
                const unlimited = maxRows === NOMAX_SENTINEL;
                const normalizedSql = stripTrailingSemicolon(sqlStatement);
                const userManagedRowLimiter = hasTopLevelUserRowLimiter(normalizedSql);
                const fallbackPolicy = this.resolveOffsetFallbackDebugPolicy();
                const disableOffsetFallback = fallbackPolicy.disabled;
                this.logSqlInfo(`query.start disableOffsetFallback=${disableOffsetFallback} configValue=${fallbackPolicy.configValue === undefined ? '<unset>' : fallbackPolicy.configValue} env(${DISABLE_OFFSET_FALLBACK_ENV})=${fallbackPolicy.envRaw || '<empty>'} dedicatedUsable=${this.jobManager?.isDedicatedUsable(connection) ?? false}`);
                this.logSqlDiag(`query.start dedicatedUsable=${this.jobManager?.isDedicatedUsable(connection) ?? false} maxRows=${maxRows === NOMAX_SENTINEL ? '*NOMAX' : maxRows} prefetchRows=${prefetchRows} unlimited=${unlimited} userManagedLimiter=${userManagedRowLimiter} disableOffsetFallback=${disableOffsetFallback}`);
                let rows: Record<string, unknown>[];
                let hasMoreRows = false;
                let sessionId: string | undefined;

                let columnMetadata: SqlColumnMetadata[] | undefined;

                if (userManagedRowLimiter) {
                    const result = await this.runSqlRows(connection, normalizedSql, undefined);
                    rows = result.rows;
                    columnMetadata = result.metadata;
                } else if (!isPagedQueryCandidate(normalizedSql) || unlimited) {
                    const result = this.jobManager
                        ? await this.runDedicatedSqlWithPaging(connection, normalizedSql, maxRows)
                        : await this.runSqlRows(connection, normalizedSql, unlimited ? undefined : maxRows);
                    rows = result.rows;
                    columnMetadata = result.metadata;
                } else {
                    const prefetchSize = Math.min(maxRows, prefetchRows);
                    if (this.jobManager) {
                        const initialChunk = await this.runSqlRowsWithDetails(connection, normalizedSql, prefetchSize);
                        rows = initialChunk.rows;
                        columnMetadata = initialChunk.metadata;
                        this.logSqlDiag(`query.firstChunk rows=${rows.length} requested=${prefetchSize} continuationType=${initialChunk.continuation?.type ?? '<none>'} hasFetchMore=${initialChunk.continuation?.hasFetchMore ?? false} isDone=${initialChunk.continuation?.isDone ?? '<unknown>'} contId=${initialChunk.continuation?.contId ?? '<none>'} id=${initialChunk.continuation?.id ?? '<none>'}`);
                        this.logSqlInfo(`query.firstChunk rows=${rows.length} requested=${prefetchSize} tuple(type=${initialChunk.continuation?.type ?? '<none>'},id=${initialChunk.continuation?.id ?? '<none>'},cont_id=${initialChunk.continuation?.contId ?? '<none>'},is_done=${initialChunk.continuation?.isDone ?? '<unknown>'},hasFetchMore=${initialChunk.continuation?.hasFetchMore ?? false})`);
                        const continuationAvailable = !!initialChunk.rawResult
                            && this.jobManager.isContinuationUsable(initialChunk.continuation);
                        this.logSqlInfo(`query.continuationDecision rawResult=${!!initialChunk.rawResult} continuationAvailable=${continuationAvailable} reason=${continuationAvailable ? `continuation-usable (id=${initialChunk.continuation?.id ?? '<none>'},cont_id=${initialChunk.continuation?.contId ?? '<none>'},is_done=${initialChunk.continuation?.isDone ?? '<unknown>'},hasFetchMore=${initialChunk.continuation?.hasFetchMore ?? false})` : `continuation-unusable (id=${initialChunk.continuation?.id ?? '<none>'},cont_id=${initialChunk.continuation?.contId ?? '<none>'},is_done=${initialChunk.continuation?.isDone ?? '<unknown>'},hasFetchMore=${initialChunk.continuation?.hasFetchMore ?? false})`}`);
                        hasMoreRows = continuationAvailable;

                        if (continuationAvailable) {
                            const session: SqlPagingSession = {
                                id: this.createSessionId(),
                                connectionKey: this.buildConnectionKey(connection),
                                statement: normalizedSql,
                                resultTitle: options?.resultTitle,
                                rows: [...rows],
                                columnMetadata,
                                columns: deriveSqlColumns(rows),
                                nextOffset: rows.length,
                                // Reuse the prefetch setting as sqlmore chunk size.
                                fetchSize: prefetchSize,
                                prefetchSize,
                                pagingMode: 'continuation',
                                continuation: initialChunk.continuation,
                                continuationRawResult: initialChunk.rawResult,
                                hasMoreRows: true,
                                createdAt: Date.now(),
                                lastUsedAt: Date.now()
                            };
                            this.activeSqlSession = session;
                            sessionId = session.id;
                            this.logSqlDiag(`query.branch continuation session=${session.id} hasMore=${hasMoreRows} nextOffset=${session.nextOffset}`);
                        } else {
                            if (disableOffsetFallback) {
                                this.logSqlDiag('query.branch no-continuation with fallback disabled');
                                this.logSqlInfo('query.branch continuationUnavailable action=stopWithoutOffsetFallback');
                            }

                            // Dedicated mode can still return short first pages without a callable
                            // continuation function. Keep progressive loading via OFFSET fallback.
                            hasMoreRows = !disableOffsetFallback && rows.length === prefetchSize;
                            if (!disableOffsetFallback && !hasMoreRows && rows.length > 0) {
                                hasMoreRows = await this.detectMoreRows(connection, normalizedSql, rows.length);
                                this.logSqlDiag(`query.probe short-first-page offset=${rows.length} hasMore=${hasMoreRows}`);
                                this.logSqlInfo(`query.probe shortFirstPage offset=${rows.length} hasMore=${hasMoreRows}`);
                            }

                            if (hasMoreRows) {
                                const session: SqlPagingSession = {
                                    id: this.createSessionId(),
                                    connectionKey: this.buildConnectionKey(connection),
                                    statement: normalizedSql,
                                    resultTitle: options?.resultTitle,
                                    rows: [...rows],
                                    columnMetadata,
                                    columns: deriveSqlColumns(rows),
                                    nextOffset: rows.length,
                                    fetchSize: maxRows,
                                    prefetchSize,
                                    pagingMode: 'offset',
                                    hasMoreRows: true,
                                    createdAt: Date.now(),
                                    lastUsedAt: Date.now()
                                };
                                this.activeSqlSession = session;
                                sessionId = session.id;
                                this.logSqlDiag(`query.branch offset-fallback session=${session.id} hasMore=${hasMoreRows} nextOffset=${session.nextOffset}`);
                                this.logSqlInfo(`query.branch action=offsetFallback session=${session.id} nextOffset=${session.nextOffset}`);
                            }
                        }
                    } else {
                        const initialChunk = await this.fetchSqlChunk(connection, normalizedSql, 0, prefetchSize);
                        rows = initialChunk.rows;
                        columnMetadata = initialChunk.metadata;
                        // Shared fallback mode still probes with OFFSET pagination.
                        hasMoreRows = rows.length === prefetchSize;
                        if (!hasMoreRows && rows.length > 0) {
                            hasMoreRows = await this.detectMoreRows(connection, normalizedSql, rows.length);
                            this.logSqlDiag(`query.probe shared short-first-page offset=${rows.length} hasMore=${hasMoreRows}`);
                        }

                        if (hasMoreRows) {
                            const session: SqlPagingSession = {
                                id: this.createSessionId(),
                                connectionKey: this.buildConnectionKey(connection),
                                statement: normalizedSql,
                                resultTitle: options?.resultTitle,
                                rows: [...rows],
                                columnMetadata,
                                columns: deriveSqlColumns(rows),
                                nextOffset: rows.length,
                                fetchSize: maxRows,
                                prefetchSize,
                                pagingMode: 'offset',
                                hasMoreRows: true,
                                createdAt: Date.now(),
                                lastUsedAt: Date.now()
                            };
                            this.activeSqlSession = session;
                            sessionId = session.id;
                            this.logSqlDiag(`query.branch shared-offset session=${session.id} hasMore=${hasMoreRows} nextOffset=${session.nextOffset}`);
                        }
                    }
                }

                const rowCount = rows.length;
                const rowLabel = rowCount === 1 ? 'row' : 'rows';
                const effectiveRowsPerFetch = hasMoreRows ? Math.min(maxRows, prefetchRows) : maxRows;
                this.logSqlInfo(`query.end rows=${rowCount} hasMore=${hasMoreRows} sessionId=${sessionId ?? '<none>'}`);
                this.logSqlDiag(`query.end rows=${rowCount} hasMore=${hasMoreRows} sessionId=${sessionId ?? '<none>'} fetchSize=${(unlimited || userManagedRowLimiter) ? '<none>' : effectiveRowsPerFetch}`);
                return {
                    id: id ?? `${started}-${Math.random().toString(36).slice(2, 8)}`,
                    command,
                    mode,
                    startedAt,
                    elapsedMs: Date.now() - started,
                    outcome: 'success',
                    messages: [{
                        ordinalPosition: 1,
                        messageId: 'SQL0000',
                        severity: 0,
                        type: 'INFO',
                        text: userManagedRowLimiter
                            ? `${rowCount} ${rowLabel} returned (user-managed row limiter)`
                            : unlimited
                                ? `${rowCount} ${rowLabel} returned (*NOMAX)`
                                : hasMoreRows
                                    ? `${rowCount} ${rowLabel} returned (prefetched ${rowCount}; rows per fetch ${effectiveRowsPerFetch})`
                                    : `${rowCount} ${rowLabel} returned (rows per fetch ${effectiveRowsPerFetch})`,
                        sentTimestamp: toIsoTimestamp(startedDate),
                        sentFromProgram: '',
                        sentFromStmt: '',
                        sentFromModule: '',
                        sentFromProcedure: '',
                        sentToProgram: '',
                        sentToStmt: '',
                        sentToModule: '',
                        sentToProcedure: '',
                        secondLevelText: '',
                        kind: 'info'
                    }],
                    sqlResult: await this.buildSqlResultPayload(connection, normalizedSql, rows, {
                        sessionId,
                        hasMoreRows,
                        fetchSize: (unlimited || userManagedRowLimiter) ? undefined : effectiveRowsPerFetch,
                        prefetchSize: (unlimited || userManagedRowLimiter) ? undefined : Math.min(maxRows, prefetchRows),
                        columnMetadata,
                        resultTitle: options?.resultTitle
                    })
                };
            }

            // `bindings` is Code for IBM i 3.x's public Mapepire parameter API.
            // It keeps CL command text out of the SQL source and prevents SQL injection.
            const udtfLibrary = getUDTFLibrary(connection);
            const rows = await runCmdEntrySql(connection, this.jobManager, buildCmdRunSql(udtfLibrary), { bindings: [command, mode], skipSyntaxCheck: true });
            const messages = mapCommandMessages(rows as Record<string, unknown>[]);
            return {
                id: id ?? `${started}-${Math.random().toString(36).slice(2, 8)}`,
                command,
                mode,
                startedAt,
                elapsedMs: Date.now() - started,
                outcome: determineOutcome(messages),
                messages
            };
        } catch (error) {
            return {
                id: id ?? `${started}-${Math.random().toString(36).slice(2, 8)}`,
                command,
                mode,
                startedAt,
                elapsedMs: Date.now() - started,
                outcome: 'error',
                messages: [],
                failure: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
