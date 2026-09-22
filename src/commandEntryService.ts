import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import * as vscode from 'vscode';
import { CommandExecution, CommandExecutionMode, SqlColumnMetadata, determineOutcome, mapCommandMessages } from './commandEntryModel';
import { getUDTFLibrary } from './components/hostFunctions';
import { CommandEntryJobManager, RunSQLWithDetailsResult, SqlContinuationTuple } from './commandEntryJobManager';
import { detectCommandEntryPrefix } from './commandEntryPrefixes';
import { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId } from './commandEntrySqlHelpers';
import { getConnectionSqlSettings } from './commandEntrySqlSettings';
import { checkSQLForExecution } from './sqlSyntaxChecker';

export { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId };

const DEFAULT_SQL_RESULT_ROWS = 1000;
const NOMAX_SENTINEL = Number.MAX_SAFE_INTEGER;
const SCROLL_PREFETCH_ROWS = 200;
const LOAD_ALL_MAX_ITERATIONS = 10000;

interface SqlPagingSession {
    id: string;
    connectionKey: string;
    statement: string;
    resultTitle?: string;
    rows: Record<string, unknown>[];
    columnMetadata?: SqlColumnMetadata[];
    columns: string[];
    fetchSize: number;
    prefetchSize: number;
    continuation?: SqlContinuationTuple;
    continuationRawResult?: unknown;
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

    // Smart fallback: if SQL prefix is omitted, treat SELECT/VALUES/WITH/SET as SQL.
    const trimmed = text.trim();
    if (/^(SELECT|VALUES|WITH|SET)\b/i.test(trimmed)) {
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

function getMetadataField(candidate: Record<string, unknown>, ...aliases: string[]): unknown {
    const normalizedAliases = aliases.map((alias) => alias.replace(/[^a-z0-9]/gi, '').toLowerCase());
    for (const key of Object.keys(candidate)) {
        const normalizedKey = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (normalizedAliases.includes(normalizedKey)) {
            return candidate[key];
        }
    }
    return undefined;
}

function getMetadataFieldByPriority(candidate: Record<string, unknown>, ...aliases: string[]): unknown {
    const normalizedEntries = new Map<string, unknown>();
    for (const key of Object.keys(candidate)) {
        const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (!normalizedEntries.has(normalized)) {
            normalizedEntries.set(normalized, candidate[key]);
        }
    }

    for (const alias of aliases) {
        const normalizedAlias = alias.replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (normalizedEntries.has(normalizedAlias)) {
            return normalizedEntries.get(normalizedAlias);
        }
    }

    return undefined;
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
        const rawName = String(getMetadataField(
            candidate,
            'name', 'Name', 'COLUMN_NAME', 'columnName', 'ColumnName', 'column_name', 'NAME'
        ) ?? fallbackNames[index] ?? '').trim();
        const rawLabel = String(getMetadataField(
            candidate,
            'label', 'Label', 'lable', 'Lable', 'COLUMN_LABEL', 'columnLabel', 'ColumnLabel', 'column_label',
            'LABEL', 'COLUMN_HEADING', 'columnHeading', 'ColumnHeading', 'column_heading', 'heading', 'Heading', 'HEADING'
        ) ?? '').trim();

        const displaySize = toOptionalNumber(getMetadataFieldByPriority(
            candidate,
            'length', 'LENGTH',
            'precision', 'PRECISION',
            'displaySize', 'display_size', 'DISPLAY_SIZE',
            'columnSize', 'column_size', 'COLUMN_SIZE'
        ));

        const typeName = getMetadataField(
            candidate,
            'typeName', 'TYPE_NAME', 'DATA_TYPE', 'dataType', 'data_type', 'sqlType', 'SQL_TYPE', 'sql_type',
            'nativeType', 'NATIVE_TYPE', 'dbType', 'DB_TYPE', 'type', 'TYPE', 'typename', 'TYPE_NAME_LONG'
        );

        return {
            name: rawName || fallbackNames[index] || `COLUMN_${index + 1}`,
            label: rawLabel || rawName || fallbackNames[index] || undefined,
            typeName: typeName != null ? String(typeName) : undefined,
            displaySize,
            scale: toOptionalNumber(getMetadataField(
                candidate,
                'scale', 'numeric_scale', 'SCALE', 'numericScale', 'NUMERIC_SCALE', 'decimalDigits', 'decimal_digits', 'DECIMAL_DIGITS'
            )),
            textDescription: (() => {
                const value = getMetadataField(candidate, 'textDescription', 'TEXT_DESCRIPTION', 'column_text', 'COLUMN_TEXT');
                return value != null ? String(value) : undefined;
            })(),
            ddsType: (() => {
                const value = getMetadataField(candidate, 'ddsType', 'DDS_TYPE', 'dds_type');
                return value != null ? String(value) : undefined;
            })(),
            isIdentity: toOptionalBoolean(getMetadataField(candidate, 'isIdentity', 'IS_IDENTITY', 'is_identity')),
            schema: (() => {
                const value = getMetadataField(candidate, 'schema', 'SCHEMA');
                return typeof value === 'string' ? value : undefined;
            })(),
            table: (() => {
                const value = getMetadataField(candidate, 'table', 'TABLE');
                return typeof value === 'string' ? value : undefined;
            })()
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

    private buildConnectionKey(connection: IBMi): string {
        return `${connection.currentConnectionName}|${connection.currentUser}|${connection.currentHost}|${connection.currentPort}`;
    }

    private async refreshManagedSessionState(connection: IBMi): Promise<void> {
        if (!this.jobManager) {
            return;
        }

        try {
            await this.jobManager.refreshManagedSession(connection);
        } catch (error) {
            this.logSqlDiag(`managedSession.refreshFailed error=${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private async runSqlRows(
        connection: IBMi,
        statement: string,
        rows?: number,
        options?: { skipSyntaxCheck?: boolean }
    ): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[]; elapsedMs?: number }> {
        await this.refreshManagedSessionState(connection);

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
        const elapsedMs = typeof rawResult === 'object' && rawResult !== null && !Array.isArray(rawResult)
            ? (() => {
                const candidate = rawResult as Record<string, unknown>;
                const value = candidate.elapsedMs ?? candidate.elapsed_ms ?? candidate.elapsed ?? candidate.durationMs ?? candidate.duration_ms ?? candidate.duration ?? candidate.timeMs ?? candidate.time_ms ?? candidate.time ?? candidate.execution_time;
                if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
                    return value;
                }
                if (typeof value === 'string') {
                    const parsed = Number(value.trim());
                    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
                }
                return undefined;
            })()
            : undefined;

        return { rows: normalizedRows, metadata, elapsedMs };
    }

    private async runSqlRowsWithDetails(
        connection: IBMi,
        statement: string,
        rows?: number,
        options?: { skipSyntaxCheck?: boolean }
    ): Promise<(RunSQLWithDetailsResult & { metadata?: SqlColumnMetadata[] })> {
        await this.refreshManagedSessionState(connection);

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

    private async runDedicatedSqlWithPaging(connection: IBMi, sqlStatement: string, maxRows: number): Promise<{ rows: Record<string, unknown>[]; metadata?: SqlColumnMetadata[]; elapsedMs?: number }> {
        await this.refreshManagedSessionState(connection);

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
            return { rows: limitedResult.rows, metadata: limitedResult.metadata, elapsedMs: limitedResult.elapsedMs };
        }

        const initialResult = await this.runSqlRowsWithDetails(connection, statement, undefined, { skipSyntaxCheck: true });
        const rows: Record<string, unknown>[] = [...initialResult.rows];
        let metadata: SqlColumnMetadata[] | undefined = initialResult.metadata;

        if (!initialResult.rawResult || !this.jobManager) {
            return { rows, metadata, elapsedMs: initialResult.elapsedMs };
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

            const hasMore = !!continuationResult.rawResult
                && this.jobManager.isContinuationUsable(continuationResult.continuation);
            if (!hasMore || !continuationResult.rawResult) {
                break;
            }

            continuationResult = await this.jobManager.continueSQLFromResult(continuationResult.rawResult, {
                statement
            });
        }

        return { rows, metadata, elapsedMs: initialResult.elapsedMs };
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
            elapsedMs?: number;
        }
    ) {
        const autoColumnViewForSingleRow = getConnectionSqlSettings(this.context, connection).autoColumnViewForSingleRow;
        const columns = deriveSqlColumns(rows);
        const runtimeMetadata = hasUsefulColumnMetadata(options?.columnMetadata)
            ? options?.columnMetadata
            : undefined;
        const finalMetadata = enrichMetadataWithInferredTypes(columns, runtimeMetadata, rows);
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
            prefetchSize: options?.prefetchSize,
            elapsedMs: options?.elapsedMs,
            autoColumnViewForSingleRow
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
            if (!this.jobManager || !session.continuationRawResult) {
                this.logSqlInfo(`loadMore.branch continuationUnavailable action=stopSession session=${session.id}`);
                return { fetched: 0, continuationHasMore: false };
            }

            const lastTuple = session.continuation;
            const continuationUsable = this.jobManager.isContinuationUsable(lastTuple);
            this.logSqlInfo(`loadMore.start mode=continuation session=${session.id} targetRows=${effectiveFetchSize} tuple(type=${lastTuple?.type ?? '<none>'},id=${lastTuple?.id ?? '<none>'},cont_id=${lastTuple?.contId ?? '<none>'},is_done=${lastTuple?.isDone ?? '<unknown>'},hasFetchMore=${lastTuple?.hasFetchMore ?? false}) continuationUsable=${continuationUsable}`);

            if (!continuationUsable) {
                this.logSqlDiag('loadMore.end mode=continuation fetched=0 hasMore=false reason=continuation-unusable');
                return { fetched: 0, continuationHasMore: false };
            }

            const continuationResult = await this.jobManager.continueSQLFromResult(session.continuationRawResult, {
                statement: session.statement,
                targetRows: effectiveFetchSize
            });

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
            }

            session.continuationRawResult = continuationResult.rawResult;
            session.continuation = continuationResult.continuation;

            const continuationHasMore = !!continuationResult.rawResult
                && this.jobManager.isContinuationUsable(continuationResult.continuation);

            this.logSqlDiag(`loadMore.end mode=continuation fetched=${pageRows.length} hasMore=${continuationHasMore}`);
            return {
                fetched: pageRows.length,
                continuationHasMore
            };
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
                session.hasMoreRows = !!outcome.continuationHasMore;
                if (session.hasMoreRows && fetched === 0) {
                    this.logSqlInfo('loadAll.branch continuationStalled action=stopLoopCloseSession');
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
                    columnMetadata: session.columnMetadata,
                    resultTitle: session.resultTitle,
                    elapsedMs: undefined
                });
                await this.closeSqlSession(session.id);
                return payload;
            }

            const effectiveFetchSize = Number.isInteger(fetchRowsOverride) && (fetchRowsOverride as number) > 0
                ? Math.min(fetchRowsOverride as number, session.fetchSize)
                : session.fetchSize;
            const outcome = await fetchOnce(effectiveFetchSize);
            session.hasMoreRows = !!outcome.continuationHasMore;
        }

        session.lastUsedAt = Date.now();

        const hasMoreRows = session.hasMoreRows;
        const payload = await this.buildSqlResultPayload(connection, session.statement, session.rows, {
            sessionId: hasMoreRows ? session.id : undefined,
            hasMoreRows,
            fetchSize: session.fetchSize,
            prefetchSize: session.prefetchSize,
            columnMetadata: session.columnMetadata,
            resultTitle: session.resultTitle,
            elapsedMs: undefined
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
                this.logSqlInfo(`query.start continuationOnly=true dedicatedUsable=${this.jobManager?.isDedicatedUsable(connection) ?? false}`);
                this.logSqlDiag(`query.start dedicatedUsable=${this.jobManager?.isDedicatedUsable(connection) ?? false} maxRows=${maxRows === NOMAX_SENTINEL ? '*NOMAX' : maxRows} prefetchRows=${prefetchRows} unlimited=${unlimited} userManagedLimiter=${userManagedRowLimiter}`);
                let rows: Record<string, unknown>[];
                let hasMoreRows = false;
                let sessionId: string | undefined;
                let queryElapsedMs: number | undefined;

                let columnMetadata: SqlColumnMetadata[] | undefined;

                if (userManagedRowLimiter) {
                    const result = await this.runSqlRowsWithDetails(connection, normalizedSql, undefined);
                    rows = result.rows;
                    columnMetadata = result.metadata;
                    queryElapsedMs = result.elapsedMs;
                } else if (!isPagedQueryCandidate(normalizedSql) || unlimited) {
                    const result = this.jobManager
                        ? await this.runDedicatedSqlWithPaging(connection, normalizedSql, maxRows)
                        : await this.runSqlRows(connection, normalizedSql, unlimited ? undefined : maxRows);
                    rows = result.rows;
                    columnMetadata = result.metadata;
                    queryElapsedMs = result.elapsedMs;
                } else {
                    const prefetchSize = Math.min(maxRows, prefetchRows);
                    if (this.jobManager) {
                        const initialChunk = await this.runSqlRowsWithDetails(connection, normalizedSql, prefetchSize);
                        rows = initialChunk.rows;
                        columnMetadata = initialChunk.metadata;
                        queryElapsedMs = initialChunk.elapsedMs;
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
                                // Reuse the prefetch setting as sqlmore chunk size.
                                fetchSize: prefetchSize,
                                prefetchSize,
                                continuation: initialChunk.continuation,
                                continuationRawResult: initialChunk.rawResult,
                                hasMoreRows: true,
                                createdAt: Date.now(),
                                lastUsedAt: Date.now()
                            };
                            this.activeSqlSession = session;
                            sessionId = session.id;
                            this.logSqlDiag(`query.branch continuation session=${session.id} hasMore=${hasMoreRows}`);
                        } else {
                            hasMoreRows = false;
                            this.logSqlInfo('query.branch continuationUnavailable action=singlePageOnly');
                        }
                    } else {
                        const initialChunk = await this.runSqlRows(connection, normalizedSql, prefetchSize);
                        rows = initialChunk.rows;
                        columnMetadata = initialChunk.metadata;
                        queryElapsedMs = initialChunk.elapsedMs;
                        hasMoreRows = false;
                        this.logSqlInfo('query.branch shared-no-continuation action=singlePageOnly');
                    }
                }

                const rowCount = rows.length;
                const rowLabel = rowCount === 1 ? 'row' : 'rows';
                const effectiveRowsPerFetch = hasMoreRows ? Math.min(maxRows, prefetchRows) : maxRows;
                const executionElapsedMs = queryElapsedMs ?? (Date.now() - started);
                const sqlSummaryText = userManagedRowLimiter
                    ? `${rowCount} ${rowLabel} returned (user-managed row limiter)`
                    : unlimited
                        ? `${rowCount} ${rowLabel} returned (*NOMAX)`
                        : hasMoreRows
                            ? `${rowCount} ${rowLabel} returned (prefetched ${rowCount}; rows per fetch ${effectiveRowsPerFetch})`
                            : `${rowCount} ${rowLabel} returned (rows per fetch ${effectiveRowsPerFetch})`;
                this.logSqlInfo(`query.end rows=${rowCount} hasMore=${hasMoreRows} sessionId=${sessionId ?? '<none>'}`);
                this.logSqlDiag(`query.end rows=${rowCount} hasMore=${hasMoreRows} sessionId=${sessionId ?? '<none>'} fetchSize=${(unlimited || userManagedRowLimiter) ? '<none>' : effectiveRowsPerFetch}`);
                this.logSqlDiag(`query.messageCreated text="${sqlSummaryText}" elapsedMs=${queryElapsedMs ?? '<undefined>'} rowCount=${rowCount} hasMoreRows=${hasMoreRows} sessionId=${sessionId ?? '<none>'}`);
                return {
                    id: id ?? `${started}-${Math.random().toString(36).slice(2, 8)}`,
                    command,
                    mode,
                    startedAt,
                    elapsedMs: executionElapsedMs,
                    outcome: 'success',
                    messages: [{
                        ordinalPosition: 1,
                        messageId: 'SQL0000',
                        severity: 0,
                        type: 'INFO',
                        text: sqlSummaryText,
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
                        resultTitle: options?.resultTitle,
                        elapsedMs: queryElapsedMs
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
