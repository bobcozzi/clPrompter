import * as vscode from 'vscode';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

function isCommandEntryDebugLoggingEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const current = config.get<boolean | undefined>('cmdEntryDebugLogging');
    if (current !== undefined) {
        return current;
    }
    const previous = config.get<boolean | undefined>('cmdEntryVerboseLogging');
    if (previous !== undefined) {
        return previous;
    }
    return config.get<boolean>('commandEntryVerboseLogging', false);
}

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

const CANCEL_SQL_STATEMENT = 'CALL QSYS2.CANCEL_SQL(?)';

let connectionObjectSequence = 0;
const connectionObjectIds = new WeakMap<object, number>();
let genericObjectSequence = 0;
const genericObjectIds = new WeakMap<object, number>();

function getConnectionObjectId(connection: IBMi): number {
    const objectRef = connection as unknown as object;
    let id = connectionObjectIds.get(objectRef);
    if (!id) {
        connectionObjectSequence += 1;
        id = connectionObjectSequence;
        connectionObjectIds.set(objectRef, id);
    }
    return id;
}

function getGenericObjectId(value: unknown): number | undefined {
    if (!value || typeof value !== 'object') {
        return undefined;
    }

    const objectRef = value as object;
    let id = genericObjectIds.get(objectRef);
    if (!id) {
        genericObjectSequence += 1;
        id = genericObjectSequence;
        genericObjectIds.set(objectRef, id);
    }
    return id;
}

function getSharedSqlJobStatus(connection: IBMi): string | undefined {
    const status = (connection as any).sqlJob?.getStatus?.();
    return typeof status === 'string' ? status : undefined;
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
    private readonly observedSharedJobIds = new Map<string, string | undefined>();
    private readonly startupReconnectCompleted = new Set<string>();
    private status: DedicatedJobState['status'] = 'ended';

    constructor(private readonly output?: vscode.OutputChannel) { }

    private debugLog(message: string): void {
        if (isCommandEntryDebugLoggingEnabled()) {
            this.output?.appendLine(message);
        }
    }

    private canUseDedicatedForConnection(connection?: IBMi): boolean {
        return this.isDedicatedEnabled();
    }

    private logRouteSnapshot(
        phase: string,
        connection: IBMi,
        extra?: string
    ): void {
        if (!isCommandEntryDebugLoggingEnabled()) {
            return;
        }
        const connectionKey = this.buildConnectionKey(connection);
        const rawSharedJobId = connection.getSqlJobId() ?? '<none>';
        const sharedJobId = normalizeSqlJobId(connection.getSqlJobId()) ?? '<none>';
        const observedSharedJobId = this.observedSharedJobIds.get(connectionKey) ?? '<none>';
        const dedicatedJobId = this.dedicatedJobId ?? '<none>';
        const objectId = getConnectionObjectId(connection);
        const sharedSqlJobObjectId = getGenericObjectId((connection as any).sqlJob) ?? '<none>';
        const serverEnabled = this.isRemoteMapepireServerEnabled(connection);
        const dedicatedEnabled = this.isDedicatedEnabled();
        const sharedSqlJobStatus = getSharedSqlJobStatus(connection) ?? '<unknown>';
        this.output?.appendLine(
            `[Command Entry][JobRoute] ${phase} connObj=${objectId} key=${connectionKey} dedicatedEnabled=${dedicatedEnabled} serverEnabled=${serverEnabled} sharedSqlJobObj=${sharedSqlJobObjectId} sharedJobStatus=${sharedSqlJobStatus} sharedJobId=${sharedJobId} sharedJobIdRaw=${rawSharedJobId} observedSharedJobId=${observedSharedJobId} dedicatedJobId=${dedicatedJobId} status=${this.status}${extra ? ` ${extra}` : ''}`
        );
    }

    private observeSharedJobId(connection: IBMi, reason: string): void {
        const key = this.buildConnectionKey(connection);
        const observed = normalizeSqlJobId(connection.getSqlJobId());
        const previous = this.observedSharedJobIds.get(key);
        this.observedSharedJobIds.set(key, observed);
        if (observed !== previous && isCommandEntryDebugLoggingEnabled()) {
            this.output?.appendLine(`[Command Entry][JobRoute] observed shared job ID changed (${reason}) ${previous ?? '<none>'} -> ${observed ?? '<none>'}`);
        }
    }

    private getObservedSharedJobId(connection?: IBMi): string | undefined {
        if (!connection) {
            return undefined;
        }
        return this.observedSharedJobIds.get(this.buildConnectionKey(connection));
    }

    isDedicatedEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const useShared = config.get<boolean | undefined>('cmdEntryUseSharedSQLJob');
        if (useShared !== undefined) {
            return !useShared;
        }
        const current = config.get<boolean | undefined>('cmdEntryUseDedicatedJob');
        if (current !== undefined) {
            return current;
        }
        return config.get<boolean>('commandEntryUseDedicatedJob', false);
    }

    hasActiveDedicatedJob(connection?: IBMi): boolean {
        if (!connection || !this.job || !this.connectionKey) {
            return false;
        }
        return this.connectionKey === this.buildConnectionKey(connection) && this.status !== 'ended';
    }

    getState(connection?: IBMi): DedicatedJobState {
        if (!this.isDedicatedEnabled()) {
            const sharedJobId = this.getObservedSharedJobId(connection) ?? normalizeSqlJobId(connection?.getSqlJobId());
            return { enabled: false, jobId: sharedJobId, status: 'ready' };
        }

        if (!this.canUseDedicatedForConnection(connection)) {
            if (connection) {
                this.logRouteSnapshot('getState.shared.serverDisabled', connection);
            }
            const sharedJobId = this.getObservedSharedJobId(connection) ?? normalizeSqlJobId(connection?.getSqlJobId());
            return { enabled: true, jobId: sharedJobId, status: 'ready' };
        }

        return {
            enabled: true,
            jobId: this.dedicatedJobId,
            status: this.dedicatedJobId ? this.status : 'ended'
        };
    }

    getDisplayJobId(connection?: IBMi): string | undefined {
        return this.getState(connection).jobId;
    }

    private rowsFromExecutionResult(result: unknown): Record<string, unknown>[] {
        if (Array.isArray(result)) {
            this.debugLog(`[Command Entry] job.execute() returned array with ${result.length} rows`);
            return result as Record<string, unknown>[];
        }

        if (result && typeof result === 'object') {
            if ('data' in result && Array.isArray((result as any).data)) {
                const rows = (result as any).data;
                this.debugLog(`[Command Entry] job.execute() returned object with .data array containing ${rows.length} rows`);
                return rows as Record<string, unknown>[];
            }

            if ('rows' in result && Array.isArray((result as any).rows)) {
                const rows = (result as any).rows;
                this.debugLog(`[Command Entry] job.execute() returned object with .rows array containing ${rows.length} rows`);
                return rows as Record<string, unknown>[];
            }
        }

        return [];
    }

    private async executeDedicatedSql(
        job: SqlJobLike,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number }
    ): Promise<unknown> {
        const sqlWithBindings = Array.isArray(statements)
            ? statements.map(stmt => substituteBindings(stmt, options?.bindings))
            : substituteBindings(statements, options?.bindings);

        const statementsStr = Array.isArray(sqlWithBindings)
            ? sqlWithBindings.join('; ')
            : sqlWithBindings;
        if (options?.bindings && options.bindings.length > 0) {
            this.debugLog(`[Command Entry] Executing with substituted bindings: SQL=${statementsStr.substring(0, 150)}...`);
        }

        const execute = (job as any).execute.bind(job) as (...args: unknown[]) => Promise<unknown>;
        const requestedRows = options?.rows;
        if (isPositiveInteger(requestedRows)) {
            this.debugLog(`[Command Entry] Requesting up to ${requestedRows} SQL rows from dedicated job.`);
            try {
                return await execute(sqlWithBindings, { rows: requestedRows });
            } catch {
                try {
                    return await execute(sqlWithBindings, undefined, requestedRows);
                } catch {
                    return await execute(sqlWithBindings);
                }
            }
        }

        return execute(sqlWithBindings);
    }

    async runSQLWithDetails(
        connection: IBMi,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number }
    ): Promise<{ rows: Record<string, unknown>[]; rawResult?: unknown }> {
        this.logRouteSnapshot('runSQL.enter', connection, `rows=${options?.rows ?? '<none>'}`);

        const runOnSharedJob = async (reason: string): Promise<{ rows: Record<string, unknown>[]; rawResult?: unknown }> => {
            try {
                const sharedResult = await connection.runSQL(statements, {
                    bindings: options?.bindings as never[] | undefined,
                    rows: options?.rows
                });
                return { rows: sharedResult as unknown as Record<string, unknown>[], rawResult: sharedResult };
            } finally {
                this.observeSharedJobId(connection, reason);
            }
        };

        if (!this.canUseDedicatedForConnection(connection)) {
            this.logRouteSnapshot('runSQL.route.shared.dedicatedDisabled', connection);
            if (this.job) {
                this.logRouteSnapshot('runSQL.route.shared.cleanupDedicated.beforeEnd', connection);
                await this.endDedicatedJob();
                this.logRouteSnapshot('runSQL.route.shared.cleanupDedicated.afterEnd', connection);
            }
            return runOnSharedJob('sharedOnlyMode');
        }

        try {
            await this.ensureJob(connection);
        } catch (error) {
            this.output?.appendLine(`[Command Entry] Dedicated job is unavailable (${error instanceof Error ? error.message : String(error)}). Falling back to shared SQL job.`);
            this.status = 'ended';
            this.dedicatedJobId = undefined;
            this.connectionKey = undefined;
            this.logRouteSnapshot('runSQL.route.shared.ensureFailed', connection);
            return runOnSharedJob('ensureFailed');
        }

        const job = this.job;
        if (!job) {
            this.output?.appendLine('[Command Entry] Dedicated job handle missing. Falling back to shared SQL job.');
            this.logRouteSnapshot('runSQL.route.shared.noDedicatedHandle', connection);
            return runOnSharedJob('noDedicatedHandle');
        }

        this.logRouteSnapshot('runSQL.route.dedicated', connection);

        this.status = 'busy';
        try {
            const result = await this.executeDedicatedSql(job, statements, options);
            const rows = this.rowsFromExecutionResult(result);

            if (rows.length === 0 && result && typeof result === 'object') {
                if ('fetchAll' in result && typeof (result as any).fetchAll === 'function') {
                    try {
                        const fetched = await (result as any).fetchAll();
                        if (Array.isArray(fetched)) {
                            this.debugLog(`[Command Entry] job.execute() result.fetchAll() returned ${fetched.length} rows`);
                            return { rows: fetched as Record<string, unknown>[], rawResult: result };
                        }
                    } catch (e) {
                        this.debugLog(`[Command Entry] result.fetchAll() failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }

                if ('getRows' in result && typeof (result as any).getRows === 'function') {
                    try {
                        const fetched = await (result as any).getRows();
                        if (Array.isArray(fetched)) {
                            this.debugLog(`[Command Entry] job.execute() result.getRows() returned ${fetched.length} rows`);
                            return { rows: fetched as Record<string, unknown>[], rawResult: result };
                        }
                    } catch (e) {
                        this.debugLog(`[Command Entry] result.getRows() failed: ${e instanceof Error ? e.message : String(e)}`);
                    }
                }

                const resultKeys = Object.keys(result);
                const resultMethods = resultKeys.filter(k => typeof (result as any)[k] === 'function');
                this.debugLog(`[Command Entry] job.execute() result has keys: ${resultKeys.join(', ')}`);
                if (resultMethods.length > 0) {
                    this.debugLog(`[Command Entry] job.execute() result has methods: ${resultMethods.join(', ')}`);
                }
            }

            if (rows.length > 0) {
                return { rows, rawResult: result };
            }

            this.debugLog('[Command Entry] WARNING: Could not extract rows from result');
            return { rows: [], rawResult: result };
        } catch (error) {
            this.output?.appendLine(`[Command Entry] SQL execution failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        } finally {
            this.status = this.job ? 'ready' : 'ended';
            this.logRouteSnapshot('runSQL.exit', connection);
        }
    }

    async runSQL(
        connection: IBMi,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number }
    ): Promise<Record<string, unknown>[]> {
        const result = await this.runSQLWithDetails(connection, statements, options);
        return result.rows;
    }

    async restartJob(connection: IBMi): Promise<string | undefined> {
        this.logRouteSnapshot('restart.enter', connection);

        if (!this.canUseDedicatedForConnection(connection)) {
            this.logRouteSnapshot('restart.shared.sharedOnlyMode.beforeEnd', connection);
            if (this.job) {
                await this.endDedicatedJob();
            }
            this.logRouteSnapshot('restart.shared.sharedOnlyMode.afterEnd', connection);
            this.observeSharedJobId(connection, 'restartSharedOnlyMode');
            return normalizeSqlJobId(connection.getSqlJobId());
        }

        try {
            await this.cancelActive(connection);
            await this.endDedicatedJob();
            await this.ensureJob(connection);
            return this.dedicatedJobId;
        } catch (error) {
            this.output?.appendLine(`[Command Entry] Dedicated restart failed (${error instanceof Error ? error.message : String(error)}). Using shared SQL job.`);
            this.status = 'ended';
            this.dedicatedJobId = undefined;
            this.connectionKey = undefined;
            this.logRouteSnapshot('restart.shared.restartFailed', connection);
            return normalizeSqlJobId(connection.getSqlJobId());
        }
    }

    async ensureDedicatedJob(connection: IBMi): Promise<string | undefined> {
        this.logRouteSnapshot('ensure.enter', connection);

        if (!this.canUseDedicatedForConnection(connection)) {
            this.logRouteSnapshot('ensure.shared.sharedOnlyMode.beforeEnd', connection);
            if (this.job) {
                await this.endDedicatedJob();
            }
            this.logRouteSnapshot('ensure.shared.sharedOnlyMode.afterEnd', connection);
            this.observeSharedJobId(connection, 'ensureSharedOnlyMode');
            return normalizeSqlJobId(connection.getSqlJobId());
        }

        try {
            await this.ensureJob(connection);
            return this.dedicatedJobId;
        } catch (error) {
            this.output?.appendLine(`[Command Entry] Dedicated ensure failed (${error instanceof Error ? error.message : String(error)}). Using shared SQL job.`);
            this.status = 'ended';
            this.dedicatedJobId = undefined;
            this.connectionKey = undefined;
            this.logRouteSnapshot('ensure.shared.ensureFailed', connection);
            return normalizeSqlJobId(connection.getSqlJobId());
        }
    }

    async cancelActive(connection: IBMi): Promise<void> {
        if (!this.isDedicatedEnabled()) {
            return;
        }

        const sqlJobId = normalizeSqlJobId(this.dedicatedJobId);
        if (!sqlJobId) {
            return;
        }

        this.output?.appendLine(`[Command Entry] Requesting cancel for dedicated SQL job ${sqlJobId}.`);
        await connection.runSQL(CANCEL_SQL_STATEMENT, { bindings: [sqlJobId] });
        this.output?.appendLine(`[Command Entry] Dedicated cancel SQL request submitted for ${sqlJobId}.`);
    }

    async dispose(): Promise<void> {
        await this.endDedicatedJob();
    }

    isRemoteMapepireServerEnabled(connection?: IBMi): boolean {
        if (!connection) {
            return false;
        }
        return (connection as any).getConfig?.().mapepireUseServer === true;
    }

    private async ensureJob(connection: IBMi): Promise<void> {
        const key = this.buildConnectionKey(connection);
        if (this.job && this.connectionKey === key) {
            this.debugLog('[Command Entry] Reusing existing dedicated SQL job');
            this.status = 'ready';
            return;
        }

        this.debugLog('[Command Entry] Creating new dedicated SQL job...');
        await this.endDedicatedJob();
        await this.createDedicatedJob(connection, key);

        // In Mapepire server mode, a recycled host job may carry previous session state
        // (for example custom library list). Force one reconnect cycle per connection key
        // at first acquisition so startup behavior matches explicit "Reconnect Server Job".
        await this.maybeForceStartupReconnect(connection, key);
    }

    private async createDedicatedJob(connection: IBMi, key: string): Promise<void> {
        this.debugLog('[Command Entry] Getting Mapepire component from connection...');
        const mapepire = await connection.getComponent('mapepire', { ignoreState: true }) as unknown as MapepireLike | undefined;
        if (!mapepire) {
            throw new Error('Code for IBM i Mapepire component is unavailable for dedicated CLPROMPTER job mode.');
        }

        this.debugLog('[Command Entry] Creating new Mapepire job...');
        const jdbc = connection.getSqlJobJDBCOptions();
        this.job = await mapepire.newJob(connection, { jdbc });
        this.connectionKey = key;
        this.status = 'ready';

        this.debugLog('[Command Entry] Reading dedicated SQL job ID...');
        this.dedicatedJobId = await this.readDedicatedJobId(connection);
        this.output?.appendLine(`[Command Entry] Started dedicated SQL job ${this.dedicatedJobId || '<unknown>'}.`);
    }

    private async maybeForceStartupReconnect(connection: IBMi, key: string): Promise<void> {
        if (!this.isRemoteMapepireServerEnabled(connection)) {
            return;
        }

        if (this.startupReconnectCompleted.has(key)) {
            return;
        }

        this.startupReconnectCompleted.add(key);
        this.output?.appendLine('[Command Entry] Performing startup reconnect cycle for dedicated SQL job to reset host job environment.');

        try {
            await this.cancelActive(connection);
        } catch (error) {
            this.output?.appendLine(`[Command Entry] Startup reconnect cancel request failed (continuing): ${error instanceof Error ? error.message : String(error)}`);
        }

        await this.endDedicatedJob();
        await this.createDedicatedJob(connection, key);
        this.output?.appendLine('[Command Entry] Startup reconnect cycle complete. Dedicated SQL job environment reset.');
    }

    private async readDedicatedJobId(connection: IBMi): Promise<string | undefined> {
        if (!this.job) {
            return undefined;
        }

        try {
            // Tier 1: Check for properties on the job object
            this.debugLog('[Command Entry] Checking Mapepire job object for ID properties...');
            const jobProperties = ['jobId', 'id', 'getId', 'getJobId', 'jobName', 'jobinfo'];
            for (const prop of jobProperties) {
                if (prop in this.job) {
                    const value = (this.job as any)[prop];
                    this.debugLog(`[Command Entry] Job.${prop} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                    if (typeof value === 'string') {
                        const normalized = normalizeSqlJobId(value);
                        if (normalized) {
                            this.debugLog(`[Command Entry] Dedicated SQL job ID from Job.${prop}: ${normalized}`);
                            return normalized;
                        }
                    } else if (typeof value === 'function') {
                        try {
                            const result = await value.call(this.job);
                            this.debugLog(`[Command Entry] Job.${prop}() returned: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
                            const normalized = normalizeSqlJobId(result);
                            if (normalized) {
                                this.debugLog(`[Command Entry] Dedicated SQL job ID from Job.${prop}(): ${normalized}`);
                                return normalized;
                            }
                        } catch (e) {
                            this.debugLog(`[Command Entry] Job.${prop}() threw: ${e instanceof Error ? e.message : String(e)}`);
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
                    this.debugLog(`[Command Entry] Trying SQL query: ${query}`);
                    const rows = await this.job.execute(query);
                    const row = rows?.[0];
                    if (row) {
                        const value = row.JOB_ID ?? row.JOB_NAME ?? Object.values(row)[0];
                        this.debugLog(`[Command Entry] Query returned: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                        const normalized = normalizeSqlJobId(value == null ? undefined : String(value));
                        if (normalized) {
                            this.debugLog(`[Command Entry] Dedicated SQL job ID from SQL: ${normalized}`);
                            return normalized;
                        }
                    } else {
                        this.debugLog('[Command Entry] Query returned no rows');
                    }
                } catch (e) {
                    this.debugLog(`[Command Entry] Query failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            this.debugLog('[Command Entry] All attempts to retrieve dedicated SQL job ID failed');
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
