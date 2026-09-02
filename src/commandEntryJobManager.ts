import * as vscode from 'vscode';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

function normalizeSqlJobId(jobId: string | undefined): string | undefined {
    const normalized = jobId?.trim().toUpperCase();
    return normalized && /^\d{6}\/[A-Z0-9#$@]{1,10}\/[A-Z0-9#$@]{1,10}$/.test(normalized)
        ? normalized
        : undefined;
}

/** Escape a value for safe insertion into SQL string (for bindings not supported by Mapepire). */
function escapeSqlValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (typeof value === 'string') {
        // Escape single quotes by doubling them (SQL standard)
        return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    // For other types, convert to string and escape
    return `'${String(value).replace(/'/g, "''")}'`;
}

/** Substitute bindings into SQL statement with ? placeholders. */
function substituteBindings(sql: string, bindings?: unknown[]): string {
    if (!bindings || bindings.length === 0) {
        return sql;
    }
    let result = sql;
    for (const binding of bindings) {
        result = result.replace('?', escapeSqlValue(binding));
    }
    return result;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function buildCancelSqlJobCommand(jobId: string): string {
    // Use double quotes around the entire CL command to protect special characters
    // Escape any internal double quotes
    const escapedJobId = jobId.replace(/"/g, '\\"');
    const sqlCall = `CALL QSYS2.CANCEL_SQL('${escapedJobId}')`;
    const runSql = `RUNSQL SQL('${sqlCall}') COMMIT(*NONE) NAMING(*SYS)`;
    const submitJobCmd = [
        `SBMJOB CMD(${runSql})`,
        'JOB(CLP_ENDRQS) JOBQ(QUSRNOMAX)',
        'LOG(4 0 *SECLVL) LOGCLPGM(*YES) LOGOUTPUT(*JOBEND)'
    ].join(' ');
    return submitJobCmd;
}

type SqlJobLike = {
    execute: (statements: string | string[], bindings?: unknown[]) => Promise<Record<string, unknown>[]>;
    getJobId?: () => string | undefined;
    close?: () => Promise<void> | void;
    end?: () => Promise<void> | void;
    dispose?: () => Promise<void> | void;
};

type MapepireLike = {
    newJob: (connection: IBMi, options?: { jdbc?: unknown; javaPath?: string }) => Promise<SqlJobLike>;
};

export interface DedicatedJobState {
    enabled: boolean;
    jobId?: string;
    status: 'ready' | 'busy' | 'ended';
}

export class CommandEntryJobManager {
    private job: SqlJobLike | undefined;
    private connectionKey: string | undefined;
    private dedicatedJobId: string | undefined;
    private status: DedicatedJobState['status'] = 'ended';

    constructor(private readonly output?: vscode.OutputChannel) { }

    isDedicatedEnabled(): boolean {
        return vscode.workspace.getConfiguration('clPrompter').get<boolean>('commandEntryUseDedicatedJob', false);
    }

    getState(connection?: IBMi): DedicatedJobState {
        if (!this.isDedicatedEnabled()) {
            const sharedJobId = normalizeSqlJobId(connection?.getSqlJobId());
            return { enabled: false, jobId: sharedJobId, status: 'ready' };
        }

        return {
            enabled: true,
            jobId: this.dedicatedJobId,
            status: this.status
        };
    }

    getDisplayJobId(connection?: IBMi): string | undefined {
        return this.getState(connection).jobId;
    }

    async runSQL(
        connection: IBMi,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number }
    ): Promise<Record<string, unknown>[]> {
        if (!this.isDedicatedEnabled()) {
            return connection.runSQL(statements, {
                bindings: options?.bindings as never[] | undefined,
                rows: options?.rows
            }) as Promise<Record<string, unknown>[]>;
        }

        await this.ensureJob(connection);
        const job = this.job;
        if (!job) {
            throw new Error('Unable to create a dedicated CLPROMPTER SQL job.');
        }

        this.status = 'busy';
        try {
            // Mapepire's job.execute() may not support JDBC parameterized queries (? placeholders).
            // If bindings are provided, substitute them directly into the SQL string.
            const sqlWithBindings = Array.isArray(statements)
                ? statements.map(stmt => substituteBindings(stmt, options?.bindings))
                : substituteBindings(statements, options?.bindings);

            // Log the SQL and bindings for debugging
            const statementsStr = Array.isArray(sqlWithBindings)
                ? sqlWithBindings.join('; ')
                : sqlWithBindings;
            if (options?.bindings && options.bindings.length > 0) {
                this.output?.appendLine(`[Command Entry] Executing with substituted bindings: SQL=${statementsStr.substring(0, 150)}...`);
            }

            // Execute WITHOUT bindings parameter (since we substituted them above).
            // Some Mapepire builds support a rows hint; try common shapes and fallback.
            const execute = (job as any).execute.bind(job) as (...args: unknown[]) => Promise<unknown>;
            const requestedRows = options?.rows;
            let result: unknown;

            if (isPositiveInteger(requestedRows)) {
                this.output?.appendLine(`[Command Entry] Requesting up to ${requestedRows} SQL rows from dedicated job.`);
                try {
                    result = await execute(sqlWithBindings, { rows: requestedRows });
                } catch {
                    try {
                        result = await execute(sqlWithBindings, undefined, requestedRows);
                    } catch {
                        result = await execute(sqlWithBindings);
                    }
                }
            } else {
                result = await execute(sqlWithBindings);
            }

            // If result is already an array, return it
            if (Array.isArray(result)) {
                this.output?.appendLine(`[Command Entry] job.execute() returned array with ${result.length} rows`);
                return result;
            }

            // Mapepire result object structure:
            // { id, has_results, update_count, metadata, data, is_done, success, execution_time, ...methods }
            if (result && typeof result === 'object') {
                // Check for .data property (Mapepire's standard result format)
                if ('data' in result && Array.isArray((result as any).data)) {
                    const rows = (result as any).data;
                    this.output?.appendLine(`[Command Entry] job.execute() returned object with .data array containing ${rows.length} rows`);
                    return rows;
                }

                // Check for .rows property (alternative format)
                if ('rows' in result && Array.isArray((result as any).rows)) {
                    const rows = (result as any).rows;
                    this.output?.appendLine(`[Command Entry] job.execute() returned object with .rows array containing ${rows.length} rows`);
                    return rows;
                }

                // Check for .fetchAll() method
                if ('fetchAll' in result && typeof (result as any).fetchAll === 'function') {
                    try {
                        const rows = await (result as any).fetchAll();
                        if (Array.isArray(rows)) {
                            this.output?.appendLine(`[Command Entry] job.execute() result.fetchAll() returned ${rows.length} rows`);
                            return rows;
                        }
                    } catch (e) {
                        this.output?.appendLine(`[Command Entry] result.fetchAll() failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }

                // Check for .getRows() method
                if ('getRows' in result && typeof (result as any).getRows === 'function') {
                    try {
                        const rows = await (result as any).getRows();
                        if (Array.isArray(rows)) {
                            this.output?.appendLine(`[Command Entry] job.execute() result.getRows() returned ${rows.length} rows`);
                            return rows;
                        }
                    } catch (e) {
                        this.output?.appendLine(`[Command Entry] result.getRows() failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }

                // Log the actual structure for debugging
                const resultKeys = Object.keys(result);
                const resultMethods = resultKeys.filter(k => typeof (result as any)[k] === 'function');
                this.output?.appendLine(`[Command Entry] job.execute() result has keys: ${resultKeys.join(', ')}`);
                if (resultMethods.length > 0) {
                    this.output?.appendLine(`[Command Entry] job.execute() result has methods: ${resultMethods.join(', ')}`);
                }
            }

            // Return empty array as fallback
            this.output?.appendLine(`[Command Entry] WARNING: Could not extract rows from result`);
            return [];
        } catch (error) {
            this.output?.appendLine(`[Command Entry] SQL execution failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        } finally {
            this.status = this.job ? 'ready' : 'ended';
        }
    }

    async restartJob(connection: IBMi): Promise<string | undefined> {
        if (!this.isDedicatedEnabled()) {
            return normalizeSqlJobId(connection.getSqlJobId());
        }

        await this.cancelActive(connection);
        await this.endDedicatedJob();
        await this.ensureJob(connection);
        return this.dedicatedJobId;
    }

    async cancelActive(connection: IBMi): Promise<void> {
        if (!this.isDedicatedEnabled()) {
            return;
        }

        const sqlJobId = normalizeSqlJobId(this.dedicatedJobId);
        if (!sqlJobId) {
            return;
        }

        const cancelCommand = buildCancelSqlJobCommand(sqlJobId);
        this.output?.appendLine(`[Command Entry] Requesting cancel for dedicated SQL job ${sqlJobId}.`);
        const result = await connection.sendCommand({ command: cancelCommand });
        this.output?.appendLine(`[Command Entry] Dedicated cancel completed with code ${result.code}. stdout=${result.stdout || '<empty>'}; stderr=${result.stderr || '<empty>'}`);
    }

    async dispose(): Promise<void> {
        await this.endDedicatedJob();
    }

    private async ensureJob(connection: IBMi): Promise<void> {
        const key = this.buildConnectionKey(connection);
        if (this.job && this.connectionKey === key) {
            this.output?.appendLine(`[Command Entry] Reusing existing dedicated SQL job`);
            this.status = 'ready';
            return;
        }

        this.output?.appendLine(`[Command Entry] Creating new dedicated SQL job...`);
        await this.endDedicatedJob();

        this.output?.appendLine(`[Command Entry] Getting Mapepire component from connection...`);
        const mapepire = await connection.getComponent('mapepire', { ignoreState: true }) as unknown as MapepireLike | undefined;
        if (!mapepire) {
            throw new Error('Code for IBM i Mapepire component is unavailable for dedicated CLPROMPTER job mode.');
        }

        this.output?.appendLine(`[Command Entry] Creating new Mapepire job...`);
        const jdbc = connection.getSqlJobJDBCOptions();
        this.job = await mapepire.newJob(connection, { jdbc });
        this.connectionKey = key;
        this.status = 'ready';

        this.output?.appendLine(`[Command Entry] Reading dedicated SQL job ID...`);
        this.dedicatedJobId = await this.readDedicatedJobId(connection);
        this.output?.appendLine(`[Command Entry] Started dedicated SQL job ${this.dedicatedJobId || '<unknown>'}.`);
    }

    private async readDedicatedJobId(connection: IBMi): Promise<string | undefined> {
        if (!this.job) {
            return undefined;
        }

        try {
            // Tier 1: Check for properties on the job object
            this.output?.appendLine(`[Command Entry] Checking Mapepire job object for ID properties...`);
            const jobProperties = ['jobId', 'id', 'getId', 'getJobId', 'jobName', 'jobinfo'];
            for (const prop of jobProperties) {
                if (prop in this.job) {
                    const value = (this.job as any)[prop];
                    this.output?.appendLine(`[Command Entry] Job.${prop} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                    if (typeof value === 'string') {
                        const normalized = normalizeSqlJobId(value);
                        if (normalized) {
                            this.output?.appendLine(`[Command Entry] Dedicated SQL job ID from Job.${prop}: ${normalized}`);
                            return normalized;
                        }
                    } else if (typeof value === 'function') {
                        try {
                            const result = await value.call(this.job);
                            this.output?.appendLine(`[Command Entry] Job.${prop}() returned: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
                            const normalized = normalizeSqlJobId(result);
                            if (normalized) {
                                this.output?.appendLine(`[Command Entry] Dedicated SQL job ID from Job.${prop}(): ${normalized}`);
                                return normalized;
                            }
                        } catch (e) {
                            this.output?.appendLine(`[Command Entry] Job.${prop}() threw: ${e instanceof Error ? e.message : String(e)}`);
                        }
                    }
                }
            }

            // Tier 2: Try multiple SQL queries with different approaches
            const sqlQueries = [
                'SELECT CONCAT(JOB_NUMBER,\'/\',JOB_USER,\'/\',JOB_NAME) AS JOB_ID FROM TABLE(QSYS2.JOB_INFO())',
                'SELECT CONCAT(JOB_NUMBER,\'/\',JOB_USER,\'/\',JOB_NAME) AS JOB_ID FROM TABLE(QSYS2.JOB_INFO()) WHERE JOB_STATUS=\'ACTIVE\' FETCH FIRST 1 ROW ONLY',
                'SELECT DISTINCT CAST(QSYS2.JOB_NAME AS VARCHAR(32)) AS JOB_ID FROM SYSIBM.SYSDUMMY1'
            ];

            for (const query of sqlQueries) {
                try {
                    this.output?.appendLine(`[Command Entry] Trying SQL query: ${query}`);
                    const rows = await this.job.execute(query);
                    const row = rows?.[0];
                    if (row) {
                        const value = row.JOB_ID ?? row.JOB_NAME ?? Object.values(row)[0];
                        this.output?.appendLine(`[Command Entry] Query returned: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                        const normalized = normalizeSqlJobId(value == null ? undefined : String(value));
                        if (normalized) {
                            this.output?.appendLine(`[Command Entry] Dedicated SQL job ID from SQL: ${normalized}`);
                            return normalized;
                        }
                    } else {
                        this.output?.appendLine(`[Command Entry] Query returned no rows`);
                    }
                } catch (e) {
                    this.output?.appendLine(`[Command Entry] Query failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            this.output?.appendLine(`[Command Entry] All attempts to retrieve dedicated SQL job ID failed`);
            return undefined;
        } catch (error) {
            this.output?.appendLine(`[Command Entry] Unexpected error reading dedicated SQL job ID: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    private async endDedicatedJob(): Promise<void> {
        if (!this.job) {
            this.status = 'ended';
            this.dedicatedJobId = undefined;
            this.connectionKey = undefined;
            return;
        }

        const jobToClose = this.job;
        this.job = undefined;
        this.status = 'ended';
        this.dedicatedJobId = undefined;
        this.connectionKey = undefined;

        try {
            if (typeof jobToClose.close === 'function') {
                await jobToClose.close();
                return;
            }
            if (typeof jobToClose.end === 'function') {
                await jobToClose.end();
                return;
            }
            if (typeof jobToClose.dispose === 'function') {
                await jobToClose.dispose();
            }
        } catch (error) {
            this.output?.appendLine(`[Command Entry] Failed to close dedicated SQL job cleanly: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private buildConnectionKey(connection: IBMi): string {
        return `${connection.currentConnectionName}|${connection.currentUser}|${connection.currentHost}|${connection.currentPort}`;
    }
}
