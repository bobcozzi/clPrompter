import * as vscode from 'vscode';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { CommandEntryJobManager, DedicatedJobState } from './commandEntryJobManager';
import { CommandEntryService } from './commandEntryService';
import { CommandExecution, CommandExecutionMode, SqlResultPayload } from './commandEntryModel';

export interface MultiSqlJobRunSqlOptions {
    bindings?: unknown[];
    rows?: number;
}

export interface MultiSqlJobApiV1 {
    readonly apiVersion: '1.0.0';
    isDedicatedModeEnabled(): boolean;
    getJobState(): DedicatedJobState;
    ensureDedicatedJob(): Promise<string | undefined>;
    restartDedicatedJob(): Promise<string | undefined>;
    cancelDedicatedJobSql(): Promise<void>;
    runSql(statements: string | string[], options?: MultiSqlJobRunSqlOptions): Promise<Record<string, unknown>[]>;
    executeCommandEntry(command: string, mode: CommandExecutionMode, executionId?: string): Promise<CommandExecution>;
    closeSqlSession(sessionId?: string): Promise<void>;
    loadMoreSql(sessionId: string, fetchAll?: boolean, fetchRowsOverride?: number): Promise<SqlResultPayload>;
    getConfiguredPrefetchRows(): number;
}

function connectionUnavailableError(): Error {
    return new Error('No active IBM i connection, or the SQL runner is unavailable.');
}

export function createMultiSqlJobApi(
    getConnection: () => IBMi | undefined,
    jobManager: CommandEntryJobManager,
    service: CommandEntryService,
    output?: vscode.OutputChannel
): MultiSqlJobApiV1 {
    const requireConnection = (): IBMi => {
        const connection = getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            throw connectionUnavailableError();
        }
        return connection;
    };

    return {
        apiVersion: '1.0.0',

        isDedicatedModeEnabled(): boolean {
            return jobManager.isDedicatedEnabled();
        },

        getJobState(): DedicatedJobState {
            return jobManager.getState(getConnection());
        },

        async ensureDedicatedJob(): Promise<string | undefined> {
            const connection = requireConnection();
            const jobId = await jobManager.ensureDedicatedJob(connection);
            output?.appendLine(`[Command Entry API] ensureDedicatedJob -> ${jobId || '<none>'}`);
            return jobId;
        },

        async restartDedicatedJob(): Promise<string | undefined> {
            const connection = requireConnection();
            const jobId = await jobManager.restartJob(connection);
            output?.appendLine(`[Command Entry API] restartDedicatedJob -> ${jobId || '<none>'}`);
            return jobId;
        },

        async cancelDedicatedJobSql(): Promise<void> {
            const connection = requireConnection();
            await jobManager.cancelActive(connection);
            output?.appendLine('[Command Entry API] cancelDedicatedJobSql requested.');
        },

        async runSql(
            statements: string | string[],
            options?: MultiSqlJobRunSqlOptions
        ): Promise<Record<string, unknown>[]> {
            const connection = requireConnection();
            return jobManager.runSQL(connection, statements, options);
        },

        async executeCommandEntry(
            command: string,
            mode: CommandExecutionMode,
            executionId?: string
        ): Promise<CommandExecution> {
            const connection = requireConnection();
            return service.execute(connection, command, mode, executionId);
        },

        async closeSqlSession(sessionId?: string): Promise<void> {
            await service.closeSqlSession(sessionId);
        },

        async loadMoreSql(
            sessionId: string,
            fetchAll = false,
            fetchRowsOverride?: number
        ): Promise<SqlResultPayload> {
            const connection = requireConnection();
            return service.loadMoreSql(connection, sessionId, fetchAll, fetchRowsOverride);
        },

        getConfiguredPrefetchRows(): number {
            return service.getConfiguredPrefetchRows();
        }
    };
}
