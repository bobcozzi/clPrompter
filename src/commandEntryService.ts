import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import * as vscode from 'vscode';
import { CommandExecution, CommandExecutionMode, determineOutcome, mapCommandMessages } from './commandEntryModel';
import { getUDTFLibrary } from './components/hostFunctions';
import { CommandEntryJobManager } from './commandEntryJobManager';
import { runUserSql } from './tools';

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
    columns: string[];
    nextOffset: number;
    fetchSize: number;
    prefetchSize: number;
    hasMoreRows: boolean;
    createdAt: number;
    lastUsedAt: number;
}

export const CMD_RUN_SQL = `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(sqltools.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;

function buildCmdRunSql(library: string): string {
    return `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(${library}.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;
}

/** Validates the qualified-job format accepted by QSYS2.CANCEL_SQL. */
export function normalizeSqlJobId(jobId: string | undefined): string | undefined {
    const normalized = jobId?.trim().toUpperCase();
    return normalized && /^\d{6}\/[A-Z0-9#$@]{1,10}\/[A-Z0-9#$@]{1,10}$/.test(normalized)
        ? normalized
        : undefined;
}

/** CL sent through the connection's existing SSH/ILE command facility. */
export function buildCancelSqlJobCommand(jobId: string): string {
    const sqlCall = `CALL QSYS2.CANCEL_SQL(''${jobId}'')`;
    const runSql = `RUNSQL SQL('${sqlCall}') COMMIT(*NONE) NAMING(*SYS)`;
    const submitJobCmd = [
        `SBMJOB CMD(${runSql}) `,
        'JOB(C4I_ENDRQS) JOBQ(QUSRNOMAX)',
        'LOG(4 0 *SECLVL) LOGCLPGM(*YES) LOGOUTPUT(*JOBEND)'
    ].join(' ');
    console.log(`Cancel Request: ${submitJobCmd}\n`);
    return submitJobCmd;
}

function extractSqlStatement(command: string): string | undefined {
    const match = String(command).match(/^\s*sql\s*:\s*([\s\S]*)$/i);
    if (!match) { return undefined; }
    const statement = (match[1] || '').trim();
    return statement || undefined;
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

function stripTrailingSemicolon(sql: string): string {
    return sql.replace(/;\s*$/, '').trim();
}

function isPagedQueryCandidate(sql: string): boolean {
    const normalized = stripTrailingSemicolon(sql).toUpperCase();
    return normalized.startsWith('SELECT ') || normalized.startsWith('WITH ');
}

function buildPagedSql(sql: string, offset: number, fetchRows: number): string {
    const baseSql = stripTrailingSemicolon(sql);
    return `SELECT * FROM (${baseSql}) CLPROMPTER_PAGE OFFSET ${offset} ROWS FETCH NEXT ${fetchRows} ROWS ONLY`;
}

function resolveConfiguredSqlFetchLimit(): number {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const enabled = config.get<boolean>('commandEntrySqlFetchLimitEnabled', true);
    if (!enabled) {
        return NOMAX_SENTINEL;
    }

    const configuredRows = config.get<number>('commandEntrySqlFetchLimitRows', DEFAULT_SQL_RESULT_ROWS);
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
    const configuredRows = config.get<number>('commandEntrySqlPrefetchRows', SCROLL_PREFETCH_ROWS);
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
    ): Promise<Record<string, unknown>[]> {
        if (this.jobManager) {
            return this.jobManager.runSQL(connection, statement, { rows });
        }

        const result = await connection.runSQL(statement, rows ? { rows } : undefined);
        return result as Record<string, unknown>[];
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

    private async runDedicatedSqlWithPaging(connection: IBMi, sqlStatement: string, maxRows: number): Promise<Record<string, unknown>[]> {
        if (!this.jobManager) {
            return this.runSqlRows(connection, sqlStatement, maxRows === NOMAX_SENTINEL ? undefined : maxRows);
        }

        const statement = stripTrailingSemicolon(sqlStatement);
        if (!isPagedQueryCandidate(statement)) {
            return maxRows === NOMAX_SENTINEL
                ? this.jobManager.runSQL(connection, statement)
                : this.jobManager.runSQL(connection, statement, { rows: maxRows });
        }

        const rows: Record<string, unknown>[] = [];
        let offset = 0;
        const unlimited = maxRows === NOMAX_SENTINEL;

        while (unlimited || rows.length < maxRows) {
            const fetchRows = unlimited
                ? DEDICATED_SQL_PAGE_SIZE
                : Math.min(DEDICATED_SQL_PAGE_SIZE, maxRows - rows.length);
            const pageSql = buildPagedSql(statement, offset, fetchRows);
            const pageRows = await this.jobManager.runSQL(connection, pageSql, { rows: fetchRows });
            rows.push(...pageRows);

            if (pageRows.length < fetchRows) {
                break;
            }

            offset += pageRows.length;
        }

        return rows;
    }

    private async fetchSqlPage(
        connection: IBMi,
        sqlStatement: string,
        offset: number,
        fetchRows: number
    ): Promise<Record<string, unknown>[]> {
        const pageSql = buildPagedSql(sqlStatement, offset, fetchRows);
        return this.runSqlRows(connection, pageSql, fetchRows);
    }

    private async fetchSqlChunk(
        connection: IBMi,
        sqlStatement: string,
        offset: number,
        chunkRows: number
    ): Promise<Record<string, unknown>[]> {
        if (chunkRows <= 0) {
            return [];
        }

        const rows: Record<string, unknown>[] = [];
        let localOffset = offset;

        while (rows.length < chunkRows) {
            const remaining = chunkRows - rows.length;
            const backendRows = this.getBackendFetchSize(remaining);
            if (backendRows <= 0) {
                break;
            }

            const pageRows = await this.fetchSqlPage(connection, sqlStatement, localOffset, backendRows);
            if (pageRows.length === 0) {
                break;
            }

            rows.push(...pageRows);
            localOffset += pageRows.length;

            if (pageRows.length < backendRows) {
                break;
            }
        }

        return rows;
    }

    private async detectMoreRows(connection: IBMi, sqlStatement: string, offset: number): Promise<boolean> {
        const probeRows = await this.fetchSqlPage(connection, sqlStatement, offset, 1);
        return probeRows.length > 0;
    }

    private buildSqlResultPayload(
        statement: string,
        rows: Record<string, unknown>[],
        options?: { sessionId?: string; hasMoreRows?: boolean; fetchSize?: number; prefetchSize?: number }
    ) {
        const columns = deriveSqlColumns(rows);
        return {
            statement,
            columns,
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
            const pageRows = await this.fetchSqlChunk(connection, session.statement, session.nextOffset, effectiveFetchSize);
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
                const payload = this.buildSqlResultPayload(session.statement, session.rows, {
                    sessionId: undefined,
                    hasMoreRows: false,
                    fetchSize: session.fetchSize,
                    prefetchSize: session.prefetchSize
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
        const payload = this.buildSqlResultPayload(session.statement, session.rows, {
            sessionId: hasMoreRows ? session.id : undefined,
            hasMoreRows,
            fetchSize: session.fetchSize,
            prefetchSize: session.prefetchSize
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

                if (!isPagedQueryCandidate(normalizedSql) || unlimited) {
                    rows = this.jobManager
                        ? await this.runDedicatedSqlWithPaging(connection, normalizedSql, maxRows)
                        : (await runUserSql<Record<string, unknown>>(connection, normalizedSql)).rows;
                } else {
                    const prefetchSize = Math.min(maxRows, prefetchRows);
                    rows = await this.fetchSqlChunk(connection, normalizedSql, 0, prefetchSize);
                    if (rows.length === prefetchSize) {
                        hasMoreRows = await this.detectMoreRows(connection, normalizedSql, rows.length);
                    }

                    if (hasMoreRows) {
                        const session: SqlPagingSession = {
                            id: this.createSessionId(),
                            connectionKey: this.buildConnectionKey(connection),
                            statement: normalizedSql,
                            rows: [...rows],
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
                                ? `${rowCount} ${rowLabel} returned (prefetched ${rowCount}; load-more chunk ${maxRows})`
                                : `${rowCount} ${rowLabel} returned (chunk ${maxRows})`,
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
                    sqlResult: this.buildSqlResultPayload(normalizedSql, rows, {
                        sessionId,
                        hasMoreRows,
                        fetchSize: unlimited ? undefined : maxRows,
                        prefetchSize: unlimited ? undefined : Math.min(maxRows, prefetchRows)
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
