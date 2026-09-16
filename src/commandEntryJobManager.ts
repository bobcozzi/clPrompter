import * as vscode from 'vscode';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { buildStartupSqlForSessionOptions, getConnectionSqlSessionOptions, getConnectionSqlSettings, getDefaultConnectionSqlSettings } from './commandEntrySqlSettings';

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

function sharedSqlJobIdForDisplay(connection?: IBMi): string | undefined {
    if (!connection) {
        return undefined;
    }
    const raw = String(connection.getSqlJobId?.() ?? '').trim();
    if (!raw) {
        return undefined;
    }
    return normalizeSqlJobId(raw) ?? raw;
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

function stripTrailingSemicolon(sql: string): string {
    return sql.replace(/;\s*$/, '').trim();
}

function isTruthyConfigFlag(value: unknown): boolean {
    if (value === true) {
        return true;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === 'true'
            || normalized === '1'
            || normalized === 'yes'
            || normalized === 'on'
            || normalized === 'enabled';
    }
    return false;
}

function waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

const CANCEL_SQL_STATEMENT = 'CALL QSYS2.CANCEL_SQL(?)';
const DEDICATED_FETCH_MORE_MAX_ITERATIONS = 10000;

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
    query?: (statement: string, options?: { isTerseResults?: boolean; parameters?: unknown[] }) => {
        execute: (rows?: number) => Promise<unknown>;
        fetchMore?: (rows?: number) => Promise<unknown>;
        close?: () => Promise<void> | void;
    };
    send?: (request: unknown) => Promise<unknown>;
    getJobId?: () => string | undefined;
    close?: () => Promise<void> | void;
    end?: () => Promise<void> | void;
    dispose?: () => Promise<void> | void;
};

type MapepireLike = {
    newJob: (connection: IBMi, options?: { jdbc?: unknown; javaPath?: string }) => Promise<SqlJobLike>;
};

type JdbcOptionsLike = Record<string, unknown>;

type JobExecuteSignature = 'query.executeRows' | 'query.execute' | 'options.rows' | 'legacy.positionalRows' | 'default.noRowsOption' | 'shared.connection.runSQL';

export interface SqlContinuationTuple {
    type?: string;
    id?: string;
    contId?: string;
    isDone?: boolean;
    hasFetchMore: boolean;
    source: 'shared' | 'dedicated' | 'offsetPagingFallback' | 'unknown';
    rawKeys?: string[];
}

interface SqlMoreProtocolResponse {
    result: unknown;
    tokenUsed: string;
}

export interface RunSQLWithDetailsResult {
    rows: Record<string, unknown>[];
    rawResult?: unknown;
    continuation?: SqlContinuationTuple;
    elapsedMs?: number;
}

export interface DedicatedJobState {
    enabled: boolean;
    jobId?: string;
    status: 'ready' | 'busy' | 'ended';
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
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }
        if (normalized === '1' || normalized === 'y' || normalized === 'yes' || normalized === 'true') {
            return true;
        }
        if (normalized === '0' || normalized === 'n' || normalized === 'no' || normalized === 'false') {
            return false;
        }
    }
    return undefined;
}

function toOptionalElapsedMs(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value.trim());
        if (Number.isFinite(parsed) && parsed >= 0) {
            return parsed;
        }
    }
    return undefined;
}

export interface EffectiveJobConfig {
    currentLibrary?: string;
    libraryList: string[];
}

export type SqlNamingMode = 'sql' | 'system';

export interface ManagedSqlSessionState {
    jobId?: string;
    status: 'ready' | 'busy' | 'ended' | 'closed';
    namingMode: SqlNamingMode;
    currentSchema?: string;
    defaultLibrary?: string;
    libraryList: string[];
    startupSql: string[];
    connectionKey?: string;
    lastUpdatedAt?: number;
}

export function resolveSqlNamingMode(value?: unknown): SqlNamingMode {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'system') {
        return 'system';
    }
    return 'sql';
}

export function collectStartupSqlHooks(source: unknown): string[] {
    const readArray = (candidate: unknown): string[] => {
        if (!Array.isArray(candidate)) {
            return [];
        }

        return candidate
            .map((entry) => String(entry ?? '').trim())
            .filter((entry) => entry.length > 0);
    };

    const visited = new Set<string>();
    const result: string[] = [];
    const push = (candidate: unknown): void => {
        if (!candidate) {
            return;
        }

        const entries = Array.isArray(candidate) ? candidate : [candidate];
        for (const entry of entries) {
            if (typeof entry !== 'string') {
                continue;
            }
            const trimmed = entry.trim();
            if (!trimmed || visited.has(trimmed)) {
                continue;
            }
            visited.add(trimmed);
            result.push(trimmed);
        }
    };

    const root = source as Record<string, unknown> | undefined;
    if (root && typeof root === 'object') {
        push(root.startupSql);
        push(root.initSql);
        push((root as Record<string, unknown>).cmdEntry && typeof (root as Record<string, unknown>).cmdEntry === 'object'
            ? ((root as Record<string, unknown>).cmdEntry as Record<string, unknown>).startupSql
            : undefined);
        push((root as Record<string, unknown>).cmdEntry && typeof (root as Record<string, unknown>).cmdEntry === 'object'
            ? ((root as Record<string, unknown>).cmdEntry as Record<string, unknown>).initSql
            : undefined);
        push((root as Record<string, unknown>).clPrompter && typeof (root as Record<string, unknown>).clPrompter === 'object'
            ? ((root as Record<string, unknown>).clPrompter as Record<string, unknown>).startupSql
            : undefined);
        push((root as Record<string, unknown>).clPrompter && typeof (root as Record<string, unknown>).clPrompter === 'object'
            ? ((root as Record<string, unknown>).clPrompter as Record<string, unknown>).initSql
            : undefined);
        push((root as Record<string, unknown>).clprompter && typeof (root as Record<string, unknown>).clprompter === 'object'
            ? ((root as Record<string, unknown>).clprompter as Record<string, unknown>).startupSql
            : undefined);
        push((root as Record<string, unknown>).clprompter && typeof (root as Record<string, unknown>).clprompter === 'object'
            ? ((root as Record<string, unknown>).clprompter as Record<string, unknown>).initSql
            : undefined);
        const nestedCmdEntry = (root as Record<string, unknown>).cmdEntry;
        if (nestedCmdEntry && typeof nestedCmdEntry === 'object') {
            push((nestedCmdEntry as Record<string, unknown>).startupSql);
            push((nestedCmdEntry as Record<string, unknown>).initSql);
        }
        const nestedClPrompter = (root as Record<string, unknown>).clPrompter;
        if (nestedClPrompter && typeof nestedClPrompter === 'object') {
            const clPrompterEntry = nestedClPrompter as Record<string, unknown>;
            push(clPrompterEntry.startupSql);
            push(clPrompterEntry.initSql);
            const deeper = clPrompterEntry.cmdEntry;
            if (deeper && typeof deeper === 'object') {
                push((deeper as Record<string, unknown>).startupSql);
                push((deeper as Record<string, unknown>).initSql);
            }
        }
    }

    const directEntries = readArray(source);
    for (const entry of directEntries) {
        if (!visited.has(entry)) {
            visited.add(entry);
            result.push(entry);
        }
    }

    return result;
}

type DedicatedRouteDecision = {
    dedicatedEnabled: boolean;
    dedicatedEnabledReason: string;
    remoteServerEnabled: boolean;
    remoteServerReason: string;
    remoteFlags: {
        mapepireUseServer: boolean;
        mapepireServerMode: boolean;
        connectToRemoteMapepireServer: boolean;
    };
    route: 'dedicated' | 'shared';
    finalReason: string;
};

const LIBRARY_LIST_INFO_SQL = `
SELECT SYSTEM_SCHEMA_NAME, TYPE, ORDINAL_POSITION
FROM QSYS2.LIBRARY_LIST_INFO
ORDER BY ORDINAL_POSITION
`;

export class CommandEntryJobManager {
    private job: SqlJobLike | undefined;
    private connectionKey: string | undefined;
    private dedicatedJobId: string | undefined;
    private readonly observedSharedJobIds = new Map<string, string | undefined>();
    private readonly startupReconnectCompleted = new Set<string>();
    private status: DedicatedJobState['status'] = 'ended';
    private managedSession: ManagedSqlSessionState = {
        status: 'ended',
        namingMode: 'sql',
        libraryList: [],
        startupSql: []
    };

    constructor(
        private readonly output?: vscode.OutputChannel,
        private readonly context?: vscode.ExtensionContext
    ) { }

    private debugLog(message: string): void {
        if (isCommandEntryDebugLoggingEnabled()) {
            this.output?.appendLine(message);
        }
    }

    logInfo(message: string): void {
        this.output?.appendLine(message);
    }

    logDiagnostic(message: string): void {
        this.debugLog(message);
    }

    private logContinuationJsonDump(label: string, result: unknown): void {
        if (!isCommandEntryDebugLoggingEnabled()) {
            return;
        }

        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return;
        }

        const candidate = result as Record<string, unknown>;
        const keys = Object.keys(candidate).filter((key) => /(?:^|_|-)(?:id|cont|done|fetch|type|more)/i.test(key) || /continuation|fetchMore|is_done|isDone/i.test(key));
        if (keys.length === 0) {
            return;
        }

        const nestedContinuation = candidate.continuation && typeof candidate.continuation === 'object' && !Array.isArray(candidate.continuation)
            ? candidate.continuation as Record<string, unknown>
            : undefined;
        const topId = [candidate.id, candidate.ID, candidate.continuationId, candidate.continuation_id]
            .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;
        const topContId = [candidate.cont_id, candidate.contId, candidate.CONT_ID]
            .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;
        const topIsDone = [candidate.is_done, candidate.isDone, candidate.done, candidate.IS_DONE]
            .map(toOptionalBoolean)
            .find((value) => value !== undefined);
        const nestedId = nestedContinuation
            ? [nestedContinuation.id, nestedContinuation.ID, nestedContinuation.continuationId, nestedContinuation.continuation_id]
                .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined
            : undefined;
        const nestedContId = nestedContinuation
            ? [nestedContinuation.cont_id, nestedContinuation.contId, nestedContinuation.CONT_ID]
                .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined
            : undefined;
        const nestedIsDone = nestedContinuation
            ? [nestedContinuation.is_done, nestedContinuation.isDone, nestedContinuation.done, nestedContinuation.IS_DONE]
                .map(toOptionalBoolean)
                .find((value) => value !== undefined)
            : undefined;
        const topHasFetchMore = typeof candidate.fetchMore === 'function';
        const nestedHasFetchMore = !!nestedContinuation && typeof nestedContinuation.fetchMore === 'function';

        this.output?.appendLine(
            `[Cmd Entry][ContinuationDump] ${label} summary top(id=${topId ?? '<none>'},cont_id=${topContId ?? '<none>'},is_done=${topIsDone ?? '<unknown>'},fetchMore=${topHasFetchMore}) nested(id=${nestedId ?? '<none>'},cont_id=${nestedContId ?? '<none>'},is_done=${nestedIsDone ?? '<unknown>'},fetchMore=${nestedHasFetchMore})`
        );

        try {
            const json = JSON.stringify(candidate, (key, value) => {
                if (typeof value === 'function') {
                    return '[Function]';
                }

                // Keep protocol attributes visible while suppressing row payload noise.
                if (Array.isArray(value) && /^(rows|data)$/i.test(String(key || ''))) {
                    return `[${key || 'array'} omitted: ${value.length} row(s)]`;
                }

                return value;
            }, 2);
            const maxChars = 4000;
            if (json.length <= maxChars) {
                this.output?.appendLine(`[Cmd Entry][ContinuationDump] ${label} ${json}`);
            } else {
                const head = json.slice(0, 2200);
                const tail = json.slice(-1400);
                this.output?.appendLine(
                    `[Cmd Entry][ContinuationDump] ${label} ${head}\n... [truncated ${json.length - (head.length + tail.length)} chars] ...\n${tail}`
                );
            }
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry][ContinuationDump] ${label} keys=${keys.join(', ')} error=${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private readConnectionSharedJobOverride(connection?: IBMi): boolean | undefined {
        if (!connection) {
            return undefined;
        }

        const config = (connection as any).getConfig?.() as Record<string, unknown> | undefined;
        if (!config || typeof config !== 'object') {
            return undefined;
        }

        const readBoolean = (value: unknown): boolean | undefined => {
            if (typeof value === 'boolean') {
                return value;
            }
            if (typeof value === 'string') {
                const normalized = value.trim().toLowerCase();
                if (normalized === 'true') {
                    return true;
                }
                if (normalized === 'false') {
                    return false;
                }
            }
            return undefined;
        };

        const readFromObject = (candidate: unknown): boolean | undefined => {
            if (!candidate || typeof candidate !== 'object') {
                return undefined;
            }

            const source = candidate as Record<string, unknown>;
            return readBoolean(source.sharedSQLJob) ?? readBoolean(source.sharedSqlJob);
        };

        const direct = readFromObject(config.cmdEntry);
        if (direct !== undefined) {
            return direct;
        }

        const extensionScoped = config.clPrompter;
        if (extensionScoped && typeof extensionScoped === 'object') {
            const nested = readFromObject((extensionScoped as Record<string, unknown>).cmdEntry);
            if (nested !== undefined) {
                return nested;
            }
        }

        const extensionScopedLower = config.clprompter;
        if (extensionScopedLower && typeof extensionScopedLower === 'object') {
            const nested = readFromObject((extensionScopedLower as Record<string, unknown>).cmdEntry);
            if (nested !== undefined) {
                return nested;
            }
        }

        return undefined;
    }

    private getDedicatedRouteDecision(connection?: IBMi): DedicatedRouteDecision {
        const config = vscode.workspace.getConfiguration('clPrompter');

        const connectionSharedOverride = this.readConnectionSharedJobOverride(connection);
        const workspaceLegacyShared = config.get<boolean | undefined>('cmdEntrySQLUseSharedJob')
            ?? config.get<boolean | undefined>('cmdEntryUseSharedSQLJob');
        const workspaceDedicated = config.get<boolean | undefined>('cmdEntryUseDedicatedJob');
        const legacyDedicated = config.get<boolean>('commandEntryUseDedicatedJob', false);

        let dedicatedEnabled = false;
        let dedicatedEnabledReason = 'default commandEntryUseDedicatedJob=false';
        if (typeof connectionSharedOverride === 'boolean') {
            dedicatedEnabled = !connectionSharedOverride;
            dedicatedEnabledReason = `connection cmdEntry.sharedSQLJob=${connectionSharedOverride}`;
        } else if (workspaceLegacyShared !== undefined) {
            dedicatedEnabled = !workspaceLegacyShared;
            dedicatedEnabledReason = `workspace cmdEntrySQLUseSharedJob/cmdEntryUseSharedSQLJob=${workspaceLegacyShared}`;
        } else if (workspaceDedicated !== undefined) {
            dedicatedEnabled = workspaceDedicated;
            dedicatedEnabledReason = `workspace cmdEntryUseDedicatedJob=${workspaceDedicated}`;
        } else {
            dedicatedEnabled = legacyDedicated;
            dedicatedEnabledReason = `workspace commandEntryUseDedicatedJob=${legacyDedicated}`;
        }

        const connectionConfig = (connection as any)?.getConfig?.() as Record<string, unknown> | undefined;
        const flagUseServer = isTruthyConfigFlag(connectionConfig?.mapepireUseServer);
        const flagServerMode = isTruthyConfigFlag(connectionConfig?.mapepireServerMode);
        const flagConnectRemote = isTruthyConfigFlag(connectionConfig?.connectToRemoteMapepireServer);
        const remoteServerEnabled = flagUseServer || flagServerMode || flagConnectRemote;
        const remoteServerReason = `mapepireUseServer=${flagUseServer}, mapepireServerMode=${flagServerMode}, connectToRemoteMapepireServer=${flagConnectRemote}`;

        if (!dedicatedEnabled) {
            return {
                dedicatedEnabled,
                dedicatedEnabledReason,
                remoteServerEnabled,
                remoteServerReason,
                remoteFlags: {
                    mapepireUseServer: flagUseServer,
                    mapepireServerMode: flagServerMode,
                    connectToRemoteMapepireServer: flagConnectRemote
                },
                route: 'shared',
                finalReason: `dedicated disabled (${dedicatedEnabledReason})`
            };
        }

        if (!remoteServerEnabled) {
            return {
                dedicatedEnabled,
                dedicatedEnabledReason,
                remoteServerEnabled,
                remoteServerReason,
                remoteFlags: {
                    mapepireUseServer: flagUseServer,
                    mapepireServerMode: flagServerMode,
                    connectToRemoteMapepireServer: flagConnectRemote
                },
                route: 'shared',
                finalReason: `single-mode mapepire/shared-job gate active (${remoteServerReason})`
            };
        }

        return {
            dedicatedEnabled,
            dedicatedEnabledReason,
            remoteServerEnabled,
            remoteServerReason,
            remoteFlags: {
                mapepireUseServer: flagUseServer,
                mapepireServerMode: flagServerMode,
                connectToRemoteMapepireServer: flagConnectRemote
            },
            route: 'dedicated',
            finalReason: `dedicated allowed (${dedicatedEnabledReason}; ${remoteServerReason})`
        };
    }

    private logDedicatedRouteDecision(phase: string, connection?: IBMi): void {
        if (!isCommandEntryDebugLoggingEnabled() || !connection) {
            return;
        }

        const decision = this.getDedicatedRouteDecision(connection);
        this.output?.appendLine(
            `[Cmd Entry][GateDiag] ${phase} route=${decision.route} finalReason=${decision.finalReason} dedicatedEnabled=${decision.dedicatedEnabled} dedicatedReason=${decision.dedicatedEnabledReason} remoteServerEnabled=${decision.remoteServerEnabled} remoteReason=${decision.remoteServerReason}`
        );
    }

    private canUseDedicatedForConnection(connection?: IBMi): boolean {
        return this.getDedicatedRouteDecision(connection).route === 'dedicated';
    }

    isDedicatedUsable(connection?: IBMi): boolean {
        return this.canUseDedicatedForConnection(connection);
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
        const dedicatedEnabled = this.isDedicatedEnabled(connection);
        const sharedSqlJobStatus = getSharedSqlJobStatus(connection) ?? '<unknown>';
        this.output?.appendLine(
            `[Cmd Entry][JobRoute] ${phase} connObj=${objectId} key=${connectionKey} dedicatedEnabled=${dedicatedEnabled} serverEnabled=${serverEnabled} sharedSqlJobObj=${sharedSqlJobObjectId} sharedJobStatus=${sharedSqlJobStatus} sharedJobId=${sharedJobId} sharedJobIdRaw=${rawSharedJobId} observedSharedJobId=${observedSharedJobId} dedicatedJobId=${dedicatedJobId} status=${this.status}${extra ? ` ${extra}` : ''}`
        );
    }

    private observeSharedJobId(connection: IBMi, reason: string): void {
        const key = this.buildConnectionKey(connection);
        const observed = normalizeSqlJobId(connection.getSqlJobId());
        const previous = this.observedSharedJobIds.get(key);
        this.observedSharedJobIds.set(key, observed);
        if (observed !== previous && isCommandEntryDebugLoggingEnabled()) {
            this.output?.appendLine(`[Cmd Entry][JobRoute] observed shared job ID changed (${reason}) ${previous ?? '<none>'} -> ${observed ?? '<none>'}`);
        }
    }

    private getObservedSharedJobId(connection?: IBMi): string | undefined {
        if (!connection) {
            return undefined;
        }
        return this.observedSharedJobIds.get(this.buildConnectionKey(connection));
    }

    isDedicatedEnabled(connection?: IBMi): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const settings = this.context ? getConnectionSqlSettings(this.context, connection) : getDefaultConnectionSqlSettings();
        const useShared = settings.useSharedJob;
        if (typeof useShared === 'boolean') {
            return !useShared;
        }
        const legacy = config.get<boolean | undefined>('cmdEntrySQLUseSharedJob')
            ?? config.get<boolean | undefined>('cmdEntryUseSharedSQLJob');
        if (legacy !== undefined) {
            return !legacy;
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
        if (!this.isDedicatedEnabled(connection)) {
            const sharedJobId = this.getObservedSharedJobId(connection) ?? sharedSqlJobIdForDisplay(connection);
            return { enabled: false, jobId: sharedJobId, status: 'ready' };
        }

        if (!this.canUseDedicatedForConnection(connection)) {
            if (connection) {
                this.logRouteSnapshot('getState.shared.serverDisabled', connection);
            }
            const sharedJobId = this.getObservedSharedJobId(connection) ?? sharedSqlJobIdForDisplay(connection);
            return { enabled: false, jobId: sharedJobId, status: 'ready' };
        }

        return {
            enabled: true,
            jobId: this.dedicatedJobId,
            status: this.dedicatedJobId ? this.status : 'ended'
        };
    }

    getManagedSessionState(connection?: IBMi): ManagedSqlSessionState {
        const resolvedConnectionKey = connection ? this.buildConnectionKey(connection) : this.connectionKey;
        const base: ManagedSqlSessionState = {
            ...this.managedSession,
            connectionKey: resolvedConnectionKey ?? this.managedSession.connectionKey,
            jobId: this.dedicatedJobId ?? this.managedSession.jobId,
            status: this.status ?? this.managedSession.status,
            namingMode: this.managedSession.namingMode ?? 'sql',
            libraryList: this.managedSession.libraryList ?? [],
            startupSql: this.managedSession.startupSql ?? []
        };

        if (!base.defaultLibrary && connection) {
            const defaultConfig = this.connectionConfigFallback(connection);
            base.defaultLibrary = defaultConfig.currentLibrary;
        }

        if (base.libraryList.length === 0 && connection) {
            const defaultConfig = this.connectionConfigFallback(connection);
            base.libraryList = defaultConfig.libraryList;
        }

        if (!base.currentSchema && connection) {
            const schema = this.managedSession.currentSchema ?? this.getCurrentSchemaFromConnection(connection);
            base.currentSchema = schema;
        }

        if (!base.jobId && connection) {
            base.jobId = this.getObservedSharedJobId(connection) ?? sharedSqlJobIdForDisplay(connection);
        }

        this.managedSession = base;
        return base;
    }

    private getCurrentSchemaFromConnection(connection?: IBMi): string | undefined {
        if (!connection) {
            return undefined;
        }

        const config = (connection as any).getConfig?.() as Record<string, unknown> | undefined;
        const currentSchema = config && typeof config === 'object'
            ? (config.currentSchema ?? config.current_schema ?? config.defaultSchema ?? config.default_schema)
            : undefined;
        return typeof currentSchema === 'string' && currentSchema.trim().length > 0
            ? currentSchema.trim().toUpperCase()
            : undefined;
    }

    private async resolveCurrentSchema(connection: IBMi): Promise<string | undefined> {
        try {
            const rows = await this.runSQL(connection, 'VALUES CURRENT SCHEMA', { skipSyntaxCheck: true });
            const firstRow = rows?.[0];
            const rawValue = firstRow ? Object.values(firstRow)[0] : undefined;
            const value = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '').trim();
            return value ? value.toUpperCase() : undefined;
        } catch {
            return this.getCurrentSchemaFromConnection(connection);
        }
    }

    private getDeclaredStartupSql(connection: IBMi): string[] {
        const config = (connection as any)?.getConfig?.() as Record<string, unknown> | undefined;
        const declared = collectStartupSqlHooks(config ?? {});
        const sessionOptions = getConnectionSqlSessionOptions(connection);
        const optionStatements = buildStartupSqlForSessionOptions(sessionOptions);
        return [...declared, ...optionStatements].filter((statement) => statement.trim().length > 0);
    }

    private async runStartupSqlHooks(connection: IBMi): Promise<void> {
        const startupSql = this.getDeclaredStartupSql(connection);
        if (startupSql.length === 0) {
            this.managedSession.startupSql = [];
            return;
        }

        this.managedSession.startupSql = startupSql;
        for (const statement of startupSql) {
            try {
                await this.runSQL(connection, statement, { skipSyntaxCheck: true });
            } catch (error) {
                this.output?.appendLine(`[Cmd Entry][StartupSql] failed statement=${statement.substring(0, 120)} error=${error instanceof Error ? error.message : String(error)}`);
            }
        }
    }

    async refreshManagedSession(connection: IBMi): Promise<ManagedSqlSessionState> {
        const config = await this.getConfig(connection);
        const currentSchema = await this.resolveCurrentSchema(connection);
        const namingMode = resolveSqlNamingMode((connection as any)?.sqlJob?.getNamingMode?.() ?? (connection as any)?.getConfig?.()?.sqlNamingMode ?? (connection as any)?.getConfig?.()?.namingMode);
        const state: ManagedSqlSessionState = {
            jobId: this.dedicatedJobId ?? this.getObservedSharedJobId(connection) ?? sharedSqlJobIdForDisplay(connection),
            status: this.job ? this.status : 'ended',
            namingMode,
            currentSchema: currentSchema ?? this.getCurrentSchemaFromConnection(connection),
            defaultLibrary: config.currentLibrary,
            libraryList: config.libraryList,
            startupSql: this.managedSession.startupSql ?? this.getDeclaredStartupSql(connection),
            connectionKey: this.buildConnectionKey(connection),
            lastUpdatedAt: Date.now()
        };

        this.managedSession = state;
        return state;
    }

    getDisplayJobId(connection?: IBMi): string | undefined {
        const state = this.getState(connection);
        if (state.jobId) {
            return state.jobId;
        }

        // Dedicated job can be active before a readable dedicated job ID is resolved.
        // Fall back to shared SQL job ID so UI never regresses to "no connection".
        return this.getObservedSharedJobId(connection) ?? sharedSqlJobIdForDisplay(connection);
    }

    async resolveDisplayJobId(
        connection: IBMi,
        options: { attempts?: number; delayMs?: number } = {}
    ): Promise<string | undefined> {
        this.output?.appendLine(`[Cmd Entry][JobIdDebug] resolveDisplayJobId start dedicatedEnabled=${this.isDedicatedEnabled(connection)} remoteServerEnabled=${this.isRemoteMapepireServerEnabled(connection)}`);

        if (!this.canUseDedicatedForConnection(connection)) {
            this.observeSharedJobId(connection, 'resolveDisplayJobId.sharedMode');
            const fallback = this.getObservedSharedJobId(connection) ?? sharedSqlJobIdForDisplay(connection);
            this.output?.appendLine(`[Cmd Entry][JobIdDebug] resolveDisplayJobId fallback to shared => ${fallback || '<none>'}`);
            return fallback;
        }

        await this.ensureJob(connection);

        const cached = normalizeSqlJobId(this.dedicatedJobId);
        if (cached) {
            this.dedicatedJobId = cached;
            this.output?.appendLine(`[Cmd Entry][JobIdDebug] resolveDisplayJobId cached dedicated ID => ${cached}`);
            return cached;
        }

        const attempts = Math.max(1, Math.trunc(options.attempts ?? 6));
        const delayMs = Math.max(0, Math.trunc(options.delayMs ?? 150));

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const resolved = await this.readDedicatedJobId(connection);
            this.output?.appendLine(`[Cmd Entry][JobIdDebug] resolveDisplayJobId attempt=${attempt} resolved=${resolved || '<none>'} dedicatedJobId=${this.dedicatedJobId || '<none>'}`);
            if (resolved) {
                this.dedicatedJobId = resolved;
                this.status = 'ready';
                this.debugLog(`[Cmd Entry] Private SQL job ID resolved on attempt ${attempt}: ${resolved}`);
                this.output?.appendLine(`[Cmd Entry][JobIdDebug] resolveDisplayJobId resolved => ${resolved}`);
                return resolved;
            }

            if (attempt < attempts && delayMs > 0) {
                await waitFor(delayMs);
            }
        }

        this.output?.appendLine(`[Cmd Entry][JobIdDebug] resolveDisplayJobId did not resolve a dedicated ID currentDedicatedJobId=${this.dedicatedJobId || '<none>'} sharedSqlJobId=${connection.getSqlJobId?.() ?? '<none>'}`);
        return this.dedicatedJobId;
    }

    private rowsFromExecutionResult(result: unknown): Record<string, unknown>[] {
        if (Array.isArray(result)) {
            this.debugLog(`[Cmd Entry] job.execute() returned array with ${result.length} rows`);
            return result as Record<string, unknown>[];
        }

        if (result && typeof result === 'object') {
            if ('data' in result && Array.isArray((result as any).data)) {
                const rows = (result as any).data;
                this.debugLog(`[Cmd Entry] job.execute() returned object with .data array containing ${rows.length} rows`);
                return rows as Record<string, unknown>[];
            }

            if ('rows' in result && Array.isArray((result as any).rows)) {
                const rows = (result as any).rows;
                this.debugLog(`[Cmd Entry] job.execute() returned object with .rows array containing ${rows.length} rows`);
                return rows as Record<string, unknown>[];
            }
        }

        return [];
    }

    private extractReportedRowCount(result: unknown): number | undefined {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return undefined;
        }

        const candidate = result as Record<string, unknown>;
        const value = [
            candidate.rowCount,
            candidate.row_count,
            candidate.rowsReturned,
            candidate.rows_returned,
            candidate.returnedRows,
            candidate.returned_rows,
            candidate.recordCount,
            candidate.record_count,
            candidate.count,
            candidate.COUNT
        ].find((entry) => entry !== undefined && entry !== null);

        if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
            return value;
        }

        if (typeof value === 'string') {
            const parsed = Number(value.trim());
            if (Number.isInteger(parsed) && parsed >= 0) {
                return parsed;
            }
        }

        return undefined;
    }

    private extractElapsedMs(result: unknown): number | undefined {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return undefined;
        }

        const candidate = result as Record<string, unknown>;
        return [
            candidate.execution_time,
            candidate.executionTime,
            candidate.elapsedMs,
            candidate.elapsed_ms,
            candidate.elapsed,
            candidate.durationMs,
            candidate.duration_ms,
            candidate.duration,
            candidate.timeMs,
            candidate.time_ms,
            candidate.time,
            candidate.elapsedTime,
            candidate.elapsed_time
        ].map(toOptionalElapsedMs).find((entry) => entry !== undefined);
    }

    private logContinuationCandidate(source: SqlContinuationTuple['source'], candidate: Record<string, unknown>): void {
        if (!isCommandEntryDebugLoggingEnabled()) {
            return;
        }

        const rawKeys = Object.keys(candidate);
        const interestingKeys = rawKeys.filter((key) => /(?:^|_|-)(?:id|cont|done|fetch|type|more)/i.test(key) || /continuation|fetchMore|is_done|isDone/i.test(key));
        const nestedCandidates = [
            candidate.continuation,
            candidate.resultset,
            candidate.resultSet,
            candidate.page,
            candidate.metadata,
            candidate.meta
        ].filter((entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry)) as Record<string, unknown>[];

        const nestedSummary = nestedCandidates.map((entry, index) => {
            const keys = Object.keys(entry);
            return `n${index + 1}={${keys.slice(0, 15).join(', ')}}`;
        }).join(' ');

        this.debugLog(
            `[Cmd Entry][ContinuationCandidate] source=${source} keys=${rawKeys.join(', ')} interestingKeys=${interestingKeys.join(', ')} nested=${nestedSummary || '<none>'}`
        );

        if (interestingKeys.length === 0) {
            return;
        }

        try {
            const filtered: Record<string, unknown> = {};
            for (const key of interestingKeys) {
                filtered[key] = candidate[key];
            }
            const json = JSON.stringify(filtered, (_key, value) => typeof value === 'function' ? '[Function]' : value, 2);
            this.debugLog(`[Cmd Entry][ContinuationCandidate] source=${source} filtered=${json.substring(0, 4000)}`);
        } catch (error) {
            this.debugLog(`[Cmd Entry][ContinuationCandidate] source=${source} filtered=<json_error:${error instanceof Error ? error.message : String(error)}>`);
        }
    }

    private extractContinuationTuple(result: unknown, source: SqlContinuationTuple['source']): SqlContinuationTuple | undefined {
        if (!result || typeof result !== 'object' || Array.isArray(result)) {
            return undefined;
        }

        const candidate = result as Record<string, unknown>;
        this.logContinuationCandidate(source, candidate);
        const rawKeys = Object.keys(candidate);
        const type = typeof candidate.type === 'string' ? candidate.type.trim().toLowerCase() : undefined;
        const id = [candidate.id, candidate.ID, candidate.continuationId, candidate.continuation_id, candidate.correlationId, candidate.correlation_id]
            .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;
        const contId = [candidate.cont_id, candidate.contId, candidate.CONT_ID]
            .find((value) => typeof value === 'string' && value.trim().length > 0) as string | undefined;
        const isDone = [candidate.is_done, candidate.isDone, candidate.done, candidate.IS_DONE]
            .map(toOptionalBoolean)
            .find((value) => value !== undefined);
        const hasFetchMore = typeof candidate.fetchMore === 'function';

        if (!id && !contId && isDone === undefined && !hasFetchMore) {
            return undefined;
        }

        return {
            type,
            id: id?.trim(),
            contId: contId?.trim(),
            isDone,
            hasFetchMore,
            source,
            rawKeys
        };
    }

    private getContinuationToken(continuation?: SqlContinuationTuple): string | undefined {
        const raw = continuation?.contId ?? continuation?.id;
        if (!raw || typeof raw !== 'string') {
            return undefined;
        }
        const normalized = raw.trim();
        return normalized.length > 0 ? normalized : undefined;
    }

    isContinuationUsable(continuation?: SqlContinuationTuple): boolean {
        if (!continuation || continuation.isDone === true) {
            return false;
        }

        if (continuation.hasFetchMore) {
            return true;
        }

        if (continuation.source === 'dedicated' && this.getContinuationToken(continuation)) {
            return true;
        }

        return false;
    }

    private async runSqlMoreProtocol(
        job: SqlJobLike,
        continuation: SqlContinuationTuple,
        sqlStatement?: string,
        rows?: number
    ): Promise<SqlMoreProtocolResponse | undefined> {
        if (continuation.source !== 'dedicated') {
            return undefined;
        }

        const token = this.getContinuationToken(continuation);
        if (!token || continuation.isDone === true) {
            return undefined;
        }

        const send = (job as any).send?.bind(job) as ((request: unknown) => Promise<unknown>) | undefined;
        if (typeof send !== 'function') {
            this.output?.appendLine('[Cmd Entry][SQLPolicy] sqlmore.request unavailable reason=missing-job-send');
            return undefined;
        }

        const normalizedSql = typeof sqlStatement === 'string' ? stripTrailingSemicolon(sqlStatement) : '';
        if (!normalizedSql) {
            this.output?.appendLine(`[Cmd Entry][SQLPolicy] sqlmore.request skipped cont_id=${token} reason=missing-sql`);
            return undefined;
        }

        const request: Record<string, unknown> = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            type: 'sqlmore',
            cont_id: token,
            sql: normalizedSql
        };
        if (isPositiveInteger(rows)) {
            request.rows = rows;
        }

        this.output?.appendLine(`[Cmd Entry][SQLPolicy] sqlmore.request source=dedicated cont_id=${token} rows=${request.rows ?? '<none>'} sqlLen=${normalizedSql.length}`);

        try {
            const result = await send(request);
            this.logContinuationJsonDump(`sqlmore.request cont_id=${token}`, result);
            return { result, tokenUsed: token };
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry][SQLPolicy] sqlmore.request failed cont_id=${token} error=${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    private async fetchAllDedicatedRowsByContinuation(
        initialResult: unknown,
        initialRows: Record<string, unknown>[],
        targetRows?: number
    ): Promise<RunSQLWithDetailsResult> {
        const allRows = [...initialRows];
        let currentResult = initialResult;
        let continuation = this.extractContinuationTuple(currentResult, 'dedicated');

        if (!continuation?.hasFetchMore) {
            return { rows: allRows, rawResult: currentResult, continuation, elapsedMs: this.extractElapsedMs(currentResult) };
        }

        for (let iteration = 1; iteration <= DEDICATED_FETCH_MORE_MAX_ITERATIONS; iteration += 1) {
            if (isPositiveInteger(targetRows) && allRows.length >= targetRows) {
                break;
            }

            if (continuation?.isDone === true) {
                break;
            }

            const fetchMore = (currentResult as any).fetchMore;
            if (typeof fetchMore !== 'function') {
                break;
            }

            const nextResult = await fetchMore.call(currentResult);
            const nextRows = this.rowsFromExecutionResult(nextResult);
            if (nextRows.length > 0) {
                allRows.push(...nextRows);
            }

            if (nextResult && typeof nextResult === 'object') {
                currentResult = nextResult;
            }

            continuation = this.extractContinuationTuple(currentResult, 'dedicated') ?? continuation;

            if (nextRows.length === 0 && continuation?.isDone !== false) {
                break;
            }
        }

        return { rows: allRows, rawResult: currentResult, continuation };
    }

    async continueSQLFromResult(
        initialResult: unknown,
        options?: { targetRows?: number; statement?: string }
    ): Promise<RunSQLWithDetailsResult> {
        const additionalRows: Record<string, unknown>[] = [];
        let currentResult = initialResult;
        let continuation = this.extractContinuationTuple(currentResult, 'dedicated')
            ?? this.extractContinuationTuple(currentResult, 'shared');

        if (!this.isContinuationUsable(continuation)) {
            return { rows: additionalRows, rawResult: currentResult, continuation };
        }

        const targetRows = options?.targetRows;
        this.logContinuationJsonDump(`continueSQLFromResult.enter targetRows=${targetRows ?? '<none>'}`, currentResult);
        for (let iteration = 1; iteration <= DEDICATED_FETCH_MORE_MAX_ITERATIONS; iteration += 1) {
            if (isPositiveInteger(targetRows) && additionalRows.length >= targetRows) {
                break;
            }

            if (continuation?.isDone === true) {
                break;
            }

            let nextResult: unknown;
            const fetchMore = (currentResult as any).fetchMore;
            if (typeof fetchMore === 'function') {
                nextResult = await fetchMore.call(currentResult);
            } else {
                if (!continuation) {
                    break;
                }
                const sqlMoreResult = this.job
                    ? await this.runSqlMoreProtocol(this.job, continuation, options?.statement, targetRows)
                    : undefined;
                if (!sqlMoreResult) {
                    break;
                }
                nextResult = sqlMoreResult.result;
            }
            const nextRows = this.rowsFromExecutionResult(nextResult);
            if (nextRows.length > 0) {
                if (isPositiveInteger(targetRows)) {
                    const remaining = Math.max(0, targetRows - additionalRows.length);
                    if (remaining > 0) {
                        additionalRows.push(...nextRows.slice(0, remaining));
                    }
                } else {
                    additionalRows.push(...nextRows);
                }
            }

            if (nextResult && typeof nextResult === 'object') {
                currentResult = nextResult;
            }

            this.logContinuationJsonDump(`continueSQLFromResult.step=${iteration} targetRows=${targetRows ?? '<none>'} fetchedRows=${nextRows.length}`, currentResult);

            continuation = this.extractContinuationTuple(currentResult, 'dedicated')
                ?? this.extractContinuationTuple(currentResult, 'shared')
                ?? continuation;

            if (continuation) {
                this.output?.appendLine(
                    `[Cmd Entry][SQLPolicy] continueSQLFromResult.step=${iteration} tuple(type=${continuation.type ?? '<none>'},id=${continuation.id ?? '<none>'},cont_id=${continuation.contId ?? '<none>'},is_done=${continuation.isDone ?? '<unknown>'},hasFetchMore=${continuation.hasFetchMore}) fetchedRows=${nextRows.length}`
                );
            }

            if (nextRows.length === 0 && continuation?.isDone !== false) {
                break;
            }
        }

        return { rows: additionalRows, rawResult: currentResult, continuation, elapsedMs: this.extractElapsedMs(currentResult) };
    }

    private async executeSqlOnJob(
        job: SqlJobLike,
        statements: string | string[],
        source: 'shared' | 'dedicated',
        options?: { bindings?: unknown[]; rows?: number }
    ): Promise<{ result: unknown; signature: JobExecuteSignature }> {
        const sqlWithBindings = Array.isArray(statements)
            ? statements.map(stmt => substituteBindings(stmt, options?.bindings))
            : substituteBindings(statements, options?.bindings);

        const statementsStr = Array.isArray(sqlWithBindings)
            ? sqlWithBindings.join('; ')
            : sqlWithBindings;
        if (options?.bindings && options.bindings.length > 0) {
            this.debugLog(`[Cmd Entry] Executing with substituted bindings: SQL=${statementsStr.substring(0, 150)}...`);
        }

        const execute = (job as any).execute.bind(job) as (...args: unknown[]) => Promise<unknown>;
        const requestedRows = options?.rows;
        if (isPositiveInteger(requestedRows)) {
            this.debugLog(`[Cmd Entry] Requesting up to ${requestedRows} SQL rows from ${source} job.`);

            if (typeof sqlWithBindings === 'string' && typeof job.query === 'function') {
                try {
                    const query = job.query(sqlWithBindings, { isTerseResults: false });
                    const closeQuery = async (): Promise<void> => {
                        if (typeof query.close !== 'function') {
                            return;
                        }
                        try {
                            await query.close();
                        } catch {
                            // Best effort close to avoid masking successful query results.
                        }
                    };

                    const attachContinuationMethods = (payload: unknown): unknown => {
                        if (!payload || typeof payload !== 'object') {
                            return payload;
                        }

                        const response = payload as Record<string, unknown>;
                        const fetchMoreBound = async (): Promise<unknown> => {
                            const next = typeof query.fetchMore === 'function'
                                ? await query.fetchMore(requestedRows)
                                : await query.execute(requestedRows);
                            const attached = attachContinuationMethods(next);
                            const done = this.extractContinuationTuple(attached, source)?.isDone;
                            if (done === true) {
                                await closeQuery();
                            }
                            return attached;
                        };

                        response.fetchMore = fetchMoreBound as unknown;
                        response.close = closeQuery as unknown;
                        return response;
                    };

                    const result = attachContinuationMethods(await query.execute(requestedRows));
                    const done = this.extractContinuationTuple(result, source)?.isDone;
                    if (done === true) {
                        await closeQuery();
                    }

                    this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=query.executeRows requestedRows=${requestedRows}`);
                    return { result, signature: 'query.executeRows' };
                } catch (queryError) {
                    this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=query.executeRows rejected requestedRows=${requestedRows} error=${queryError instanceof Error ? queryError.message : String(queryError)}`);
                }
            }

            try {
                const result = await execute(sqlWithBindings, { rows: requestedRows });
                this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=options.rows requestedRows=${requestedRows}`);
                return { result, signature: 'options.rows' };
            } catch (error) {
                this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=options.rows rejected requestedRows=${requestedRows} error=${error instanceof Error ? error.message : String(error)}`);
                try {
                    const result = await execute(sqlWithBindings, undefined, requestedRows);
                    this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=legacy.positionalRows requestedRows=${requestedRows}`);
                    return { result, signature: 'legacy.positionalRows' };
                } catch (legacyError) {
                    this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=legacy.positionalRows rejected requestedRows=${requestedRows} error=${legacyError instanceof Error ? legacyError.message : String(legacyError)}`);
                    const result = await execute(sqlWithBindings);
                    this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=default.noRowsOption requestedRows=${requestedRows}`);
                    return { result, signature: 'default.noRowsOption' };
                }
            }
        }

        if (typeof sqlWithBindings === 'string' && typeof job.query === 'function') {
            try {
                const query = job.query(sqlWithBindings, { isTerseResults: false });
                const closeQuery = async (): Promise<void> => {
                    if (typeof query.close !== 'function') {
                        return;
                    }
                    try {
                        await query.close();
                    } catch {
                        // Best effort close to avoid masking successful query results.
                    }
                };

                const attachContinuationMethods = (payload: unknown): unknown => {
                    if (!payload || typeof payload !== 'object') {
                        return payload;
                    }

                    const response = payload as Record<string, unknown>;
                    const fetchMoreBound = async (): Promise<unknown> => {
                        const next = typeof query.fetchMore === 'function'
                            ? await query.fetchMore()
                            : await query.execute();
                        const attached = attachContinuationMethods(next);
                        const done = this.extractContinuationTuple(attached, source)?.isDone;
                        if (done === true) {
                            await closeQuery();
                        }
                        return attached;
                    };

                    response.fetchMore = fetchMoreBound as unknown;
                    response.close = closeQuery as unknown;
                    return response;
                };

                const result = attachContinuationMethods(await query.execute());
                const done = this.extractContinuationTuple(result, source)?.isDone;
                if (done === true) {
                    await closeQuery();
                }

                this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=query.execute requestedRows=<none>`);
                return { result, signature: 'query.execute' };
            } catch (queryError) {
                this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=query.execute rejected requestedRows=<none> error=${queryError instanceof Error ? queryError.message : String(queryError)}`);
            }
        }

        const result = await execute(sqlWithBindings);
        this.debugLog(`[Cmd Entry][SQLDiag] ${source} execute signature=default.noRowsOption requestedRows=<none>`);
        return { result, signature: 'default.noRowsOption' };
    }

    private async executeSharedSql(
        connection: IBMi,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number }
    ): Promise<{ result: unknown; signature: JobExecuteSignature }> {
        const sharedJob = (connection as any).sqlJob as SqlJobLike | undefined;
        if (sharedJob) {
            try {
                return await this.executeSqlOnJob(sharedJob, statements, 'shared', options);
            } catch (jobError) {
                this.debugLog(`[Cmd Entry][SQLDiag] shared execute via sharedJob failed; falling back to connection.runSQL error=${jobError instanceof Error ? jobError.message : String(jobError)}`);
            }
        }

        const sharedRunOptions = {
            bindings: options?.bindings as never[] | undefined,
            rows: options?.rows
        };
        const fallbackResult = await connection.runSQL(statements, sharedRunOptions);
        this.debugLog(`[Cmd Entry][SQLDiag] shared execute signature=shared.connection.runSQL requestedRows=${isPositiveInteger(options?.rows) ? options?.rows : '<none>'}`);
        return { result: fallbackResult, signature: 'shared.connection.runSQL' };
    }

    async runSQLWithDetails(
        connection: IBMi,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number; skipSyntaxCheck?: boolean }
    ): Promise<RunSQLWithDetailsResult> {
        this.logDedicatedRouteDecision('runSQLWithDetails.enter', connection);
        const statementPreview = Array.isArray(statements) ? statements.join(' ; ') : statements;
        this.output?.appendLine(`[Cmd Entry][runSQLWithDetails] route=${this.canUseDedicatedForConnection(connection) ? 'dedicated-preferred' : 'shared-only'} rows=${options?.rows ?? '<none>'} sql=${statementPreview}`);
        this.logRouteSnapshot('runSQL.enter', connection, `rows=${options?.rows ?? '<none>'}`);

        const runOnSharedJob = async (reason: string): Promise<RunSQLWithDetailsResult> => {
            try {
                const sharedExecution = await this.executeSharedSql(connection, statements, options);
                const sharedResult = sharedExecution.result;
                const rows = this.rowsFromExecutionResult(sharedResult);
                const continuation = this.extractContinuationTuple(sharedResult, 'shared');
                this.logContinuationJsonDump(`route=shared requestedRows=${isPositiveInteger(options?.rows) ? options?.rows : '<none>'}`, sharedResult);
                const reportedRows = this.extractReportedRowCount(sharedResult);
                this.debugLog(`[Cmd Entry][SQLDiag] route=shared signature=${sharedExecution.signature} requestedRows=${isPositiveInteger(options?.rows) ? options?.rows : '<none>'} extractedRows=${rows.length} reportedRows=${reportedRows ?? '<none>'} continuationFetchMore=${continuation?.hasFetchMore ?? false} isDone=${continuation?.isDone ?? '<unknown>'}`);
                if (continuation) {
                    this.debugLog(`[Cmd Entry] shared continuation tuple type=${continuation.type ?? '<none>'} id=${continuation.id ?? '<none>'} cont_id=${continuation.contId ?? '<none>'} is_done=${continuation.isDone ?? '<unknown>'} fetchMore=${continuation.hasFetchMore}`);
                }
                return { rows, rawResult: sharedResult, continuation, elapsedMs: this.extractElapsedMs(sharedResult) };
            } finally {
                this.observeSharedJobId(connection, reason);
            }
        };

        if (!this.canUseDedicatedForConnection(connection)) {
            this.logDedicatedRouteDecision('runSQLWithDetails.route.shared', connection);
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
            this.output?.appendLine(`[Cmd Entry] Dedicated job is unavailable (${error instanceof Error ? error.message : String(error)}). Falling back to shared SQL job.`);
            this.status = 'ended';
            this.dedicatedJobId = undefined;
            this.connectionKey = undefined;
            this.logRouteSnapshot('runSQL.route.shared.ensureFailed', connection);
            return runOnSharedJob('ensureFailed');
        }

        const job = this.job;
        if (!job) {
            this.output?.appendLine('[Cmd Entry] Dedicated job handle missing. Falling back to shared SQL job.');
            this.logRouteSnapshot('runSQL.route.shared.noDedicatedHandle', connection);
            return runOnSharedJob('noDedicatedHandle');
        }

        this.logDedicatedRouteDecision('runSQLWithDetails.route.dedicated', connection);
        this.logRouteSnapshot('runSQL.route.dedicated', connection);

        this.status = 'busy';
        try {
            const requestedRows = options?.rows;
            const dedicatedExecution = await this.executeSqlOnJob(job, statements, 'dedicated', options);
            const result = dedicatedExecution.result;
            let rows = this.rowsFromExecutionResult(result);
            let continuation = this.extractContinuationTuple(result, 'dedicated');
            const reportedRows = this.extractReportedRowCount(result);

            this.debugLog(`[Cmd Entry][SQLDiag] route=dedicated signature=${dedicatedExecution.signature} requestedRows=${isPositiveInteger(requestedRows) ? requestedRows : '<none>'} extractedRows=${rows.length} reportedRows=${reportedRows ?? '<none>'} continuationFetchMore=${continuation?.hasFetchMore ?? false} isDone=${continuation?.isDone ?? '<unknown>'}`);

            if (continuation) {
                this.debugLog(`[Cmd Entry] dedicated continuation tuple type=${continuation.type ?? '<none>'} id=${continuation.id ?? '<none>'} cont_id=${continuation.contId ?? '<none>'} is_done=${continuation.isDone ?? '<unknown>'} fetchMore=${continuation.hasFetchMore}`);
            }

            this.logContinuationJsonDump(`route=${dedicatedExecution.signature} requestedRows=${isPositiveInteger(requestedRows) ? requestedRows : '<none>'}`, result);

            const shouldContinueToTarget = isPositiveInteger(requestedRows)
                && rows.length > 0
                && rows.length < requestedRows
                && continuation?.hasFetchMore
                && continuation.isDone !== true;

            if (shouldContinueToTarget) {
                const completed = await this.fetchAllDedicatedRowsByContinuation(result, rows, requestedRows);
                rows = completed.rows;
                continuation = completed.continuation;
            }

            if (rows.length === 0 && result && typeof result === 'object') {
                const resultKeys = Object.keys(result);
                const resultMethods = resultKeys.filter(k => typeof (result as any)[k] === 'function');
                this.debugLog(`[Cmd Entry] job.execute() result has keys: ${resultKeys.join(', ')}`);
                if (resultMethods.length > 0) {
                    this.debugLog(`[Cmd Entry] job.execute() result has methods: ${resultMethods.join(', ')}`);
                }
            }

            if (rows.length > 0) {
                return { rows, rawResult: result, continuation, elapsedMs: this.extractElapsedMs(result) };
            }

            this.debugLog('[Cmd Entry] WARNING: Could not extract rows from result');
            return { rows: [], rawResult: result, continuation, elapsedMs: this.extractElapsedMs(result) };
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry] SQL execution failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        } finally {
            this.status = this.job ? 'ready' : 'ended';
            this.logRouteSnapshot('runSQL.exit', connection);
        }
    }

    async runSQL(
        connection: IBMi,
        statements: string | string[],
        options?: { bindings?: unknown[]; rows?: number; skipSyntaxCheck?: boolean }
    ): Promise<Record<string, unknown>[]> {
        const result = await this.runSQLWithDetails(connection, statements, options);
        return result.rows;
    }

    async getConfig(connection: IBMi): Promise<EffectiveJobConfig> {
        const fallback = this.connectionConfigFallback(connection);

        try {
            const rows = await this.runSQL(connection, LIBRARY_LIST_INFO_SQL);
            if (!Array.isArray(rows) || rows.length === 0) {
                return fallback;
            }

            const libraryList: string[] = [];
            const seen = new Set<string>();
            let currentLibrary: string | undefined;

            for (const row of rows) {
                const schemaName = this.normalizeLibraryName(this.readRowString(row, 'SYSTEM_SCHEMA_NAME'));
                if (!schemaName) {
                    continue;
                }

                const type = this.readRowString(row, 'TYPE')?.trim().toUpperCase();
                if (type === 'CURRENT') {
                    currentLibrary = schemaName;
                }

                if (type === 'CURRENT') {
                    continue;
                }

                if (!seen.has(schemaName)) {
                    seen.add(schemaName);
                    libraryList.push(schemaName);
                }
            }

            return {
                currentLibrary: currentLibrary ?? fallback.currentLibrary,
                libraryList: libraryList.length > 0 ? libraryList : fallback.libraryList
            };
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry] Failed to resolve job-aware library configuration (${error instanceof Error ? error.message : String(error)}). Falling back to connection config.`);
            return fallback;
        }
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
            this.output?.appendLine(`[Cmd Entry] Dedicated restart failed (${error instanceof Error ? error.message : String(error)}). Using shared SQL job.`);
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
            this.output?.appendLine(`[Cmd Entry] Dedicated ensure failed (${error instanceof Error ? error.message : String(error)}). Using shared SQL job.`);
            this.status = 'ended';
            this.dedicatedJobId = undefined;
            this.connectionKey = undefined;
            this.logRouteSnapshot('ensure.shared.ensureFailed', connection);
            return normalizeSqlJobId(connection.getSqlJobId());
        }
    }

    async cancelActive(connection: IBMi): Promise<void> {
        if (!this.isDedicatedEnabled(connection)) {
            return;
        }

        const sqlJobId = normalizeSqlJobId(this.dedicatedJobId);
        if (!sqlJobId) {
            return;
        }

        this.output?.appendLine(`[Cmd Entry] Requesting cancel for private SQL job ${sqlJobId}.`);
        await connection.runSQL(CANCEL_SQL_STATEMENT, { bindings: [sqlJobId] });
        this.output?.appendLine(`[Cmd Entry] Dedicated cancel SQL request submitted for ${sqlJobId}.`);
    }

    async dispose(): Promise<void> {
        await this.endDedicatedJob();
    }

    private readRowString(row: Record<string, unknown>, key: string): string | undefined {
        const direct = row[key];
        if (typeof direct === 'string') {
            return direct;
        }

        const upper = row[key.toUpperCase()];
        if (typeof upper === 'string') {
            return upper;
        }

        const lower = row[key.toLowerCase()];
        if (typeof lower === 'string') {
            return lower;
        }

        for (const [candidateKey, candidateValue] of Object.entries(row)) {
            if (candidateKey.toUpperCase() === key.toUpperCase() && typeof candidateValue === 'string') {
                return candidateValue;
            }
        }

        return undefined;
    }

    private normalizeLibraryName(value: string | undefined): string | undefined {
        if (!value) {
            return undefined;
        }

        const normalized = value.trim().toUpperCase();
        return normalized.length > 0 ? normalized : undefined;
    }

    private connectionConfigFallback(connection: IBMi): EffectiveJobConfig {
        const config = connection.getConfig() as {
            currentLibrary?: unknown;
            libraryList?: unknown;
        } | undefined;

        const currentLibrary = this.normalizeLibraryName(
            typeof config?.currentLibrary === 'string' ? config.currentLibrary : undefined
        );

        const libraryList = Array.isArray(config?.libraryList)
            ? (config.libraryList as unknown[])
                .filter((entry): entry is string => typeof entry === 'string')
                .map((entry) => this.normalizeLibraryName(entry))
                .filter((entry): entry is string => Boolean(entry))
            : [];

        return {
            currentLibrary,
            libraryList
        };
    }

    isRemoteMapepireServerEnabled(connection?: IBMi): boolean {
        if (!connection) {
            return false;
        }
        const config = (connection as any).getConfig?.() ?? {};
        return isTruthyConfigFlag(config.mapepireUseServer)
            || isTruthyConfigFlag(config.mapepireServerMode)
            || isTruthyConfigFlag(config.connectToRemoteMapepireServer);
    }

    private async ensureJob(connection: IBMi): Promise<void> {
        const key = this.buildConnectionKey(connection);
        if (this.job && this.connectionKey === key) {
            this.debugLog('[Cmd Entry] Reusing existing private SQL job');
            this.status = 'ready';
            return;
        }

        this.debugLog('[Cmd Entry] Creating new private SQL job...');
        await this.endDedicatedJob();
        await this.createDedicatedJob(connection, key);

        // In Mapepire server mode, a recycled host job may carry previous session state
        // (for example custom library list). Force one reconnect cycle per connection key
        // at first acquisition so startup behavior matches explicit "Reconnect Server Job".
        await this.maybeForceStartupReconnect(connection, key);
    }

    private async createDedicatedJob(connection: IBMi, key: string): Promise<void> {
        this.debugLog('[Cmd Entry] Getting Mapepire component from connection...');
        const mapepire = await connection.getComponent('mapepire', { ignoreState: true }) as unknown as MapepireLike | undefined;
        if (!mapepire) {
            throw new Error('Code for IBM i Mapepire component is unavailable for dedicated CLPROMPTER job mode.');
        }

        this.debugLog('[Cmd Entry] Creating new Mapepire job...');
        const jdbc = this.buildJdbcOptionsForDedicatedJob(connection);
        this.job = await mapepire.newJob(connection, { jdbc });
        this.connectionKey = key;
        this.status = 'ready';

        try {
            await this.runStartupSqlHooks(connection);
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry][StartupSql] bootstrap failed error=${error instanceof Error ? error.message : String(error)}`);
        }

        this.debugLog('[Cmd Entry] Reading private SQL job ID...');
        this.dedicatedJobId = await this.readDedicatedJobId(connection);
        void this.refreshManagedSession(connection);
        this.output?.appendLine(`[Cmd Entry] Started private SQL job ${this.dedicatedJobId || '<unknown>'}.`);
    }

    private buildJdbcOptionsForDedicatedJob(connection: IBMi): JdbcOptionsLike {
        const jdbc = { ...(connection.getSqlJobJDBCOptions() as JdbcOptionsLike || {}) };
        const sessionOptions = getConnectionSqlSessionOptions(connection);

        jdbc.naming = sessionOptions.naming === 'system' ? 'system' : 'sql';

        const dateFormatMap: Record<string, string> = {
            '*ISO': 'iso',
            '*USA': 'usa',
            '*EUR': 'eur',
            '*JIS': 'jis',
            '*MDY': 'mdy',
            '*DMY': 'dmy',
            '*YMD': 'ymd',
        };
        const timeFormatMap: Record<string, string> = {
            '*HMS': 'hms',
            '*ISO': 'iso',
            '*USA': 'usa',
            '*EUR': 'eur',
            '*JIS': 'jis',
        };

        const mappedDate = sessionOptions.datfmt ? dateFormatMap[sessionOptions.datfmt] : undefined;
        if (mappedDate) {
            jdbc['date format'] = mappedDate;
        }

        const mappedTime = sessionOptions.timfmt ? timeFormatMap[sessionOptions.timfmt] : undefined;
        if (mappedTime) {
            jdbc['time format'] = mappedTime;
        }

        const commit = sessionOptions.commit;
        if (commit) {
            switch (commit) {
                case '*AUTO':
                    jdbc['auto commit'] = true;
                    break;
                case '*NONE':
                    jdbc['auto commit'] = false;
                    jdbc['transaction isolation'] = 'none';
                    break;
                case '*RR':
                    jdbc['auto commit'] = true;
                    jdbc['true autocommit'] = true;
                    jdbc['transaction isolation'] = 'repeatable read';
                    break;
                case '*CHG':
                case '*CS':
                    jdbc['auto commit'] = true;
                    jdbc['true autocommit'] = true;
                    jdbc['transaction isolation'] = 'read committed';
                    break;
                default:
                    break;
            }
        }

        return jdbc;
    }

    private async maybeForceStartupReconnect(connection: IBMi, key: string): Promise<void> {
        if (!this.isRemoteMapepireServerEnabled(connection)) {
            return;
        }

        if (this.startupReconnectCompleted.has(key)) {
            return;
        }

        this.startupReconnectCompleted.add(key);
        this.output?.appendLine('[Cmd Entry] Performing startup reconnect cycle for private SQL job to reset host job environment.');

        try {
            await this.cancelActive(connection);
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry] Startup reconnect cancel request failed (continuing): ${error instanceof Error ? error.message : String(error)}`);
        }

        await this.endDedicatedJob();
        await this.createDedicatedJob(connection, key);
        this.output?.appendLine('[Cmd Entry] Startup reconnect cycle complete. Private SQL job environment reset.');
    }

    private async readDedicatedJobId(connection: IBMi): Promise<string | undefined> {
        if (!this.job) {
            return undefined;
        }

        try {
            // Tier 1: Check for properties on the job object
            this.debugLog('[Cmd Entry] Checking Mapepire job object for ID properties...');
            const jobProperties = ['jobId', 'id', 'getId', 'getJobId', 'jobName', 'jobinfo'];
            for (const prop of jobProperties) {
                if (prop in this.job) {
                    const value = (this.job as any)[prop];
                    this.debugLog(`[Cmd Entry] Job.${prop} = ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                    if (typeof value === 'string') {
                        const normalized = normalizeSqlJobId(value);
                        if (normalized) {
                            this.debugLog(`[Cmd Entry] Private SQL job ID from Job.${prop}: ${normalized}`);
                            return normalized;
                        }
                    } else if (typeof value === 'function') {
                        try {
                            const result = await value.call(this.job);
                            this.debugLog(`[Cmd Entry] Job.${prop}() returned: ${typeof result === 'string' ? result : JSON.stringify(result)}`);
                            const normalized = normalizeSqlJobId(result);
                            if (normalized) {
                                this.debugLog(`[Cmd Entry] Private SQL job ID from Job.${prop}(): ${normalized}`);
                                return normalized;
                            }
                        } catch (e) {
                            this.debugLog(`[Cmd Entry] Job.${prop}() threw: ${e instanceof Error ? e.message : String(e)}`);
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
                    this.debugLog(`[Cmd Entry] Trying SQL query: ${query}`);
                    const rawResult = await this.job.execute(query);
                    const rows = this.rowsFromExecutionResult(rawResult);
                    const row = rows?.[0];
                    if (row) {
                        const value = row.JOB_ID ?? row.JOB_NAME ?? Object.values(row)[0];
                        this.debugLog(`[Cmd Entry] Query returned: ${typeof value === 'string' ? value : JSON.stringify(value)}`);
                        const normalized = normalizeSqlJobId(value == null ? undefined : String(value));
                        if (normalized) {
                            this.debugLog(`[Cmd Entry] Private SQL job ID from SQL: ${normalized}`);
                            return normalized;
                        }
                    } else {
                        this.debugLog('[Cmd Entry] Query returned no rows');
                    }
                } catch (e) {
                    this.debugLog(`[Cmd Entry] Query failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }

            this.debugLog('[Cmd Entry] All attempts to retrieve private SQL job ID failed');
            return undefined;
        } catch (error) {
            this.output?.appendLine(`[Cmd Entry] Unexpected error reading private SQL job ID: ${error instanceof Error ? error.message : String(error)}`);
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
            this.output?.appendLine(`[Cmd Entry] Failed to close private SQL job cleanly: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    private buildConnectionKey(connection: IBMi): string {
        const host = String(connection.currentHost ?? (connection as any).host ?? '').trim().toLowerCase();
        const user = String(connection.currentUser ?? (connection as any).username ?? '').trim().toLowerCase();
        const port = String(connection.currentPort ?? (connection as any).port ?? '').trim();
        return `${host}|${user}|${port}`;
    }
}
