import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import * as vscode from 'vscode';
import { CommandExecution, CommandExecutionMode, SqlColumnMetadata, determineOutcome, mapCommandMessages } from './commandEntryModel';
import { getUDTFLibrary } from './components/hostFunctions';
import { CommandEntryJobManager } from './commandEntryJobManager';
import { detectCommandEntryPrefix } from './commandEntryPrefixes';
import { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId } from './commandEntrySqlHelpers';

export { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId };

const DEFAULT_SQL_RESULT_ROWS = 1000;
const DEDICATED_SQL_PAGE_SIZE = 100;
const NOMAX_SENTINEL = Number.MAX_SAFE_INTEGER;
const SCROLL_PREFETCH_ROWS = 200;
const LOAD_ALL_MAX_ITERATIONS = 10000;

interface SqlPagingSession {
    id: string;
    connectionKey: string;
    statement: string;
    rows: Record<string, unknown>[];
    columnMetadata?: SqlColumnMetadata[];
    columns: string[];
    nextOffset: number;
    fetchSize: number;
    prefetchSize: number;
    hasMoreRows: boolean;
    createdAt: number;
    lastUsedAt: number;
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
    const metadata = Array.isArray(raw)
        ? raw
        : raw && typeof raw === 'object'
            ? ((raw as { metadata?: unknown }).metadata ?? (raw as { columns?: unknown }).columns ?? [])
            : [];

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

async function fetchColumnMetadataFromCatalog(connection: IBMi, statement: string, fallbackNames: string[]): Promise<SqlColumnMetadata[]> {
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
            const rows = await connection.runSQL('VALUES CURRENT SCHEMA') as Record<string, unknown>[];
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
            const rows = await connection.runSQL('VALUES CURRENT PATH') as Record<string, unknown>[];
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

        const rows = await connection.runSQL(sql) as Record<string, unknown>[];
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

function buildPagedSql(sql: string, offset: number, fetchRows: number): string {
    const baseSql = stripTrailingSemicolon(sql);
    return `SELECT * FROM (${baseSql}) CLPROMPTER_PAGE OFFSET ${offset} ROWS FETCH NEXT ${fetchRows} ROWS ONLY`;
}

function resolveConfiguredSqlFetchLimit(): number {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const enabled = config.get<boolean | undefined>('cmdEntryLimitSqlFetch')
        ?? config.get<boolean | undefined>('cmdEntrySqlFetchLimitEnabled')
        ?? config.get<boolean>('commandEntrySqlFetchLimitEnabled', true);
    if (!enabled) {
        return NOMAX_SENTINEL;
    }

    const configuredRows = config.get<number | undefined>('cmdEntrySqlFetchRowLimit')
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

function resolveConfiguredSqlPrefetchRows(): number {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const configuredRows = config.get<number | undefined>('cmdEntrySqlFirstPageRowsToFetch')
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

    constructor(private readonly jobManager?: CommandEntryJobManager) { }

    getConfiguredPrefetchRows(): number {
        return resolveConfiguredSqlPrefetchRows();
    }

    async closeSqlSession(sessionId?: string): Promise<void> {
        if (!this.activeSqlSession) {
            return;
        }

        if (sessionId && this.activeSqlSession.id !== sessionId) {
            return;
        }

        this.activeSqlSession = undefined;
    }

    private createSessionId(): string {
        return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    private buildConnectionKey(connection: IBMi): string {
        return `${connection.currentConnectionName}|${connection.currentUser}|${connection.currentHost}|${connection.currentPort}`;
    }

    private async runSqlRows(
        connection: IBMi,
        statement: string,
        rows?: number
    ): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[] }> {
        const rawResult = this.jobManager
            ? await this.jobManager.runSQLWithDetails(connection, statement, { rows })
            : await tryRunSharedMapepireQuery(connection, statement, rows)
            ?? await connection.runSQL(statement, rows ? { rows } : undefined) as Record<string, unknown>[];

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
        if (!isPagedQueryCandidate(statement)) {
            const rawRows = maxRows === NOMAX_SENTINEL
                ? await this.jobManager.runSQL(connection, statement)
                : await this.jobManager.runSQL(connection, statement, { rows: maxRows });
            const normalizedRows = Array.isArray(rawRows)
                ? rawRows as Record<string, unknown>[]
                : Array.isArray((rawRows as { data?: unknown[] }).data)
                    ? (rawRows as { data: Record<string, unknown>[] }).data
                    : Array.isArray((rawRows as { rows?: unknown[] }).rows)
                        ? (rawRows as { rows: Record<string, unknown>[] }).rows
                        : [];
            return { rows: normalizedRows, metadata: extractSqlColumnMetadata(rawRows, deriveSqlColumns(normalizedRows)) };
        }

        const rows: Record<string, unknown>[] = [];
        let metadata: SqlColumnMetadata[] | undefined;
        let offset = 0;
        const unlimited = maxRows === NOMAX_SENTINEL;

        while (unlimited || rows.length < maxRows) {
            const fetchRows = unlimited
                ? DEDICATED_SQL_PAGE_SIZE
                : Math.min(DEDICATED_SQL_PAGE_SIZE, maxRows - rows.length);
            const pageSql = buildPagedSql(statement, offset, fetchRows);
            const pageRows = await this.jobManager.runSQL(connection, pageSql, { rows: fetchRows });
            const normalizedPage = Array.isArray(pageRows)
                ? pageRows as Record<string, unknown>[]
                : Array.isArray((pageRows as { data?: unknown[] }).data)
                    ? (pageRows as { data: Record<string, unknown>[] }).data
                    : Array.isArray((pageRows as { rows?: unknown[] }).rows)
                        ? (pageRows as { rows: Record<string, unknown>[] }).rows
                        : [];
            rows.push(...normalizedPage);
            if (!metadata && normalizedPage.length > 0) {
                metadata = extractSqlColumnMetadata(pageRows, deriveSqlColumns(normalizedPage));
            }

            if (normalizedPage.length < fetchRows) {
                break;
            }

            offset += normalizedPage.length;
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
        return this.runSqlRows(connection, pageSql, fetchRows);
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
                break;
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
        options?: { sessionId?: string; hasMoreRows?: boolean; fetchSize?: number; prefetchSize?: number; columnMetadata?: SqlColumnMetadata[] }
    ) {
        const columns = deriveSqlColumns(rows);
        const catalogMetadata = await fetchColumnMetadataFromCatalog(connection, statement, columns);
        const metadataFromSql = hasUsefulColumnMetadata(options?.columnMetadata)
            ? mergeColumnMetadata(columns, options?.columnMetadata, catalogMetadata)
            : catalogMetadata;
        const finalMetadata = enrichMetadataWithInferredTypes(columns, metadataFromSql, rows);
        return {
            statement,
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

        const fetchOnce = async (effectiveFetchSize: number): Promise<number> => {
            const pageResult = await this.fetchSqlChunk(connection, session.statement, session.nextOffset, effectiveFetchSize);
            const pageRows = pageResult.rows;
            if (!hasUsefulColumnMetadata(session.columnMetadata) && hasUsefulColumnMetadata(pageResult.metadata)) {
                session.columnMetadata = pageResult.metadata;
            }
            if (pageRows.length > 0) {
                session.rows.push(...pageRows);
                session.nextOffset += pageRows.length;
            }

            return pageRows.length;
        };

        if (fetchAll) {
            let iteration = 0;
            session.hasMoreRows = true;
            while (session.hasMoreRows) {
                iteration += 1;
                if (iteration > LOAD_ALL_MAX_ITERATIONS) {
                    throw new Error('Load all stopped after too many fetch iterations. Add ORDER BY to the SQL statement and try again.');
                }

                const fetched = await fetchOnce(session.fetchSize);
                if (fetched === 0 || fetched < session.fetchSize) {
                    session.hasMoreRows = false;
                }
            }
        } else {
            if (!session.hasMoreRows) {
                const payload = await this.buildSqlResultPayload(connection, session.statement, session.rows, {
                    sessionId: undefined,
                    hasMoreRows: false,
                    fetchSize: session.fetchSize,
                    prefetchSize: session.prefetchSize,
                    columnMetadata: session.columnMetadata
                });
                await this.closeSqlSession(session.id);
                return payload;
            }

            const effectiveFetchSize = Number.isInteger(fetchRowsOverride) && (fetchRowsOverride as number) > 0
                ? Math.min(fetchRowsOverride as number, session.fetchSize)
                : session.fetchSize;
            const fetched = await fetchOnce(effectiveFetchSize);
            if (fetched === 0 || fetched < effectiveFetchSize) {
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
            columnMetadata: session.columnMetadata
        });

        if (!hasMoreRows) {
            await this.closeSqlSession(session.id);
        }

        return payload;
    }

    async execute(connection: IBMi, command: string, mode: CommandExecutionMode, id?: string): Promise<CommandExecution> {
        const started = Date.now();
        const startedDate = new Date(started);
        const startedAt = startedDate.toISOString();
        try {
            const sqlStatement = extractSqlStatement(command);
            if (sqlStatement) {
                await this.closeSqlSession();

                const maxRows = resolveConfiguredSqlFetchLimit();
                const prefetchRows = resolveConfiguredSqlPrefetchRows();
                const unlimited = maxRows === NOMAX_SENTINEL;
                const normalizedSql = stripTrailingSemicolon(sqlStatement);
                let rows: Record<string, unknown>[];
                let hasMoreRows = false;
                let sessionId: string | undefined;

                let columnMetadata: SqlColumnMetadata[] | undefined;

                if (!isPagedQueryCandidate(normalizedSql) || unlimited) {
                    const result = this.jobManager
                        ? await this.runDedicatedSqlWithPaging(connection, normalizedSql, maxRows)
                        : await this.runSqlRows(connection, normalizedSql, unlimited ? undefined : maxRows);
                    rows = result.rows;
                    columnMetadata = result.metadata;
                } else {
                    const prefetchSize = Math.min(maxRows, prefetchRows);
                    const initialChunk = await this.fetchSqlChunk(connection, normalizedSql, 0, prefetchSize);
                    rows = initialChunk.rows;
                    columnMetadata = initialChunk.metadata;
                    if (rows.length === prefetchSize) {
                        hasMoreRows = await this.detectMoreRows(connection, normalizedSql, rows.length);
                    }

                    if (hasMoreRows) {
                        const session: SqlPagingSession = {
                            id: this.createSessionId(),
                            connectionKey: this.buildConnectionKey(connection),
                            statement: normalizedSql,
                            rows: [...rows],
                            columnMetadata,
                            columns: deriveSqlColumns(rows),
                            nextOffset: rows.length,
                            fetchSize: maxRows,
                            prefetchSize,
                            hasMoreRows: true,
                            createdAt: Date.now(),
                            lastUsedAt: Date.now()
                        };
                        this.activeSqlSession = session;
                        sessionId = session.id;
                    }
                }

                const rowCount = rows.length;
                const rowLabel = rowCount === 1 ? 'row' : 'rows';
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
                        text: unlimited
                            ? `${rowCount} ${rowLabel} returned (*NOMAX)`
                            : hasMoreRows
                                ? `${rowCount} ${rowLabel} returned (prefetched ${rowCount}; rows per fetch ${maxRows})`
                                : `${rowCount} ${rowLabel} returned (rows per fetch ${maxRows})`,
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
                        fetchSize: unlimited ? undefined : maxRows,
                        prefetchSize: unlimited ? undefined : Math.min(maxRows, prefetchRows),
                        columnMetadata
                    })
                };
            }

            // `bindings` is Code for IBM i 3.x's public Mapepire parameter API.
            // It keeps CL command text out of the SQL source and prevents SQL injection.
            const udtfLibrary = getUDTFLibrary(connection);
            const rows = this.jobManager
                ? await this.jobManager.runSQL(connection, buildCmdRunSql(udtfLibrary), { bindings: [command, mode] })
                : await connection.runSQL(buildCmdRunSql(udtfLibrary), { bindings: [command, mode] });
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
