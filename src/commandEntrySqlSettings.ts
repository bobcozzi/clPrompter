import * as vscode from 'vscode';
import type IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

export type ConnectionSqlSessionOptions = {
    naming?: 'sql' | 'system';
    commit?: string;
    autoCommit?: boolean;
    extendedMetadata?: boolean;
    currentLibrary?: string;
    setCurrentLibraryAfterConnect?: boolean;
    libraryList?: string[];
    runAfterSqlJobInit?: string[];
    datfmt?: string;
    timfmt?: string;
    initialSchema?: string;
    initialPath?: string;
};

export type ConnectionSqlSettings = {
    useSharedJob: boolean;
    limitFetch: boolean;
    fetchRowLimit: number;
    firstPageRowsToFetch: number;
    autoColumnViewForSingleRow: boolean;
    sessionOptions: ConnectionSqlSessionOptions;
};

type ConnectionSqlSettingsOverride = Partial<ConnectionSqlSettings>;
const PRIMARY_CONNECTION_SETTINGS_KEY = 'cmdEntry';

type CLCommandSettings = {
    sharedSQLJob?: boolean;
    sharedSqlJob?: boolean;
    autoColumnViewForSingleRow?: boolean;
    sqlSessionOptions?: ConnectionSqlSessionOptions;
};

type SessionContextTarget = 'schema' | 'path';

function buildConnectionKey(connection?: IBMi): string | undefined {
    if (!connection) {
        return undefined;
    }

    const host = String(connection.currentHost ?? (connection as any).host ?? '').trim();
    const user = String(connection.currentUser ?? (connection as any).username ?? '').trim();
    const name = String(connection.currentConnectionName ?? (connection as any).name ?? '').trim();
    const port = String(connection.currentPort ?? (connection as any).port ?? '').trim();

    const key = `${host}|${user}|${name}|${port}`;
    return key.length > 0 ? key.toLowerCase() : undefined;
}

function readConnectionConfig(connection?: IBMi): Record<string, unknown> | undefined {
    if (!connection) {
        return undefined;
    }

    try {
        const config = connection.getConfig() as Record<string, unknown> | undefined;
        return config && typeof config === 'object' ? config : undefined;
    } catch {
        return undefined;
    }
}

function readConnectionCommandSettings(connection?: IBMi): CLCommandSettings | undefined {
    const config = readConnectionConfig(connection);
    if (!config) {
        return undefined;
    }

    const primary = config[PRIMARY_CONNECTION_SETTINGS_KEY];
    if (primary && typeof primary === 'object') {
        return primary as CLCommandSettings;
    }

    const extensionScoped = config.clPrompter;
    if (extensionScoped && typeof extensionScoped === 'object') {
        const nested = (extensionScoped as Record<string, unknown>)[PRIMARY_CONNECTION_SETTINGS_KEY];
        if (nested && typeof nested === 'object') {
            return nested as CLCommandSettings;
        }
    }

    const extensionScopedLower = config.clprompter;
    if (extensionScopedLower && typeof extensionScopedLower === 'object') {
        const nested = (extensionScopedLower as Record<string, unknown>)[PRIMARY_CONNECTION_SETTINGS_KEY];
        if (nested && typeof nested === 'object') {
            return nested as CLCommandSettings;
        }
    }

    return undefined;
}

function readBooleanSetting(value: unknown): boolean | undefined {
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
}

function normalizeSqlOptionValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    const normalized = trimmed.toUpperCase();
    return normalized.startsWith('*') ? normalized : `*${normalized}`;
}

function normalizeLibraryName(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toUpperCase();
    if (!normalized) {
        return undefined;
    }

    if (normalized.length > 10) {
        return undefined;
    }

    if (!/^[A-Z0-9_$#@]+$/.test(normalized)) {
        return undefined;
    }

    return normalized;
}

function normalizeCurrentLibraryValue(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toUpperCase();
    if (!normalized) {
        return undefined;
    }

    if (normalized === '*NONE' || normalized === '*CRTDFT' || normalized === '*CURRENT') {
        return normalized;
    }

    const library = normalizeLibraryName(normalized);
    if (library) {
        return library;
    }

    return undefined;
}

function normalizeLibraryListToken(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const normalized = value.trim().toUpperCase();
    if (!normalized) {
        return undefined;
    }

    if (normalized === '*NONE' || normalized === '*EMPTY' || normalized === '*LIBL') {
        return normalized;
    }

    const library = normalizeLibraryName(normalized);
    if (library) {
        return library;
    }

    return undefined;
}

function normalizeLibraryList(value: unknown): string[] | undefined {
    const tokens = Array.isArray(value)
        ? value.map(item => String(item ?? ''))
        : typeof value === 'string'
            ? value.split(/[\s,]+/)
            : [];

    if (tokens.length === 0) {
        return undefined;
    }

    const normalized: string[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
        const library = normalizeLibraryListToken(token);
        if (!library || seen.has(library) || library === '*NONE' || library === '*EMPTY') {
            continue;
        }
        seen.add(library);
        normalized.push(library);
    }

    return normalized.length > 0 ? normalized : undefined;
}

export function splitRunAfterSqlJobInitStatements(value: unknown): string[] | undefined {
    const entries = Array.isArray(value)
        ? value.map((item) => String(item ?? ''))
        : typeof value === 'string'
            ? [value]
            : [];

    if (entries.length === 0) {
        return undefined;
    }

    const statements: string[] = [];
    const seen = new Set<string>();

    const pushStatement = (statement: string): void => {
        const trimmed = statement.trim().replace(/;\s*$/, '').trim();
        if (!trimmed || seen.has(trimmed)) {
            return;
        }
        seen.add(trimmed);
        statements.push(trimmed);
    };

    for (const entry of entries) {
        let current = '';
        let inSingleQuote = false;
        let inDoubleQuote = false;

        for (let index = 0; index < entry.length; index += 1) {
            const char = entry[index];
            const nextChar = entry[index + 1];

            if ((char === '\r' || char === '\n') && !inSingleQuote && !inDoubleQuote) {
                if (current.length > 0 && !/\s$/.test(current)) {
                    current += ' ';
                }
                if (char === '\r' && nextChar === '\n') {
                    index += 1;
                }
                continue;
            }

            if (char === '\'' && !inDoubleQuote) {
                current += char;
                if (inSingleQuote && nextChar === '\'') {
                    current += nextChar;
                    index += 1;
                } else {
                    inSingleQuote = !inSingleQuote;
                }
                continue;
            }

            if (char === '"' && !inSingleQuote) {
                current += char;
                if (inDoubleQuote && nextChar === '"') {
                    current += nextChar;
                    index += 1;
                } else {
                    inDoubleQuote = !inDoubleQuote;
                }
                continue;
            }

            if (char === ';' && !inSingleQuote && !inDoubleQuote) {
                pushStatement(current);
                current = '';
                continue;
            }

            current += char;
        }

        pushStatement(current);
    }

    return statements.length > 0 ? statements : undefined;
}

export function expandStartupScriptPlaceholders(command: string, currentLibrary?: string, libraryList?: string[]): string {
    if (!command || !command.trim()) {
        return command;
    }

    const resolvedCurrentLibrary = normalizeCurrentLibraryValue(currentLibrary) ?? '*CRTDFT';
    const resolvedLibraryList = normalizeLibraryList(libraryList) ?? ['*LIBL'];
    const currentLibraryValue = resolvedCurrentLibrary === '*NONE' || resolvedCurrentLibrary === '*CRTDFT'
        ? '*CRTDFT'
        : resolvedCurrentLibrary;
    const libraryListValue = resolvedLibraryList.length > 0 ? resolvedLibraryList.join(' ') : '*LIBL';

    return command
        .replace(/&CURLIB\b/gi, currentLibraryValue)
        .replace(/&LIBL\b/gi, libraryListValue);
}

function normalizeRunAfterSqlJobInitValue(value: unknown): string[] | undefined {
    return splitRunAfterSqlJobInitStatements(value);
}

function normalizeSessionContextValueForTarget(value: unknown, target: SessionContextTarget): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }

    let effective = trimmed;

    if (target === 'path' && /^SET\s+PATH\b/i.test(trimmed)) {
        effective = trimmed.replace(/^SET\s+PATH\s*=?\s*/i, '');
    } else if (target === 'schema' && /^SET\s+CURRENT\s+SCHEMA\b/i.test(trimmed)) {
        effective = trimmed.replace(/^SET\s+CURRENT\s+SCHEMA\s*=?\s*/i, '');
    } else if (target === 'schema' && /^SET\s+SCHEMA\b/i.test(trimmed)) {
        effective = trimmed.replace(/^SET\s+SCHEMA\s*=?\s*/i, '');
    }

    const normalized = effective.trim();
    if (!normalized) {
        return undefined;
    }

    return normalized;
}

export function normalizeSessionContextValue(value: unknown): string | undefined {
    return normalizeSessionContextValueForTarget(value, 'path');
}

export function normalizeSchemaSessionContextValue(value: unknown): string | undefined {
    return normalizeSessionContextValueForTarget(value, 'schema');
}

function normalizeInitialSchemaValue(value: unknown): string | undefined {
    const normalized = normalizeSchemaSessionContextValue(value);
    if (!normalized) {
        return undefined;
    }

    return normalized.length <= 128 ? normalized : undefined;
}

export function getDefaultConnectionSqlSessionOptions(): ConnectionSqlSessionOptions {
    return {
        naming: 'sql',
        commit: undefined,
        autoCommit: undefined,
        extendedMetadata: true,
        currentLibrary: undefined,
        setCurrentLibraryAfterConnect: true,
        libraryList: undefined,
        runAfterSqlJobInit: undefined,
        datfmt: undefined,
        timfmt: undefined,
        initialSchema: undefined,
        initialPath: undefined,
    };
}

export function getConnectionSqlSessionOptions(connection?: IBMi): ConnectionSqlSessionOptions {
    const defaults = getDefaultConnectionSqlSessionOptions();
    const commandSettings = readConnectionCommandSettings(connection);
    const raw = commandSettings?.sqlSessionOptions ?? {};

    const naming = raw.naming === 'system' ? 'system' : 'sql';
    return {
        naming,
        commit: normalizeSqlOptionValue(raw.commit) ?? defaults.commit,
        autoCommit: readBooleanSetting(raw.autoCommit) ?? defaults.autoCommit,
        extendedMetadata: readBooleanSetting(raw.extendedMetadata) ?? defaults.extendedMetadata,
        currentLibrary: normalizeCurrentLibraryValue(raw.currentLibrary) ?? defaults.currentLibrary,
        setCurrentLibraryAfterConnect: readBooleanSetting(raw.setCurrentLibraryAfterConnect) ?? defaults.setCurrentLibraryAfterConnect,
        libraryList: normalizeLibraryList(raw.libraryList) ?? defaults.libraryList,
        runAfterSqlJobInit: normalizeRunAfterSqlJobInitValue(raw.runAfterSqlJobInit) ?? defaults.runAfterSqlJobInit,
        datfmt: normalizeSqlOptionValue(raw.datfmt) ?? defaults.datfmt,
        timfmt: normalizeSqlOptionValue(raw.timfmt) ?? defaults.timfmt,
        initialSchema: normalizeInitialSchemaValue(raw.initialSchema) ?? defaults.initialSchema,
        initialPath: normalizeSessionContextValueForTarget(raw.initialPath, 'path') ?? defaults.initialPath,
    };
}

export function toNormalizedSessionContextValue(value: unknown): string | undefined {
    return normalizeSessionContextValue(value);
}

export function buildImmediateSessionContextSql(options?: ConnectionSqlSessionOptions): string[] {
    if (!options) {
        return [];
    }

    const statements: string[] = [];
    const initialSchema = normalizeInitialSchemaValue(options.initialSchema);
    if (initialSchema) {
        const schemaValue = initialSchema.toUpperCase() === '*LIBL' ? 'DEFAULT' : initialSchema;
        statements.push(`SET SCHEMA ${schemaValue}`);
    }

    const initialPath = normalizeSessionContextValueForTarget(options.initialPath, 'path');
    if (initialPath) {
        statements.push(`SET PATH ${initialPath}`);
    }

    return statements;
}

export function buildStartupSqlForSessionOptions(options?: ConnectionSqlSessionOptions): string[] {
    return buildRunAfterSqlJobInitDefaults(options);
}

export function buildRunAfterSqlJobInitDefaults(options?: ConnectionSqlSessionOptions): string[] {
    const settings = { ...getDefaultConnectionSqlSessionOptions(), ...(options ?? {}) };
    const initialPath = normalizeSessionContextValueForTarget(settings.initialPath, 'path') ?? '*LIBL';
    const schemaSource = normalizeInitialSchemaValue(settings.initialSchema) ?? '*LIBL';
    const schemaValue = schemaSource.toUpperCase() === '*LIBL' ? 'DEFAULT' : schemaSource;

    const statements: string[] = [
        `SET PATH ${initialPath}`,
        `SET SCHEMA ${schemaValue}`
    ];

    const libraryList = normalizeLibraryList(settings.libraryList) ?? [];
    if (libraryList.length > 0) {
        statements.push('CHGLIBL LIBL(&libl)');
    }

    if (settings.setCurrentLibraryAfterConnect) {
        const currentLibrary = normalizeCurrentLibraryValue(settings.currentLibrary);
        if (currentLibrary && currentLibrary !== '*NONE' && currentLibrary !== '*CRTDFT') {
            statements.push('CHGCURLIB CURLIB(&curlib)');
        }
    }

    return statements;
}

export function getDefaultConnectionSqlSettings(): ConnectionSqlSettings {
    const config = vscode.workspace.getConfiguration('clPrompter');
    return {
        useSharedJob: config.get<boolean | undefined>('cmdEntrySQLUseSharedJob')
            ?? config.get<boolean | undefined>('cmdEntryUseSharedSQLJob')
            ?? true,
        limitFetch: config.get<boolean | undefined>('cmdEntrySQLLimitFetch')
            ?? config.get<boolean | undefined>('cmdEntryLimitSqlFetch')
            ?? config.get<boolean | undefined>('cmdEntrySqlFetchLimitEnabled')
            ?? config.get<boolean>('commandEntrySqlFetchLimitEnabled', true),
        fetchRowLimit: config.get<number | undefined>('cmdEntrySqlFetchRowLimit')
            ?? config.get<number | undefined>('cmdEntrySqlFetchLimitRows')
            ?? config.get<number>('commandEntrySqlFetchLimitRows', 1000),
        firstPageRowsToFetch: config.get<number | undefined>('cmdEntrySqlFirstPageRowsToFetch')
            ?? config.get<number | undefined>('cmdEntrySqlPrefetchRows')
            ?? config.get<number>('commandEntrySqlPrefetchRows', 200),
        autoColumnViewForSingleRow: config.get<boolean>('cmdEntryAutoColumnViewSingleRow', false),
        sessionOptions: getDefaultConnectionSqlSessionOptions(),
    };
}

export function getConnectionSqlSettings(_context?: vscode.ExtensionContext, connection?: IBMi): ConnectionSqlSettings {
    const defaults = getDefaultConnectionSqlSettings();
    const commandSettings = readConnectionCommandSettings(connection);
    const useSharedOverride = readBooleanSetting(commandSettings?.sharedSQLJob)
        ?? readBooleanSetting(commandSettings?.sharedSqlJob);
    const autoColumnViewForSingleRow = readBooleanSetting(commandSettings?.autoColumnViewForSingleRow);

    return {
        useSharedJob: useSharedOverride ?? defaults.useSharedJob,
        limitFetch: defaults.limitFetch,
        fetchRowLimit: defaults.fetchRowLimit,
        firstPageRowsToFetch: defaults.firstPageRowsToFetch,
        autoColumnViewForSingleRow: autoColumnViewForSingleRow ?? defaults.autoColumnViewForSingleRow,
        sessionOptions: getConnectionSqlSessionOptions(connection),
    };
}

export async function updateConnectionSqlSettings(
    _context: vscode.ExtensionContext,
    connection: IBMi | undefined,
    partial: ConnectionSqlSettingsOverride
): Promise<void> {
    const config = readConnectionConfig(connection);
    if (connection && config) {
        const existing = readConnectionCommandSettings(connection) ?? {};
        const nextSessionOptions = {
            ...existing.sqlSessionOptions,
            ...(partial.sessionOptions ?? {}),
        };

        const next: CLCommandSettings = {
            ...existing,
            ...(typeof partial.useSharedJob === 'boolean' ? { sharedSQLJob: partial.useSharedJob, sharedSqlJob: partial.useSharedJob } : {}),
            ...(typeof partial.autoColumnViewForSingleRow === 'boolean' ? { autoColumnViewForSingleRow: partial.autoColumnViewForSingleRow } : {}),
            ...(Object.keys(nextSessionOptions).length > 0 ? { sqlSessionOptions: nextSessionOptions } : {}),
        };

        const nextConfig = { ...config, [PRIMARY_CONNECTION_SETTINGS_KEY]: next } as Record<string, unknown>;
        connection.setConfig(nextConfig as any);

        const connectionManager = ((connection as any)?.constructor as any)?.connectionManager;
        if (connectionManager && typeof connectionManager.update === 'function') {
            await connectionManager.update(nextConfig);
        }
    }
}

export async function clearConnectionSqlSettings(_context: vscode.ExtensionContext, connection: IBMi | undefined): Promise<void> {
    const config = readConnectionConfig(connection);
    if (connection && config) {
        const nextConfig = { ...config } as Record<string, unknown>;
        const raw = nextConfig[PRIMARY_CONNECTION_SETTINGS_KEY];
        if (raw && typeof raw === 'object') {
            const nextCommandSettings = { ...(raw as CLCommandSettings) };
            delete nextCommandSettings.sharedSQLJob;
            delete nextCommandSettings.sharedSqlJob;
            delete nextCommandSettings.autoColumnViewForSingleRow;
            delete nextCommandSettings.sqlSessionOptions;

            if (Object.keys(nextCommandSettings).length === 0) {
                delete nextConfig[PRIMARY_CONNECTION_SETTINGS_KEY];
            } else {
                nextConfig[PRIMARY_CONNECTION_SETTINGS_KEY] = nextCommandSettings;
            }
        }
        connection.setConfig(nextConfig as any);

        const connectionManager = ((connection as any)?.constructor as any)?.connectionManager;
        if (connectionManager && typeof connectionManager.update === 'function') {
            await connectionManager.update(nextConfig);
        }
    }
}
