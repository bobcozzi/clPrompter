import * as vscode from 'vscode';
import type IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

export type ConnectionSqlSettings = {
    useSharedJob: boolean;
    limitFetch: boolean;
    fetchRowLimit: number;
    firstPageRowsToFetch: number;
};

type ConnectionSqlSettingsOverride = Partial<ConnectionSqlSettings>;
const PRIMARY_CONNECTION_SETTINGS_KEY = 'cmdEntry';

type CLCommandSettings = {
    sharedSQLJob?: boolean;
    sharedSqlJob?: boolean;
};

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
    };
}

export function getConnectionSqlSettings(_context: vscode.ExtensionContext, connection?: IBMi): ConnectionSqlSettings {
    const defaults = getDefaultConnectionSqlSettings();
    const commandSettings = readConnectionCommandSettings(connection);
    const useSharedOverride = readBooleanSetting(commandSettings?.sharedSQLJob)
        ?? readBooleanSetting(commandSettings?.sharedSqlJob);

    return {
        useSharedJob: useSharedOverride ?? defaults.useSharedJob,
        limitFetch: defaults.limitFetch,
        fetchRowLimit: defaults.fetchRowLimit,
        firstPageRowsToFetch: defaults.firstPageRowsToFetch,
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
        const next: CLCommandSettings = {
            ...existing,
            ...(typeof partial.useSharedJob === 'boolean' ? { sharedSQLJob: partial.useSharedJob, sharedSqlJob: partial.useSharedJob } : {}),
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
