import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import * as vscode from 'vscode';
import { CLPrompter } from './clPrompter';
import { CommandEntryJobManager } from './commandEntryJobManager';
import { CommandEntryHistory, CommandExecutionMode } from './commandEntryModel';
import { detectCommandEntryPrefix } from './commandEntryPrefixes';
import { CommandEntryService } from './commandEntryService';
import { BUILT_IN_SQL_SNIPPETS, CommandEntrySqlSnippet } from './commandEntrySnippets';
import { buildImmediateSessionContextSql, buildRunAfterSqlJobInitDefaults, getConnectionSqlSessionOptions, getConnectionSqlSettings, normalizeSchemaSessionContextValue, normalizeSessionContextValue, splitLibraryListTokens, splitRunAfterSqlJobInitStatements, updateConnectionSqlSettings } from './commandEntrySqlSettings';
import { closeSqlResultPanel, configureSqlResultPanelAssets, notifySqlResultSessionClosed, setSqlResultPanelRequestHandler, showSqlResultPanel } from './sqlResultPanel';

const HISTORY_KEY = 'commandEntry.history';
const MAX_HISTORY = 100;
const SKIP_HISTORY_CLEAR_ON_NEXT_READY_KEY = 'clprompter.skipHistoryClearOnNextReady';
const SQL_SNIPPETS_USER_KEY = 'commandEntry.sqlSnippets.user';
const SQL_SNIPPETS_ORDER_KEY = 'commandEntry.sqlSnippets.order';
const SQL_SNIPPETS_HIDDEN_BUILTINS_KEY = 'commandEntry.sqlSnippets.hiddenBuiltins';
const SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY = 'commandEntry.sqlSnippets.defaultsMergedVersion';
const SQL_SNIPPETS_MAX = 200;
const COMMAND_PICKER_MIN_ROWS_LIMIT = 5000;
const COMMAND_PICKER_MAX_ROWS_LIMIT = 25000;
const COMMAND_PICKER_GENERIC_FETCH_ROWS_DEFAULT = 500;
const CMD_ENTRY_HELP_PANEL_TYPE = 'clprompter.commandEntryHelp';
const CMD_ENTRY_HELP_PANEL_TITLE = vscode.l10n.t('CL Command Entry Help');
const AUTO_INIT_FAILURE_COOLDOWN_MS = 15_000;
const SQL_NOT_LOGGED_FEEDBACK_MAX_PER_SESSION = 3;
export const DEFAULT_CODE_SNIPPET_GROUPS = ['Job Info', 'Admin', 'SPOOLED Files'] as const;

type CommandEntryRequest =
    | { type: 'ready' }
    | { type: 'run'; command: string; mode: CommandExecutionMode }
    | { type: 'prompt'; command: string }
    | { type: 'requestHistoryPicker' }
    | { type: 'copyCommand'; command: string }
    | { type: 'copySqlJobId'; sqlJobId: string }
    | { type: 'requestDisplayJoblog'; sqlJobId: string }
    | { type: 'requestSqlJobId' }
    | { type: 'requestCancelSqlJob' }
    | { type: 'manageCodeSnippets' }
    | { type: 'openCmdEntryHelp' }
    | { type: 'openCmdEntrySettings' }
    | { type: 'openClPrompterSettings' }
    | { type: 'openSnippetsMenu' }
    | { type: 'openSqlSnippetsMenu' }
    | { type: 'menuDebug'; phase: string; payload?: unknown }
    | { type: 'toggleMessageDetails' }
    | { type: 'toggleSqlStatementsToCommandLog' }
    | { type: 'useSharedSqlJob' }
    | { type: 'usePrivateSqlJob' }
    | { type: 'startNewJob' }
    | { type: 'clearSqlLogMessages' }
    | { type: 'clearSqlHistoryAndMessages' }
    | { type: 'clearHistoryAndMessages' }
    | { type: 'clear' };

type MessageDetailsMode = 'SHOW' | 'HIDE';

export interface CodeSnippetRecord {
    id: string;
    label: string;
    codeTemplate: string;
    group: string;
    order?: number;
    source: 'built-in' | 'user';
}

interface CommandEntrySqlSnippetUser {
    id: string;
    label: string;
    stmt: string;
    group: string;
    order?: number;
    createdAt: string;
    updatedAt: string;
}

type CodeSnippetImportMode = 'merge' | 'replace-all' | 'add-new-only';

function normalizeSnippetOrder(value: unknown): number | undefined {
    if (value === undefined || value === null || value === '') {
        return undefined;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return undefined;
    }

    const whole = Math.trunc(parsed);
    return whole >= 0 ? whole : undefined;
}

interface SnippetTemplateContext {
    sqlJobId?: string;
    sqlJobName?: string;
    sqlJobNumber?: string;
    currentUser?: string;
    currentLibrary?: string;
    userSBSList?: string;
}
function isSqlCommandText(command: string): boolean {
    const text = String(command ?? '');
    const explicitPrefix = detectCommandEntryPrefix(text);
    if (explicitPrefix === 'CL') {
        return false;
    }
    if (explicitPrefix === 'SQL') {
        return true;
    }
    return /^\s*(select|values|with)\b/i.test(text);
}

function ensureSqlPrefixForRecall(command: string, isSql: boolean): string {
    const text = String(command ?? '');
    if (!isSql) {
        return text;
    }
    if (detectCommandEntryPrefix(text)) {
        return text;
    }
    const trimmed = text.trim();
    return trimmed ? `SQL: ${trimmed}` : text;
}

function extractGoCommandName(command: string): string | undefined {
    const text = String(command ?? '').trim();
    const match = /^(?:QSYS\/)?GO\s+CMD(\S+)\s*$/i.exec(text);
    if (!match) {
        return undefined;
    }

    const commandName = String(match[1] || '').trim().replace(/\*$/, '');
    return commandName || undefined;
}

function resolvePromptPrefixedCommand(command: string): { promptCommand?: string; syntaxError?: string } | undefined {
    const text = String(command ?? '');
    const trimmedStart = text.trimStart();
    const hasLeadingQuestion = trimmedStart.startsWith('?');
    const withoutLeadingQuestion = hasLeadingQuestion ? trimmedStart.slice(1).trimStart() : trimmedStart;

    if (hasLeadingQuestion && !withoutLeadingQuestion) {
        return { promptCommand: '' };
    }

    const explicitPrefixMatch = withoutLeadingQuestion.match(/^(cl|sql)\s*:\s*([\s\S]*)$/i);
    if (explicitPrefixMatch) {
        const prefix = explicitPrefixMatch[1].toUpperCase();
        const remainder = String(explicitPrefixMatch[2] || '').trimStart();
        if (!remainder.startsWith('?') && !hasLeadingQuestion) {
            return undefined;
        }

        const commandAfterQuestion = remainder.startsWith('?')
            ? remainder.slice(1).trimStart()
            : remainder;
        if (prefix === 'SQL') {
            // Preserve SQL-prefix intent so prompt path can report the standard SQL prompt restriction.
            return { promptCommand: `SQL: ${commandAfterQuestion}`.trim() };
        }

        return { promptCommand: commandAfterQuestion };
    }

    const genericLabelMatch = withoutLeadingQuestion.match(/^([^:\s][^:]*)\s*:\s*([\s\S]*)$/);
    if (genericLabelMatch) {
        const remainder = String(genericLabelMatch[2] || '').trimStart();
        if (!remainder.startsWith('?') && !hasLeadingQuestion) {
            return undefined;
        }
        return {
            promptCommand: remainder.startsWith('?')
                ? remainder.slice(1).trimStart()
                : remainder
        };
    }

    if (hasLeadingQuestion) {
        return { promptCommand: withoutLeadingQuestion };
    }

    return undefined;
}

function splitUserCommandLabel(command: string): { labelPrefix?: string; commandText: string } {
    const text = String(command ?? '');
    const trimmedStart = text.trimStart();
    const withoutLeadingQuestion = trimmedStart.startsWith('?') ? trimmedStart.slice(1).trimStart() : trimmedStart;

    // Treat CL:/SQL: as execution prefixes, not user labels.
    if (/^(?:cl|sql)\s*:/i.test(withoutLeadingQuestion)) {
        return { commandText: withoutLeadingQuestion };
    }

    const genericLabelMatch = withoutLeadingQuestion.match(/^([^:\s][^:]*)\s*:\s*([\s\S]*)$/);
    if (!genericLabelMatch) {
        return { commandText: withoutLeadingQuestion };
    }

    const label = String(genericLabelMatch[1] || '').trim();
    const commandText = String(genericLabelMatch[2] || '');
    if (!label) {
        return { commandText: withoutLeadingQuestion };
    }

    return {
        labelPrefix: `${label}: `,
        commandText
    };
}

function applyUserCommandLabel(command: string, labelPrefix?: string): string {
    const normalized = String(command ?? '').trimStart();
    if (!labelPrefix) {
        return normalized;
    }
    return `${labelPrefix}${normalized}`;
}

function hasLeadingLabelOrPrefix(command: string): boolean {
    const trimmed = String(command ?? '').trimStart();
    return /^(?:cl|sql)\s*:/i.test(trimmed) || /^[^:\s][^:]*\s*:/.test(trimmed);
}

function normalizeSnippetSubsystemList(rawValue: unknown): string {
    const raw = String(rawValue ?? '').trim();
    if (!raw) {
        return '';
    }

    const tokens = raw
        .split(/[\s,;:]+/)
        .map((token) => token.trim().toUpperCase())
        .filter((token) => token.length > 0);

    if (tokens.length === 0) {
        return '';
    }

    if (tokens.length === 1 && (tokens[0] === '*ALL' || tokens[0] === '*NONE')) {
        return '';
    }

    return tokens.join(',');
}

/** Persistent panel webview. It deliberately does not own an IBM i connection. */
export class CommandEntryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'clprompter.commandEntryView.main';
    private view: vscode.WebviewView | undefined;
    private running = false;
    private activeExecutionId: string | undefined;
    private pendingCommandText: string | undefined;
    private clearInputOnFirstReady = true;
    private clearHistoryOnFirstReady = true;
    private lastPostedSqlJobId: string | undefined;
    private readonly autoInitInFlightConnectionKeys = new Set<string>();
    private readonly autoInitLastFailureByConnectionKey = new Map<string, number>();
    private remainingSqlNotLoggedFeedbackCount = SQL_NOT_LOGGED_FEEDBACK_MAX_PER_SESSION;
    private cmdEntryHelpPanel: vscode.WebviewPanel | undefined;
    private cmdEntrySettingsPanel: vscode.WebviewPanel | undefined;
    private startupScriptLogPanel: vscode.WebviewPanel | undefined;
    private readonly output: vscode.OutputChannel;
    private readonly jobManager: CommandEntryJobManager;
    private readonly service: CommandEntryService;
    private readonly onDidChangeCodeSnippetsEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeCodeSnippets = this.onDidChangeCodeSnippetsEmitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly getConnection: () => IBMi | undefined,
        dependencies?: {
            output?: vscode.OutputChannel;
            jobManager?: CommandEntryJobManager;
            service?: CommandEntryService;
        }
    ) {
        this.output = dependencies?.output ?? vscode.window.createOutputChannel('CLPROMPTER');
        this.jobManager = dependencies?.jobManager ?? new CommandEntryJobManager(this.output, this.context);
        this.service = dependencies?.service ?? new CommandEntryService(this.jobManager);
        configureSqlResultPanelAssets(this.context.extensionUri);

        setSqlResultPanelRequestHandler((request) => this.handleSqlResultPanelRequest(request));

        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            const connectionSettingsChanged = event.affectsConfiguration('code-for-ibmi.connectionSettings');
            const sqlFetchConfigChanged = event.affectsConfiguration('clPrompter.cmdEntrySQLLimitFetch')
                || event.affectsConfiguration('clPrompter.cmdEntryLimitSqlFetch')
                || event.affectsConfiguration('clPrompter.cmdEntrySqlFetchLimitEnabled')
                || event.affectsConfiguration('clPrompter.cmdEntrySqlFetchRowLimit')
                || event.affectsConfiguration('clPrompter.cmdEntrySqlFetchLimitRows')
                || event.affectsConfiguration('clPrompter.cmdEntrySqlFirstPageRowsToFetch')
                || event.affectsConfiguration('clPrompter.cmdEntrySqlPrefetchRows')
                || event.affectsConfiguration('clPrompter.commandEntrySqlFetchLimitEnabled')
                || event.affectsConfiguration('clPrompter.commandEntrySqlFetchLimitRows')
                || event.affectsConfiguration('clPrompter.commandEntrySqlPrefetchRows')
                || event.affectsConfiguration('clPrompter.commandEntrySqlFetchLimit');
            const sqlLogPreferenceChanged = event.affectsConfiguration('clPrompter.cmdEntryRecordSqlStmtsToLog');
            const historyScopeChanged = event.affectsConfiguration('clPrompter.cmdEntryHistoryConnectionScoped');
            const appearanceChanged = event.affectsConfiguration('clPrompter.cmdEntryCommandTextColor')
                || event.affectsConfiguration('clPrompter.commandEntryCommandTextColor')
                || event.affectsConfiguration('clPrompter.cmdEntrySqlStmtColor');
            if (!sqlFetchConfigChanged
                && !event.affectsConfiguration('clPrompter.cmdEntrySQLUseSharedJob')
                && !event.affectsConfiguration('clPrompter.cmdEntryUseSharedSQLJob')
                && !event.affectsConfiguration('clPrompter.cmdEntryUseDedicatedJob')
                && !event.affectsConfiguration('clPrompter.commandEntryUseDedicatedJob')
                && !event.affectsConfiguration('clPrompter.cmdEntryMessageDetails')
                && !event.affectsConfiguration('clPrompter.commandEntryMessageDetails')
                && !sqlLogPreferenceChanged
                && !historyScopeChanged
                && !appearanceChanged
                && !connectionSettingsChanged) {
                return;
            }

            if (sqlFetchConfigChanged) {
                this.safeOutputAppendLine(`[Cmd Entry] ${this.sqlFetchLimitDisplay()}`);
            }
            this.post({
                type: 'messageDetailsPreference',
                mode: this.messageDetailsMode()
            });
            this.postSqlLoggingPreference();
            this.postJobCapabilities();
            if (appearanceChanged) {
                this.postAppearancePreferences();
            }
            if (historyScopeChanged) {
                this.post({ type: 'historyUpdated', history: this.history() });
                this.post({
                    type: 'notice',
                    message: this.historyIsConnectionScoped()
                        ? vscode.l10n.t('Command Entry history retrieval is now scoped to the active connection.')
                        : vscode.l10n.t('Command Entry history retrieval is now shared across connections.')
                });
            }
            if (connectionSettingsChanged) {
                void this.applyConnectionSqlJobModeFromSettings('connectionSettingsChanged');
            }
        }));
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
        view.webview.html = this.html(view.webview);
        view.webview.onDidReceiveMessage((message: CommandEntryRequest) => this.receive(message), undefined, this.context.subscriptions);
        view.onDidChangeVisibility(() => {
            if (!view.visible) {
                return;
            }
            this.post({ type: 'focusInput' });
            setTimeout(() => this.post({ type: 'focusInput' }), 75);
        }, undefined, this.context.subscriptions);
        view.onDidDispose(() => {
            if (this.view === view) {
                this.view = undefined;
            }
        }, undefined, this.context.subscriptions);
    }

    focus(): void {
        this.view?.show?.(false);
        this.post({ type: 'focusInput' });
        // Revealing a view can create its webview asynchronously on first use.
        setTimeout(() => this.post({ type: 'focusInput' }), 75);
    }

    requestRun(): void { this.post({ type: 'runCurrent' }); }
    requestPrompt(): void { this.post({ type: 'promptCurrent' }); }
    setCommandText(command: string): void {
        const text = String(command || '');
        this.pendingCommandText = text;
        this.post({ type: 'setCommand', command: text });
        this.post({ type: 'focusInput' });
        setTimeout(() => {
            if (this.pendingCommandText === text) {
                this.post({ type: 'setCommand', command: text });
                this.post({ type: 'focusInput' });
            }
        }, 120);
    }
    requestCancel(): void { void this.requestCancelSqlJob(); }
    requestStartNewJob(): void { void this.startNewJob(); }
    requestUseSharedSqlJob(): void { void this.setSharedSqlJobMode(true, 'command'); }
    requestUsePrivateSqlJob(): void { void this.setSharedSqlJobMode(false, 'command'); }
    requestToggleMessageDetails(): void { void this.toggleMessageDetailsPreference(); }
    requestToggleSqlStatementsToCommandLog(): void { void this.toggleSqlStatementsToCommandLogPreference(); }
    requestViewHistory(): void { void this.showHistoryPicker(); }
    requestClearSqlLogMessages(): void { void this.clearSqlLogMessagesWithConfirmation(); }
    requestClearSqlHistoryAndMessages(): void { void this.clearSqlHistoryAndMessagesWithConfirmation(); }
    requestClearHistoryAndMessages(): void { void this.clearHistoryAndMessagesWithConfirmation(); }
    requestOpenConnectionSettings(): void { void this.openCmdEntrySettingsPanel(); }
    requestOpenHelp(): void { void this.openCmdEntryHelpPanel(); }
    requestOpenSettings(): void { void vscode.commands.executeCommand('workbench.action.openSettings', 'clPrompter.cmdEntry'); }
    requestSetRunMode(mode: '*RUN' | '*LIMIT' | '*CHECK'): void {
        this.post({ type: 'setMode', mode });
        this.post({ type: 'focusInput' });
    }
    async executeCodeSnippetById(id: string): Promise<void> { await this.executeSnippet(id); }
    resolveSnippetTemplateText(template: string): { resolved: string; missing: string[] } {
        const connection = this.getConnection();
        const context = this.buildSnippetContext(connection);
        const resolution = this.resolveSqlTemplate(template, context);
        return resolution;
    }
    listCodeSnippets(): CodeSnippetRecord[] {
        return this.getMergedSqlSnippets().map((snippet) => ({
            id: snippet.id,
            label: snippet.label,
            codeTemplate: snippet.stmt,
            group: snippet.group,
            order: snippet.order,
            source: snippet.source
        }));
    }
    async createCodeSnippet(label: string, codeTemplate: string, group = 'Admin', order?: number): Promise<void> {
        await this.addUserSqlSnippet(label, codeTemplate, group, order);
    }
    async updateCodeSnippet(id: string, label: string, codeTemplate: string, group?: string, order?: number): Promise<void> {
        await this.updateUserSqlSnippet(id, label, codeTemplate, group, order);
    }
    async deleteCodeSnippet(id: string): Promise<void> {
        await this.deleteSqlSnippet(id);
    }
    async moveCodeSnippet(id: string, direction: 'up' | 'down'): Promise<void> {
        await this.moveSnippet(id, direction);
    }
    async reorderCodeSnippets(orderedIds: string[]): Promise<void> {
        await this.persistMergedSnippetOrder(orderedIds);
        this.notifyCodeSnippetsChanged();
    }
    requestExportCodeSnippets(): void {
        void this.exportCodeSnippetsToJson().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: vscode.l10n.t('Export Code Snippets failed: {message}', { message }) });
        });
    }
    requestImportCodeSnippets(): void {
        void this.importCodeSnippetsFromJson().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: vscode.l10n.t('Import Code Snippets failed: {message}', { message }) });
        });
    }
    clear(): void {
        void this.service.closeSqlSession();
        this.post({ type: 'clearResults' });
    }

    async dispose(): Promise<void> {
        this.cmdEntrySettingsPanel?.dispose();
        this.cmdEntrySettingsPanel = undefined;
        setSqlResultPanelRequestHandler(undefined);
        closeSqlResultPanel();
        this.cmdEntryHelpPanel?.dispose();
        this.cmdEntryHelpPanel = undefined;
        await this.service.closeSqlSession();
        this.onDidChangeCodeSnippetsEmitter.dispose();
        await this.jobManager.dispose();
        this.output.dispose();
    }

    private async handleSqlResultPanelRequest(
        request:
            | { type: 'loadMore' | 'loadAll' | 'stopLoadAll' | 'prefetch' | 'closeSession'; sessionId: string }
            | { type: 'rerunSql'; statement: string; resultTitle?: string }
            | { type: 'copyResultSet'; columns: string[]; rows: string[][] }
            | { type: 'saveResultSet'; columns: string[]; rows: string[][]; resultTitle?: string }
            | { type: 'copyCellToClipboard'; value: string }
            | { type: 'copyCellToCommandEntry'; value: string }
    ) {
        if (request.type === 'copyResultSet' || request.type === 'saveResultSet') {
            return undefined;
        }

        if (request.type === 'copyCellToClipboard') {
            const value = String(request.value ?? '');
            await vscode.env.clipboard.writeText(value);
            this.post({ type: 'notice', message: vscode.l10n.t('Result cell copied to clipboard.') });
            return undefined;
        }

        if (request.type === 'copyCellToCommandEntry') {
            const value = String(request.value ?? '');
            await vscode.commands.executeCommand('clprompter.openCommandEntry');
            this.setCommandText(value);
            this.post({ type: 'notice', message: vscode.l10n.t('Result cell copied to Command Entry.') });
            return undefined;
        }

        if (request.type === 'rerunSql') {
            const statement = String(request.statement || '').trim();
            if (!statement) {
                throw new Error('No SQL statement was provided to rerun.');
            }

            const connection = this.getConnection();
            if (!connection || !connection.sqlRunnerAvailable()) {
                throw new Error('Not connected to IBM i, or the SQL runner is unavailable.');
            }

            const execution = await this.service.execute(connection, `SQL: ${statement}`, '*RUN', undefined, {
                resultTitle: request.resultTitle
            });
            if (execution.failure || !execution.sqlResult) {
                throw new Error(execution.failure || 'Unable to rerun SQL statement.');
            }

            return execution.sqlResult;
        }

        if (request.type === 'closeSession') {
            await this.service.closeSqlSession(request.sessionId);
            return undefined;
        }

        if (request.type === 'stopLoadAll') {
            return undefined;
        }

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            throw new Error('Not connected to IBM i, or the SQL runner is unavailable.');
        }

        const fetchAll = request.type === 'loadAll';
        const prefetchRows = request.type === 'prefetch' ? this.service.getConfiguredPrefetchRows() : undefined;
        return this.service.loadMoreSql(connection, request.sessionId, fetchAll, prefetchRows);
    }

    private async receive(message: CommandEntryRequest): Promise<void> {
        switch (message.type) {
            case 'ready':
                const clearInputOnStartup = this.clearInputOnFirstReady;
                const firstReadyHistoryClearEligible = this.clearHistoryOnFirstReady;
                this.lastPostedSqlJobId = this.currentSqlJobId();
                this.post({
                    type: 'initialize',
                    connectionScopeKey: this.buildHistoryConnectionKey(),
                    history: this.history(),
                    running: this.running,
                    sqlJobId: this.lastPostedSqlJobId,
                    dedicatedJobEnabled: this.jobManager.isDedicatedUsable(this.getConnection()),
                    remoteMapepireEnabled: this.jobManager.isRemoteMapepireServerEnabled(this.getConnection()),
                    useSharedSqlJob: this.isUsingSharedSqlJob(),
                    canStartNewJob: this.jobManager.isDedicatedUsable(this.getConnection()),
                    canCancelSqlJob: this.jobManager.isDedicatedUsable(this.getConnection()),
                    messageDetailsMode: this.messageDetailsMode(),
                    logSqlStatementsToCommandLog: this.logSqlStatementsToCommandLogEnabled(),
                    commandTextColor: this.commandEntryCommandTextColor(),
                    sqlStatementColor: this.commandEntrySqlStatementColor(),
                    clearInputOnStartup,
                    clearHistoryOnStartup: false
                });
                this.clearInputOnFirstReady = false;
                this.clearHistoryOnFirstReady = false;

                // Ensure initial panel activation places keyboard focus in the command input.
                this.post({ type: 'focusInput' });
                setTimeout(() => this.post({ type: 'focusInput' }), 75);

                if (this.pendingCommandText !== undefined) {
                    this.post({ type: 'setCommand', command: this.pendingCommandText });
                    this.post({ type: 'focusInput' });
                    this.pendingCommandText = undefined;
                }

                // Auto-initialize only when dedicated mode is actually usable.
                // This keeps single-mode forced-shared while allowing server-mode
                // dedicated sessions to start their own job as soon as Command Entry
                // is live.
                void this.initializeDedicatedJobIfNeeded();

                // Run non-critical startup work after first paint.
                void (async () => {
                    try {
                        await this.context.workspaceState.update('clprompter.commandEntryTouchedThisSession', true);
                        await this.applyDefaultSnippetMergeOnVersionUpdateIfNeeded();

                        const skipStartupClearForVsCodeUpdate = firstReadyHistoryClearEligible && await this.consumeSkipHistoryClearOnNextReady();
                        const clearHistoryOnStartup = firstReadyHistoryClearEligible
                            && this.clearHistoryOnStartupEnabled()
                            && !skipStartupClearForVsCodeUpdate;

                        if (clearHistoryOnStartup) {
                            await this.setHistory([]);
                            this.post({ type: 'clearResults' });
                            this.post({ type: 'historyUpdated', history: [] });
                            return;
                        }

                        this.post({ type: 'historyUpdated', history: this.history() });
                    } catch (error) {
                        this.safeOutputAppendLine(`[Cmd Entry] Deferred startup initialization warning: ${error instanceof Error ? error.message : String(error)}`);
                    }
                })();
                break;
            case 'clear':
                this.post({ type: 'clearResults' });
                break;
            case 'clearHistoryAndMessages':
                await this.clearHistoryAndMessagesWithConfirmation();
                break;
            case 'clearSqlLogMessages':
                await this.clearSqlLogMessagesWithConfirmation();
                break;
            case 'clearSqlHistoryAndMessages':
                await this.clearSqlHistoryAndMessagesWithConfirmation();
                break;
            case 'prompt':
                await this.prompt(message.command);
                break;
            case 'requestHistoryPicker':
                await this.showHistoryPicker();
                break;
            case 'copyCommand':
                await this.copyCommandToClipboard(message.command);
                break;
            case 'copySqlJobId':
                await this.copySqlJobIdToClipboard(message.sqlJobId);
                break;
            case 'requestDisplayJoblog':
                await this.displayJoblogForSqlJob(message.sqlJobId);
                break;
            case 'requestSqlJobId':
                this.refreshSqlJobId();
                break;
            case 'requestCancelSqlJob':
                await this.requestCancelSqlJob();
                break;
            case 'openSqlSnippetsMenu':
            case 'openSnippetsMenu':
                await this.openSnippetsMenu();
                break;
            case 'manageCodeSnippets':
                await vscode.commands.executeCommand('clprompter.manageCodeSnippets');
                break;
            case 'openCmdEntryHelp':
                await this.openCmdEntryHelpPanel();
                break;
            case 'openCmdEntrySettings':
                await this.openCmdEntrySettingsPanel();
                break;
            case 'openClPrompterSettings':
                await vscode.commands.executeCommand('workbench.action.openSettings', 'clPrompter.cmdEntry');
                break;
            case 'menuDebug': {
                let payloadText = '';
                if (message.payload !== undefined) {
                    try {
                        payloadText = ` ${JSON.stringify(message.payload)}`;
                    } catch {
                        payloadText = ' <payload-unserializable>';
                    }
                }
                this.safeOutputAppendLine(`[Cmd Entry][MenuDebug] ${message.phase}${payloadText}`);
                break;
            }
            case 'toggleMessageDetails':
                await this.toggleMessageDetailsPreference();
                break;
            case 'toggleSqlStatementsToCommandLog':
                await this.toggleSqlStatementsToCommandLogPreference();
                break;
            case 'useSharedSqlJob':
                await this.setSharedSqlJobMode(true, 'menu');
                break;
            case 'usePrivateSqlJob':
                await this.setSharedSqlJobMode(false, 'menu');
                break;
            case 'startNewJob':
                await this.startNewJob();
                break;
            case 'run':
                await this.run(message.command, message.mode);
                break;
        }
    }

    private async setSharedSqlJobMode(useSharedJob: boolean, source: 'menu' | 'command'): Promise<void> {
        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'notice', message: vscode.l10n.t('Not connected to IBM i, or the SQL runner is unavailable.') });
            return;
        }

        if (this.running) {
            this.post({ type: 'notice', message: vscode.l10n.t('A command is currently running. Wait for it to finish before switching SQL job mode.') });
            return;
        }

        if (!this.jobManager.isRemoteMapepireServerEnabled(connection)) {
            this.post({ type: 'notice', message: vscode.l10n.t('Shared/Private SQL job switching is available only when Code for IBM i Mapepire Server Mode is enabled.') });
            this.postJobCapabilities();
            return;
        }

        const currentlyShared = !this.jobManager.isDedicatedEnabled(connection);
        if (currentlyShared === useSharedJob) {
            this.post({
                type: 'notice',
                message: useSharedJob
                    ? vscode.l10n.t('Command Entry is already using the shared SQL job.')
                    : vscode.l10n.t('Command Entry is already using a private SQL job.')
            });
            this.postJobCapabilities();
            this.refreshSqlJobId(connection);
            return;
        }

        try {
            await this.service.closeSqlSession();
            await updateConnectionSqlSettings(this.context, connection, { useSharedJob });

            // The job manager resolves the correct display ID for either mode based on the
            // updated connection setting. In shared mode, this intentionally clears the
            // dedicated job and falls back to the connection's shared SQL job; in private
            // mode it creates/restarts the dedicated job and returns that ID.
            const resolvedSqlJobId = await this.jobManager.restartJob(connection);

            console.log('[Cmd Entry][SqlJobModeSwitch] resolved display SQL job ID', {
                useSharedJob,
                resolvedSqlJobId,
                connection: connection.currentConnectionName ?? '<unknown>',
                currentSqlJobId: this.currentSqlJobId(connection) ?? '<none>'
            });

            const displaySqlJobId = resolvedSqlJobId ?? this.currentSqlJobId(connection) ?? '';
            this.safeOutputAppendLine(`[Cmd Entry] SQL job mode switch => useSharedJob=${useSharedJob} resolvedSqlJobId=${displaySqlJobId || '<none>'} currentSqlJobId=${this.currentSqlJobId(connection) || '<none>'}`);
            this.lastPostedSqlJobId = undefined;
            this.post({ type: 'sqlJobId', sqlJobId: displaySqlJobId });
            this.postJobCapabilities();
            this.refreshSqlJobId(connection);
            this.post({
                type: 'notice',
                message: useSharedJob
                    ? vscode.l10n.t(source === 'command' ? 'Switched to shared SQL job mode for this connection.' : 'Switched to shared SQL job mode.')
                    : vscode.l10n.t(source === 'command' ? 'Switched to private SQL job mode for this connection.' : 'Switched to private SQL job mode.')
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.safeOutputAppendLine(`[Cmd Entry] Failed to switch SQL job mode: ${message}`);
            this.post({ type: 'notice', message: vscode.l10n.t('Failed to switch SQL job mode: {message}', { message }) });
            this.postJobCapabilities();
            this.refreshSqlJobId(connection);
        }
    }

    private async applyConnectionSqlJobModeFromSettings(reason: string): Promise<void> {
        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            return;
        }

        if (this.running) {
            this.safeOutputAppendLine(`[Cmd Entry] Deferred SQL job mode apply (${reason}) because a command is still running.`);
            return;
        }

        try {
            await this.service.closeSqlSession();
            await this.jobManager.ensureDedicatedJob(connection);
        } catch (error) {
            this.safeOutputAppendLine(`[Cmd Entry] Failed to apply SQL job mode from connection settings (${reason}): ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.postJobCapabilities();
            this.refreshSqlJobId(connection);
        }
    }

    private async copyCommandToClipboard(command: string): Promise<void> {
        const trimmed = command.trim();
        if (!trimmed) {
            this.post({ type: 'notice', message: vscode.l10n.t('Nothing to copy from this history entry.') });
            return;
        }
        await vscode.env.clipboard.writeText(command);
        this.post({ type: 'notice', message: vscode.l10n.t('Copied command to clipboard.') });
    }

    private async copySqlJobIdToClipboard(sqlJobId: string): Promise<void> {
        const trimmed = sqlJobId.trim();
        if (!trimmed) {
            this.post({ type: 'notice', message: vscode.l10n.t('No SQL job ID is available to copy.') });
            return;
        }
        await vscode.env.clipboard.writeText(trimmed);
        this.post({ type: 'notice', message: vscode.l10n.t('Copied SQL job ID {jobId} to clipboard.', { jobId: trimmed }) });
    }

    private async displayJoblogForSqlJob(sqlJobId: string): Promise<void> {
        // Joblog here means the IBM i job message log for the active SQL job.
        const qualifiedJob = sqlJobId.trim();
        if (!qualifiedJob) {
            this.post({ type: 'notice', message: vscode.l10n.t('No SQL job ID is available.') });
            return;
        }

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'notice', message: vscode.l10n.t('Not connected to IBM i, or the SQL runner is unavailable.') });
            return;
        }

        if (this.running) {
            this.post({ type: 'notice', message: vscode.l10n.t('A command is currently running. Try Display Joblog again in a moment.') });
            return;
        }

        const fullJoblogSnippet = BUILT_IN_SQL_SNIPPETS.find((snippet) => snippet.id === 'builtin.full-joblog');
        if (!fullJoblogSnippet) {
            this.post({ type: 'notice', message: vscode.l10n.t('Built-in full joblog snippet is unavailable.') });
            return;
        }

        const snippetContext: SnippetTemplateContext = {
            ...this.buildSnippetContext(connection),
            sqlJobId: qualifiedJob
        };
        const resolution = this.resolveSqlTemplate(fullJoblogSnippet.stmt, snippetContext);
        if (resolution.missing.length > 0) {
            this.post({
                type: 'notice',
                message: vscode.l10n.t('Unable to resolve full joblog SQL template values: {values}', {
                    values: resolution.missing.map((name) => `\${${name}}`).join(', ')
                })
            });
            return;
        }

        const command = `SQL: ${resolution.resolved}`;
        const execution = await this.service.execute(connection, command, '*RUN', undefined, {
            resultTitle: fullJoblogSnippet.label
        });
        if (execution.failure) {
            this.safeOutputAppendLine(`[Cmd Entry] Display Joblog failed for ${qualifiedJob}: ${execution.failure}`);
            this.post({ type: 'notice', message: vscode.l10n.t('Display Joblog failed: {failure}', { failure: execution.failure }) });
            return;
        }

        if (execution.sqlResult) {
            showSqlResultPanel(execution.sqlResult);
        }
        this.post({ type: 'notice', message: vscode.l10n.t('Displayed joblog for {job}.', { job: qualifiedJob }) });
    }

    private async showHistoryPicker(): Promise<void> {
        // History Log is the command recall list, separate from the IBM i job message log.
        const history = this.history();
        if (history.length === 0) {
            this.post({ type: 'notice', message: vscode.l10n.t('No command history is available yet.') });
            return;
        }

        const items = history.map((entry, index) => ({
            label: entry.command,
            description: entry.mode,
            picked: index === 0,
            entry
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: vscode.l10n.t('Select a CL command from history'),
            matchOnDescription: true,
            ignoreFocusOut: false
        });

        if (!selected) { return; }

        this.post({ type: 'setCommandMode', command: selected.entry.command, mode: selected.entry.mode });
        this.post({ type: 'focusInput' });
    }

    private async clearHistoryAndMessagesWithConfirmation(): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('Clear all CL command history and associated messages?'),
            {
                modal: true,
                detail: vscode.l10n.t('This action cannot be undone.')
            },
            'Yes',
            'No'
        );

        if (choice !== 'Yes') {
            return;
        }

        await this.setHistory([]);
        this.post({ type: 'clearResults' });
        this.post({ type: 'historyUpdated', history: [] });
        this.post({ type: 'notice', message: vscode.l10n.t('CL command history and messages cleared.') });
    }

    private async clearSqlHistoryAndMessagesWithConfirmation(): Promise<void> {
        const history = this.history();
        const sqlHistory = history.filter(entry => isSqlCommandText(entry.command));
        const sqlCount = sqlHistory.length;

        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('Clear SQL history entries and associated SQL messages?'),
            {
                modal: true,
                detail: vscode.l10n.t('Only SQL-tagged entries are removed. CL command history and CL messages remain intact.')
            },
            'Yes',
            'No'
        );

        if (choice !== 'Yes') {
            return;
        }

        await this.service.closeSqlSession();
        notifySqlResultSessionClosed('SQL result session was closed because SQL history was cleared.');

        const keptHistory = history.filter(entry => !isSqlCommandText(entry.command));
        await this.setHistory(keptHistory);
        this.post({ type: 'clearSqlResults' });
        this.post({ type: 'historyUpdated', history: keptHistory });
        this.post({
            type: 'notice',
            message: sqlCount > 0
                ? vscode.l10n.t('Cleared {count} SQL history entries and associated SQL messages.', { count: sqlCount })
                : vscode.l10n.t('No SQL history entries were found. SQL messages were cleared.')
        });
    }

    private async clearSqlLogMessagesWithConfirmation(): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t('Clear SQL log entries from Command Log?'),
            {
                modal: true,
                detail: vscode.l10n.t('Only SQL statements and associated SQL messages are removed from Command Log. History remains unchanged.')
            },
            'Yes',
            'No'
        );

        if (choice !== 'Yes') {
            return;
        }

        this.post({ type: 'clearSqlResults' });
        this.post({ type: 'notice', message: vscode.l10n.t('SQL log entries were cleared from Command Log.') });
    }

    private async prompt(command: string): Promise<void> {
        const labeledCommand = splitUserCommandLabel(command);
        const promptPrefixResolution = resolvePromptPrefixedCommand(command);
        let normalizedCommand = labeledCommand.commandText;

        if (promptPrefixResolution !== undefined) {
            if (promptPrefixResolution.syntaxError) {
                this.post({ type: 'notice', message: vscode.l10n.t(promptPrefixResolution.syntaxError) });
                return;
            }

            normalizedCommand = String(promptPrefixResolution.promptCommand || '');
            const normalizedForDisplay = applyUserCommandLabel(normalizedCommand, labeledCommand.labelPrefix);
            if (normalizedForDisplay !== command) {
                this.post({ type: 'setCommand', command: normalizedForDisplay });
            }
        }

        const commandForPrompter = applyUserCommandLabel(normalizedCommand, labeledCommand.labelPrefix);

        if (!normalizedCommand.trim()) { this.post({ type: 'notice', message: vscode.l10n.t('Enter a CL command to prompt.') }); return; }
        if (isSqlCommandText(normalizedCommand)) {
            this.post({ type: 'notice', message: vscode.l10n.t('Prompt is only available for CL commands. Run SQL statements directly.') });
            return;
        }
        try {
            const result = await CLPrompter(this.context.extensionUri, commandForPrompter);
            const promptedCommand = result && result.trim().length > 0 ? result : commandForPrompter;
            const promptedForDisplay = hasLeadingLabelOrPrefix(promptedCommand)
                ? String(promptedCommand).trimStart()
                : applyUserCommandLabel(promptedCommand, labeledCommand.labelPrefix);
            if (promptedForDisplay !== command) {
                this.post({ type: 'setCommand', command: promptedForDisplay });
            }
        } catch (error) {
            this.safeOutputAppendLine(`[Cmd Entry] Prompt failed: ${String(error)}`);
            this.post({ type: 'notice', message: vscode.l10n.t('Unable to open the CL prompter. See CLPROMPTER Output for details.') });
        } finally {
            this.post({ type: 'focusInput' });
            // Webview focus can race panel disposal, so retry once.
            setTimeout(() => this.post({ type: 'focusInput' }), 50);
        }
    }

    private async run(
        command: string,
        mode: CommandExecutionMode,
        options: {
            sourceType?: 'user' | 'snippet';
            logToHistory?: boolean;
            logToCommandEntryLog?: boolean;
            resultTitle?: string;
        } = {}
    ): Promise<void> {
        const promptPrefixResolution = resolvePromptPrefixedCommand(command);
        if (promptPrefixResolution !== undefined) {
            if (promptPrefixResolution.syntaxError) {
                this.post({ type: 'notice', message: vscode.l10n.t(promptPrefixResolution.syntaxError) });
                return;
            }

            const promptPrefixedCommand = String(promptPrefixResolution.promptCommand || '');
            if (!promptPrefixedCommand.trim()) {
                this.post({ type: 'notice', message: vscode.l10n.t('Enter a CL command to prompt.') });
                return;
            }
            if (isSqlCommandText(promptPrefixedCommand)) {
                this.post({ type: 'notice', message: vscode.l10n.t('Prompt is only available for CL commands. Run SQL statements directly.') });
                return;
            }

            // Mirror 5250/F4 behavior: treat leading ? as a prompt request, not execution.
            await this.prompt(command);
            return;
        }

        if (this.running) { return; }
        if (!command.trim()) { this.post({ type: 'notice', message: vscode.l10n.t('Enter a CL command to run.') }); return; }

        const sourceType = options.sourceType ?? 'user';
        const isSql = isSqlCommandText(command);
        const snippetsLogFailuresOnly = sourceType === 'snippet';
        const shouldAddToHistory = options.logToHistory ?? this.shouldAddToHistory(sourceType, isSql);
        const shouldAddToCommandEntryLog = options.logToCommandEntryLog ?? this.shouldAddToCommandEntryLog(sourceType, isSql);
        const shouldLogExecutionToCommandEntry = (execution: { outcome?: string; failure?: string }): boolean => {
            const executionFailed = Boolean(execution.failure) || execution.outcome === 'error';
            if (snippetsLogFailuresOnly) {
                return executionFailed;
            }
            if (isSql) {
                // Keep SQL noise low while still surfacing failures when SQL log preference is disabled.
                return shouldAddToCommandEntryLog || executionFailed;
            }
            return shouldAddToCommandEntryLog;
        };
        const commandForRecall = ensureSqlPrefixForRecall(command, isSql);

        await this.service.closeSqlSession();
        if (!isSql) {
            notifySqlResultSessionClosed('SQL result session is no longer available. Run the SQL statement again.');
        }

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            const failedExecution = this.failed(command, mode, 'Not connected to IBM i, or the Code for IBM i SQL runner is unavailable.');
            this.post({
                type: 'execution',
                execution: failedExecution,
                addToHistory: shouldAddToHistory,
                addToCommandEntryLog: shouldLogExecutionToCommandEntry(failedExecution)
            });
            return;
        }

        const goCommandName = extractGoCommandName(command);
        const selectSource = goCommandName !== undefined
            ? `${goCommandName}*`
            : command;
        const selectCommand = /^([^\s]*)\*/.exec(selectSource);
        if (selectCommand !== null) {
            this.post({ type: 'notice', message: vscode.l10n.t("Selecting command...") });
            const rawSelectName = String(selectCommand[1] || '').trim();
            const normalizedSelectName = rawSelectName.includes('/')
                ? connection.upperCaseName(rawSelectName)
                : rawSelectName.toUpperCase();
            const [name, library] = normalizedSelectName.split('/').reverse();

            if (name.length > 10) {
                this.post({ type: 'notice', message: vscode.l10n.t("{0} is not a valid command name", name) });
            }

            const lookupLibrary = library || '*LIBL';
            const baseQuery = goCommandName !== undefined
                ? `select OBJLIB, OBJNAME, OBJTEXT, COALESCE(NULLIF(TRIM(OBJTEXT), ''), OBJNAME) as SORTTEXT from table(QSYS2.OBJECT_STATISTICS('${lookupLibrary}', 'CMD', '${name}*')) order by SORTTEXT, OBJLIB, OBJNAME`
                : `select OBJLIB, OBJNAME, OBJTEXT from table(QSYS2.OBJECT_STATISTICS('${lookupLibrary}', 'CMD', '${name}*'))`;
            const wildcardRowLimit = this.resolveWildcardLookupRowLimit(connection);
            const fetchRows = this.resolveWildcardLookupFetchRows(wildcardRowLimit);
            this.safeOutputAppendLine(`[Cmd Entry][WildcardLookup] mode=${goCommandName !== undefined ? 'GO_CMD' : 'GENERIC'} lookupLibrary=${lookupLibrary} pattern=${name}* rowLimit=${wildcardRowLimit} fetchRows=${fetchRows}`);

            const seen = new Set<string>();
            const collected: Array<{ library: string; name: string; text: string | undefined }> = [];
            const toCommandRows = (rows: Record<string, unknown>[]) => rows
                .map(row => ({ library: String(row.OBJLIB), name: String(row.OBJNAME), text: row.OBJTEXT !== null ? String(row.OBJTEXT) : undefined }));
            const appendUniqueRows = (rows: Array<{ library: string; name: string; text: string | undefined }>): number => {
                let added = 0;
                for (const row of rows) {
                    if (collected.length >= wildcardRowLimit) {
                        break;
                    }
                    const key = `${row.library}/${row.name}`;
                    if (seen.has(key)) {
                        continue;
                    }
                    seen.add(key);
                    collected.push(row);
                    added += 1;
                }
                return added;
            };

            let stagnantIterations = 0;
            let pageResult = await this.jobManager.runSQLWithDetails(connection, baseQuery, { rows: fetchRows });
            let continuation = pageResult.continuation;
            let pageRows = toCommandRows(pageResult.rows);

            this.safeOutputAppendLine(`[Cmd Entry][WildcardLookupTuple] initialTuple=${continuation ? `type=${continuation.type ?? '<none>'} id=${continuation.id ?? '<none>'} cont_id=${continuation.contId ?? '<none>'} is_done=${continuation.isDone ?? '<unknown>'} fetchMore=${continuation.hasFetchMore} source=${continuation.source}` : 'not_present'}`);

            while (pageRows.length > 0 && collected.length < wildcardRowLimit) {
                const uniqueAdded = appendUniqueRows(pageRows);
                if (uniqueAdded === 0) {
                    stagnantIterations += 1;
                    if (stagnantIterations >= 2) {
                        this.safeOutputAppendLine('[Cmd Entry][WildcardLookup] stopping pagination after repeated duplicate-only pages.');
                        break;
                    }
                } else {
                    stagnantIterations = 0;
                }

                if (collected.length >= wildcardRowLimit) {
                    break;
                }

                if (this.jobManager.isContinuationUsable(continuation)) {
                    const more = await this.jobManager.continueSQLFromResult(pageResult.rawResult ?? pageResult, { targetRows: wildcardRowLimit - collected.length, statement: baseQuery });
                    const moreRows = toCommandRows(more.rows);
                    if (moreRows.length === 0) {
                        break;
                    }
                    pageResult = {
                        rows: more.rows,
                        rawResult: more.rawResult ?? pageResult.rawResult,
                        continuation: more.continuation ?? pageResult.continuation
                    };
                    continuation = more.continuation;
                    pageRows = moreRows;
                    continue;
                }

                break;
            }

            const suggestions = collected;
            const distinctLibraries = [...new Set(suggestions.map((entry) => entry.library))];

            const librarySample = distinctLibraries.slice(0, 20).join(', ');
            const firstSuggestionSample = suggestions.slice(0, 10).map((entry) => `${entry.library}/${entry.name}`).join(', ');
            this.safeOutputAppendLine(`[Cmd Entry][WildcardLookupResult] mode=${goCommandName !== undefined ? 'GO_CMD' : 'GENERIC'} rows=${suggestions.length} distinctLibs=${distinctLibraries.length} libsSample=${librarySample || '<none>'}`);
            this.safeOutputAppendLine(`[Cmd Entry][WildcardLookupResult] firstRows=${firstSuggestionSample || '<none>'}`);

            try {
                if (suggestions.length > 0) {
                    const selection = (await vscode.window.showQuickPick(suggestions.map(s => ({ label: `${s.library}/${s.name}`, description: s.text })), { title: vscode.l10n.t("Select command") }))?.label;
                    if (selection !== undefined) {
                        this.post({ type: 'setCommand', command: selection });
                        this.post({ type: 'focusInput' });
                    }
                    this.post({ type: 'notice', message: undefined });
                }
                else {
                    this.post({ type: 'notice', message: vscode.l10n.t("No selection match for {0} in {1}", name, library ? library : vscode.l10n.t("the library list")) });
                }
            } finally {
                this.post({ type: 'focusInput' });
                setTimeout(() => this.post({ type: 'focusInput' }), 50);
            }

            return;
        }

        this.running = true;
        this.activeExecutionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sqlJobId = this.currentSqlJobId(connection);
        const dedicatedState = this.jobManager.getState(connection);
        const showDedicatedStartupMessage = this.jobManager.isDedicatedUsable(connection)
            && dedicatedState.status === 'ended';
        const statusMessage = showDedicatedStartupMessage
            ? 'Starting new mapepire job...'
            : undefined;
        this.lastPostedSqlJobId = sqlJobId;
        this.post({
            type: 'running',
            running: true,
            executionId: this.activeExecutionId,
            startedAt: Date.now(),
            sqlJobId,
            statusMessage
        });

        let completionNotice: string | undefined;

        try {
            const execution = await this.service.execute(connection, command, mode, this.activeExecutionId, {
                resultTitle: options.resultTitle
            });
            let executionForPost = isSql
                ? { ...execution, command: ensureSqlPrefixForRecall(execution.command, true) }
                : execution;
            if (shouldAddToHistory) {
                this.remember({ command: commandForRecall, mode, isSql });
            }
            if (execution.failure) { this.safeOutputAppendLine(`[Cmd Entry] CMD_RUN failed: ${execution.failure}`); }
            if (executionForPost.sqlResult) {
                showSqlResultPanel(executionForPost.sqlResult);
            }
            const addToCommandEntryLog = shouldLogExecutionToCommandEntry(execution);

            const sqlNotLoggedMessage = vscode.l10n.t('SQL completed. Not logged due to settings.');
            const sqlSucceededWithoutLogging = isSql
                && execution.outcome === 'success'
                && !execution.failure
                && !addToCommandEntryLog;
            const shouldShowSqlNotLoggedFeedback = sqlSucceededWithoutLogging
                && !snippetsLogFailuresOnly
                && this.consumeSqlNotLoggedFeedbackAllowance();

            if (shouldShowSqlNotLoggedFeedback) {
                const nextOrdinal = executionForPost.messages.reduce((max, message) => Math.max(max, Number(message.ordinalPosition) || 0), 0) + 1;
                executionForPost = {
                    ...executionForPost,
                    messages: [
                        ...executionForPost.messages,
                        {
                            ordinalPosition: nextOrdinal,
                            messageId: 'SQLLOG0',
                            severity: 0,
                            type: 'INFO',
                            text: sqlNotLoggedMessage,
                            sentTimestamp: executionForPost.startedAt.replace('T', ' ').replace('Z', ''),
                            sentFromProgram: '',
                            sentFromStmt: '',
                            sentFromModule: '',
                            sentFromProcedure: '',
                            sentToProgram: '',
                            sentToStmt: '',
                            sentToModule: '',
                            sentToProcedure: '',
                            secondLevelText: '',
                            kind: 'info' as const
                        }
                    ]
                };
            }

            this.post({
                type: 'execution',
                execution: executionForPost,
                addToHistory: shouldAddToHistory,
                addToCommandEntryLog
            });
            if (isSql) {
                this.post({ type: 'focusInput' });
                setTimeout(() => this.post({ type: 'focusInput' }), 75);
            }
            if (shouldShowSqlNotLoggedFeedback) {
                completionNotice = sqlNotLoggedMessage;
            }
        } finally {
            this.running = false;
            this.activeExecutionId = undefined;
            const latestSqlJobId = this.currentSqlJobId(connection);
            this.lastPostedSqlJobId = latestSqlJobId;
            this.post({ type: 'running', running: false, sqlJobId: latestSqlJobId });
            if (completionNotice) {
                this.post({ type: 'notice', message: completionNotice });
            }
            this.refreshSqlJobId(connection);
        }
    }

    private async startNewJob(): Promise<void> {
        await this.service.closeSqlSession();

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'notice', message: vscode.l10n.t('Not connected to IBM i, or the SQL runner is unavailable.') });
            return;
        }

        if (!this.jobManager.isDedicatedUsable(connection)) {
            this.post({ type: 'notice', message: vscode.l10n.t('Reconnect Server Job is only available when using Mapepire server mode and private SQL job mode.') });
            return;
        }

        try {
            const sqlJobId = await this.jobManager.restartJob(connection);
            this.refreshSqlJobId(connection);
            this.postJobCapabilities();
            this.post({
                type: 'notice',
                message: sqlJobId
                    ? vscode.l10n.t('SQL job connected: {jobId}.', { jobId: sqlJobId })
                    : vscode.l10n.t('SQL job connected.')
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.safeOutputAppendLine(`[Cmd Entry] Reconnect Server Job failed: ${message}`);
            this.post({ type: 'notice', message: vscode.l10n.t('Reconnect Server Job failed: {message}', { message }) });
        }
    }

    private async requestCancelSqlJob(): Promise<void> {
        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'notice', message: vscode.l10n.t('Not connected to IBM i, or the SQL runner is unavailable.') });
            return;
        }

        if (!this.jobManager.isDedicatedUsable(connection)) {
            this.post({ type: 'notice', message: vscode.l10n.t('Cancel SQL Job is only available in private SQL job mode.') });
            this.postJobCapabilities();
            return;
        }

        const sqlJobId = this.currentSqlJobId(connection);
        if (!sqlJobId) {
            this.post({ type: 'notice', message: vscode.l10n.t('No private SQL job ID is available to cancel.') });
            this.postJobCapabilities();
            return;
        }

        try {
            await this.jobManager.cancelActive(connection);
            this.safeOutputAppendLine(`[Cmd Entry] Manual cancel requested for private SQL job ${sqlJobId}.`);
            this.post({ type: 'notice', message: vscode.l10n.t('Cancel SQL requested for job {jobId}. IBM i may ignore this when no interruptible SQL is active.', { jobId: sqlJobId }) });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.safeOutputAppendLine(`[Cmd Entry] Manual cancel request failed: ${message}`);
            this.post({ type: 'notice', message: vscode.l10n.t('Cancel SQL request failed: {message}', { message }) });
        } finally {
            this.postJobCapabilities();
        }
    }

    private async openSnippetsMenu(): Promise<void> {
        await this.applyDefaultSnippetMergeOnVersionUpdateIfNeeded();
        const snippets = this.getMergedSqlSnippets();

        const pickerItems: Array<vscode.QuickPickItem & { snippetId?: string; action?: 'add' | 'toggleTreeView' | 'import' | 'export' | 'refreshDefaults' }> = [
            ...snippets.map((snippet) => ({
                label: snippet.label,
                description: snippet.source === 'user' ? vscode.l10n.t('User') : undefined,
                detail: `${snippet.group}${snippet.source === 'user' ? ` · ${vscode.l10n.t('User')}` : ''}`,
                snippetId: snippet.id
            })),
            { label: '$(add) ' + vscode.l10n.t('Add more...'), action: 'add', description: vscode.l10n.t('Create a new Code Snippet') },
            { label: '$(list-tree) ' + vscode.l10n.t('Toggle Code Snippets in Tree View'), action: 'toggleTreeView', description: vscode.l10n.t('Show or hide the Code Snippets tree view') },
            { label: '$(arrow-down) ' + vscode.l10n.t('Import Code Snippets...'), action: 'import', description: vscode.l10n.t('Load Code Snippets from a JSON file') },
            { label: '$(arrow-up) ' + vscode.l10n.t('Export Code Snippets...'), action: 'export', description: vscode.l10n.t('Save user Code Snippets to a JSON file') },
            { label: '$(refresh) ' + vscode.l10n.t('Refresh default snippets'), action: 'refreshDefaults', description: vscode.l10n.t('Restore shipped defaults and pick up latest built-in snippets') }
        ];

        const selected = await vscode.window.showQuickPick(pickerItems, {
            placeHolder: vscode.l10n.t('Select a Code Snippet to run'),
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: false
        });
        if (!selected) {
            return;
        }

        if (selected.action === 'add') {
            await vscode.commands.executeCommand('clprompter.manageCodeSnippets');
            await vscode.commands.executeCommand('clprompter.codeSnippet.add');
            return;
        }
        if (selected.action === 'toggleTreeView') {
            await vscode.commands.executeCommand('clprompter.toggleCodeSnippetsTreeView');
            return;
        }
        if (selected.action === 'import') {
            await this.importCodeSnippetsFromJson();
            return;
        }
        if (selected.action === 'export') {
            await this.exportCodeSnippetsToJson();
            return;
        }
        if (selected.action === 'refreshDefaults') {
            await this.refreshDefaultSnippets();
            return;
        }

        if (!selected.snippetId) {
            return;
        }

        await this.executeSnippet(selected.snippetId);
    }

    private getUserSqlSnippets(): CommandEntrySqlSnippetUser[] {
        const raw = this.context.globalState.get<unknown>(SQL_SNIPPETS_USER_KEY, []);
        if (!Array.isArray(raw)) {
            return [];
        }

        const snippets: CommandEntrySqlSnippetUser[] = [];
        for (const item of raw) {
            if (!item || typeof item !== 'object') {
                continue;
            }
            const record = item as Partial<CommandEntrySqlSnippetUser> & { sqlTemplate?: string };
            const id = String(record.id || '').trim();
            const label = String(record.label || '').trim();
            const stmt = String(record.stmt ?? record.sqlTemplate ?? '').trim();
            const group = String(record.group || 'Admin').trim();
            const order = normalizeSnippetOrder((record as { order?: unknown; sequence?: unknown }).order ?? (record as { sequence?: unknown }).sequence);
            if (!id || !label || !stmt) {
                continue;
            }
            snippets.push({
                id,
                label,
                stmt,
                group,
                order,
                createdAt: String(record.createdAt || new Date().toISOString()),
                updatedAt: String(record.updatedAt || new Date().toISOString())
            });
        }
        return snippets.slice(0, SQL_SNIPPETS_MAX);
    }

    private async setUserSqlSnippets(snippets: CommandEntrySqlSnippetUser[]): Promise<void> {
        await this.context.globalState.update(SQL_SNIPPETS_USER_KEY, snippets.slice(0, SQL_SNIPPETS_MAX));
    }

    private getSqlSnippetOrder(): string[] {
        const raw = this.context.globalState.get<unknown>(SQL_SNIPPETS_ORDER_KEY, []);
        if (!Array.isArray(raw)) {
            return [];
        }
        return raw.map((value) => String(value || '').trim()).filter(Boolean);
    }

    private async setSqlSnippetOrder(order: string[]): Promise<void> {
        await this.context.globalState.update(SQL_SNIPPETS_ORDER_KEY, order.map((id) => id.trim()).filter(Boolean));
    }

    private getHiddenBuiltInSnippetIds(): Set<string> {
        const raw = this.context.globalState.get<unknown>(SQL_SNIPPETS_HIDDEN_BUILTINS_KEY, []);
        if (!Array.isArray(raw)) {
            return new Set<string>();
        }
        return new Set(raw.map((value) => String(value || '').trim()).filter(Boolean));
    }

    private async setHiddenBuiltInSnippetIds(ids: Set<string>): Promise<void> {
        await this.context.globalState.update(SQL_SNIPPETS_HIDDEN_BUILTINS_KEY, [...ids]);
    }

    private currentExtensionVersion(): string | undefined {
        const byId = vscode.extensions.getExtension('CozziResearch.clprompter')
            ?? vscode.extensions.getExtension('cozziresearch.clprompter');
        const version = byId?.packageJSON?.version;
        if (typeof version === 'string' && version.trim().length > 0) {
            return version.trim();
        }

        for (const ext of vscode.extensions.all) {
            const name = String(ext.packageJSON?.name || '').toLowerCase();
            if (name === 'clprompter') {
                const candidate = ext.packageJSON?.version;
                if (typeof candidate === 'string' && candidate.trim().length > 0) {
                    return candidate.trim();
                }
            }
        }

        return undefined;
    }

    private async applyDefaultSnippetMergeOnVersionUpdateIfNeeded(): Promise<void> {
        const currentVersion = this.currentExtensionVersion();
        if (!currentVersion) {
            return;
        }

        const mergedVersion = this.context.globalState.get<string>(SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY, '');
        if (mergedVersion === currentVersion) {
            return;
        }

        const builtInIds = new Set(BUILT_IN_SQL_SNIPPETS.map((snippet) => snippet.id));
        const hidden = this.getHiddenBuiltInSnippetIds();
        const prunedHidden = new Set([...hidden].filter((id) => builtInIds.has(id)));
        if (prunedHidden.size !== hidden.size) {
            await this.setHiddenBuiltInSnippetIds(prunedHidden);
        }

        await this.persistMergedSnippetOrder(this.getMergedSqlSnippets().map((snippet) => snippet.id));
        await this.context.globalState.update(SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY, currentVersion);
        this.notifyCodeSnippetsChanged();

        this.post({ type: 'notice', message: vscode.l10n.t('Code Snippet defaults merged for CLPROMPTER {version}.', { version: currentVersion }) });
    }

    private async refreshDefaultSnippets(): Promise<void> {
        const builtInIds = new Set(BUILT_IN_SQL_SNIPPETS.map((snippet) => snippet.id));
        const hidden = this.getHiddenBuiltInSnippetIds();
        const hiddenCount = hidden.size;

        if (hiddenCount > 0) {
            await this.setHiddenBuiltInSnippetIds(new Set<string>());
        }

        const existingOrder = this.getSqlSnippetOrder().filter((id) => !builtInIds.has(id));
        const refreshedOrder = [
            ...this.sortSnippetsForDefaultOrder(BUILT_IN_SQL_SNIPPETS).map((snippet) => snippet.id),
            ...existingOrder
        ];
        await this.setSqlSnippetOrder(refreshedOrder);

        const currentVersion = this.currentExtensionVersion();
        if (currentVersion) {
            await this.context.globalState.update(SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY, currentVersion);
        }

        this.notifyCodeSnippetsChanged();
        this.post({
            type: 'notice',
            message: vscode.l10n.t('Shipped Code Snippets refreshed. Restored: {restored}.', {
                restored: hiddenCount
            })
        });
    }

    private getMergedSqlSnippets(): CommandEntrySqlSnippet[] {
        const hiddenBuiltIns = this.getHiddenBuiltInSnippetIds();
        const builtInSnippets = BUILT_IN_SQL_SNIPPETS.filter((snippet) => !hiddenBuiltIns.has(snippet.id));
        const userSnippets = this.getUserSqlSnippets().map<CommandEntrySqlSnippet>((snippet) => ({
            id: snippet.id,
            label: snippet.label,
            stmt: snippet.stmt,
            group: snippet.group,
            order: snippet.order,
            source: 'user',
            createdAt: snippet.createdAt,
            updatedAt: snippet.updatedAt
        }));

        const all = this.sortSnippetsForDefaultOrder([...builtInSnippets, ...userSnippets]);
        const byId = new Map(all.map((item) => [item.id, item]));
        const ordered: CommandEntrySqlSnippet[] = [];
        const order = this.getSqlSnippetOrder();
        for (const id of order) {
            const snippet = byId.get(id);
            if (snippet) {
                ordered.push(snippet);
                byId.delete(id);
            }
        }
        for (const snippet of all) {
            if (byId.has(snippet.id)) {
                ordered.push(snippet);
                byId.delete(snippet.id);
            }
        }
        return ordered;
    }

    private sortSnippetsForDefaultOrder(snippets: ReadonlyArray<CommandEntrySqlSnippet>): CommandEntrySqlSnippet[] {
        const groupOrder = new Map<string, number>();
        DEFAULT_CODE_SNIPPET_GROUPS.forEach((groupName, index) => {
            groupOrder.set(groupName, index);
        });

        const withIndex = snippets.map((snippet, index) => ({ snippet, index }));
        withIndex.sort((left, right) => {
            const leftGroupRank = groupOrder.get(left.snippet.group) ?? Number.MAX_SAFE_INTEGER;
            const rightGroupRank = groupOrder.get(right.snippet.group) ?? Number.MAX_SAFE_INTEGER;
            if (leftGroupRank !== rightGroupRank) {
                return leftGroupRank - rightGroupRank;
            }

            if (left.snippet.group !== right.snippet.group) {
                return left.snippet.group.localeCompare(right.snippet.group, undefined, { sensitivity: 'base' });
            }

            const leftOrder = normalizeSnippetOrder(left.snippet.order);
            const rightOrder = normalizeSnippetOrder(right.snippet.order);
            if (leftOrder !== undefined || rightOrder !== undefined) {
                const leftValue = leftOrder ?? Number.MAX_SAFE_INTEGER;
                const rightValue = rightOrder ?? Number.MAX_SAFE_INTEGER;
                if (leftValue !== rightValue) {
                    return leftValue - rightValue;
                }
            }

            const labelCompare = left.snippet.label.localeCompare(right.snippet.label, undefined, { sensitivity: 'base' });
            if (labelCompare !== 0) {
                return labelCompare;
            }

            return left.index - right.index;
        });

        return withIndex.map((entry) => entry.snippet);
    }

    private async persistMergedSnippetOrder(orderedSnippetIds: string[]): Promise<void> {
        const allIds = new Set(this.getMergedSqlSnippets().map((snippet) => snippet.id));
        const normalized = orderedSnippetIds.filter((id) => allIds.has(id));
        const missing = [...allIds].filter((id) => !normalized.includes(id));
        await this.setSqlSnippetOrder([...normalized, ...missing]);
    }

    private createUserSnippetId(): string {
        return `user.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    }

    private isValidSnippetLabel(label: string): boolean {
        return label.trim().length > 0;
    }

    private normalizeImportedSnippets(raw: unknown): Array<{ label: string; stmt: string; group: string; order?: number }> {
        const sourceArray = Array.isArray(raw)
            ? raw
            : (raw && typeof raw === 'object' && Array.isArray((raw as any).snippets) ? (raw as any).snippets : []);

        const normalized: Array<{ label: string; stmt: string; group: string; order?: number }> = [];
        const seenLabels = new Set<string>();
        for (const item of sourceArray) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            const record = item as Record<string, unknown> & { sqlTemplate?: string; stmt?: string };
            const label = String(record.label ?? record.name ?? '').trim();
            const stmt = String(record.stmt ?? record.sqlTemplate ?? record.codeTemplate ?? record.snippetText ?? record.text ?? record.command ?? '').trim();
            const group = String(record.group ?? record.category ?? 'Admin').trim() || 'Admin';
            const order = normalizeSnippetOrder((record as { order?: unknown; sequence?: unknown }).order ?? (record as { sequence?: unknown }).sequence);
            if (!this.isValidSnippetLabel(label) || !stmt) {
                continue;
            }

            const key = label.toUpperCase();
            if (seenLabels.has(key)) {
                continue;
            }
            seenLabels.add(key);
            normalized.push({ label, stmt, group, order });
        }

        return normalized.slice(0, SQL_SNIPPETS_MAX);
    }

    private postCodeSnippetsUpdated(selectedId?: string): void {
        void selectedId;
        this.notifyCodeSnippetsChanged();
    }

    private async exportCodeSnippetsToJson(): Promise<void> {
        try {
            const userSnippets = this.getUserSqlSnippets();
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
            const saveUri = await vscode.window.showSaveDialog({
                title: vscode.l10n.t('Export Code Snippets'),
                saveLabel: vscode.l10n.t('Export Code Snippets'),
                defaultUri: workspaceUri ? vscode.Uri.joinPath(workspaceUri, 'clprompter-code-snippets.json') : undefined,
                filters: { 'JSON Files': ['json'] }
            });
            if (!saveUri) {
                return;
            }

            const payload = {
                format: 'clprompter-code-snippets',
                version: 1,
                exportedAt: new Date().toISOString(),
                snippets: userSnippets.map((snippet) => ({
                    label: snippet.label,
                    codeTemplate: snippet.stmt,
                    group: snippet.group,
                    order: snippet.order,
                    createdAt: snippet.createdAt,
                    updatedAt: snippet.updatedAt
                }))
            };

            const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
            await vscode.workspace.fs.writeFile(saveUri, bytes);
            this.post({ type: 'notice', message: vscode.l10n.t('Exported {count} Code Snippet(s) to {path}.', { count: userSnippets.length, path: saveUri.fsPath }) });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: vscode.l10n.t('Export Code Snippets failed: {message}', { message }) });
        }
    }

    private async promptCodeSnippetImportMode(): Promise<CodeSnippetImportMode | undefined> {
        const choice = await vscode.window.showQuickPick([
            { label: vscode.l10n.t('Merge'), mode: 'merge' as const, description: vscode.l10n.t('Add new and update existing Code Snippets by name') },
            { label: vscode.l10n.t('Replace All'), mode: 'replace-all' as const, description: vscode.l10n.t('Replace all user Code Snippets with imported Code Snippets') },
            { label: vscode.l10n.t('Add New Only'), mode: 'add-new-only' as const, description: vscode.l10n.t('Import only Code Snippets that do not already exist by name') }
        ], {
            title: vscode.l10n.t('Import Code Snippets'),
            placeHolder: vscode.l10n.t('Choose how to apply imported Code Snippets'),
            ignoreFocusOut: true
        });
        return choice?.mode;
    }

    private async importCodeSnippetsFromJson(): Promise<void> {
        try {
            const openUris = await vscode.window.showOpenDialog({
                title: vscode.l10n.t('Import Code Snippets'),
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: vscode.l10n.t('Import Code Snippets'),
                filters: { 'JSON Files': ['json'] }
            });
            const sourceUri = openUris?.[0];
            if (!sourceUri) {
                return;
            }

            const mode = await this.promptCodeSnippetImportMode();
            if (!mode) {
                return;
            }

            const bytes = await vscode.workspace.fs.readFile(sourceUri);
            let parsed: unknown;
            try {
                parsed = JSON.parse(Buffer.from(bytes).toString('utf8'));
            } catch {
                this.post({ type: 'notice', message: vscode.l10n.t('Import failed: selected file is not valid JSON.') });
                return;
            }

            const imported = this.normalizeImportedSnippets(parsed);
            if (imported.length === 0) {
                this.post({ type: 'notice', message: vscode.l10n.t('Import failed: no valid Code Snippets were found in the JSON file.') });
                return;
            }

            const existing = this.getUserSqlSnippets();
            const byLabel = new Map(existing.map((snippet) => [snippet.label.trim().toUpperCase(), snippet]));
            const now = new Date().toISOString();

            let created = 0;
            let updated = 0;
            let skipped = 0;

            if (mode === 'replace-all') {
                const replaced: CommandEntrySqlSnippetUser[] = imported.map((item) => ({
                    id: this.createUserSnippetId(),
                    label: item.label,
                    stmt: item.stmt,
                    group: item.group,
                    order: item.order,
                    createdAt: now,
                    updatedAt: now
                }));
                await this.setUserSqlSnippets(replaced);
                await this.persistMergedSnippetOrder([
                    ...this.getMergedSqlSnippets().map((snippet) => snippet.id),
                    ...replaced.map((snippet) => snippet.id)
                ]);
                created = replaced.length;
            } else {
                const next = [...existing];
                for (const item of imported) {
                    const key = item.label.trim().toUpperCase();
                    const existingMatch = byLabel.get(key);
                    if (!existingMatch) {
                        const createdSnippet: CommandEntrySqlSnippetUser = {
                            id: this.createUserSnippetId(),
                            label: item.label,
                            stmt: item.stmt,
                            group: item.group,
                            order: item.order,
                            createdAt: now,
                            updatedAt: now
                        };
                        next.push(createdSnippet);
                        byLabel.set(key, createdSnippet);
                        created += 1;
                        continue;
                    }

                    if (mode === 'merge') {
                        existingMatch.label = item.label;
                        existingMatch.stmt = item.stmt;
                        existingMatch.group = item.group;
                        existingMatch.order = item.order;
                        existingMatch.updatedAt = now;
                        updated += 1;
                    } else {
                        skipped += 1;
                    }
                }

                await this.setUserSqlSnippets(next);
                await this.persistMergedSnippetOrder(this.getMergedSqlSnippets().map((snippet) => snippet.id));
            }

            this.postCodeSnippetsUpdated();
            this.post({
                type: 'notice',
                message: vscode.l10n.t('Imported Code Snippets from {path}. Added: {added}, Updated: {updated}, Skipped: {skipped}.', {
                    path: sourceUri.fsPath,
                    added: created,
                    updated,
                    skipped
                })
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: vscode.l10n.t('Import Code Snippets failed: {message}', { message }) });
        }
    }

    private parseSqlJobParts(sqlJobId: string | undefined): { sqlJobId?: string; sqlJobNumber?: string; sqlJobName?: string } {
        if (!sqlJobId) {
            return {};
        }
        const normalized = sqlJobId.trim();
        const match = normalized.match(/^(\d{6})\/([^\/]+)\/([^\/]+)$/);
        if (!match) {
            return { sqlJobId: normalized };
        }
        return {
            sqlJobId: normalized,
            sqlJobNumber: match[1],
            sqlJobName: match[3]
        };
    }

    private buildSnippetContext(connection: IBMi | undefined): SnippetTemplateContext {
        const sqlJobId = this.currentSqlJobId(connection) || connection?.getSqlJobId?.();
        const parts = this.parseSqlJobParts(sqlJobId);
        const config = connection?.getConfig?.();
        const extensionConfig = vscode.workspace.getConfiguration('clPrompter');
        const userSBSList = normalizeSnippetSubsystemList(extensionConfig.get<string>('cmdEntrySnippetsACTSBS', ''));
        return {
            sqlJobId: parts.sqlJobId,
            sqlJobName: parts.sqlJobName,
            sqlJobNumber: parts.sqlJobNumber,
            currentUser: connection?.currentUser,
            currentLibrary: typeof config?.currentLibrary === 'string' ? config.currentLibrary : undefined,
            userSBSList
        };
    }

    private resolveSqlTemplate(template: string, context: SnippetTemplateContext): { resolved: string; missing: string[] } {
        const tokenValues: Record<string, string | undefined> = {
            sqlJobId: context.sqlJobId,
            sqlJobName: context.sqlJobName,
            sqlJobNumber: context.sqlJobNumber,
            currentUser: context.currentUser,
            currentLibrary: context.currentLibrary,
            userSBSList: context.userSBSList
        };

        const missing = new Set<string>();
        const resolved = template.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_all, tokenName: string) => {
            const key = String(tokenName || '').trim();
            if (!(key in tokenValues)) {
                return `\${${key}}`;
            }
            const value = tokenValues[key];
            if (key === 'userSBSList') {
                return String(value ?? '').replace(/'/g, "''");
            }
            if (!value || !String(value).trim()) {
                missing.add(key);
                return `\${${key}}`;
            }
            return String(value).replace(/'/g, "''");
        });

        return { resolved, missing: [...missing] };
    }

    private async executeSnippet(snippetId: string): Promise<void> {
        try {
            const snippet = this.getMergedSqlSnippets().find((item) => item.id === snippetId);
            if (!snippet) {
                this.post({ type: 'notice', message: vscode.l10n.t('The selected snippet is no longer available.') });
                return;
            }

            const connection = this.getConnection();
            if (!connection) {
                this.post({ type: 'notice', message: vscode.l10n.t('Not connected to IBM i.') });
                return;
            }

            const resolution = this.resolveSnippetTemplateText(snippet.stmt);
            if (resolution.missing.length > 0) {
                this.post({
                    type: 'notice',
                    message: vscode.l10n.t("Snippet '{label}' requires unavailable value(s): {missing}", {
                        label: snippet.label,
                        missing: resolution.missing.map((name) => `\${${name}}`).join(', ')
                    })
                });
                return;
            }

            const sqlLike = isSqlCommandText(resolution.resolved);

            await this.run(resolution.resolved, '*RUN', {
                sourceType: 'snippet',
                logToHistory: this.shouldAddToHistory('snippet', sqlLike),
                logToCommandEntryLog: this.shouldAddToCommandEntryLog('snippet', sqlLike),
                resultTitle: snippet.label
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.safeOutputAppendLine(`[CLPROMPTER][Snippet] Failed id=${snippetId}: ${message}`);
            this.post({ type: 'notice', message: vscode.l10n.t('Code Snippet failed: {message}', { message }) });
        }
    }

    private async addUserSqlSnippet(label: string, stmt: string, group = 'Admin', order?: number): Promise<void> {
        const trimmedLabel = label.trim();
        const trimmedStmt = stmt.trim();
        const trimmedGroup = group.trim() || 'Admin';
        const normalizedOrder = normalizeSnippetOrder(order);
        if (!trimmedLabel || !trimmedStmt) {
            throw new Error('Label and snippet text are required.');
        }

        const existing = this.getMergedSqlSnippets();
        if (existing.some((snippet) => snippet.label.trim().toUpperCase() === trimmedLabel.toUpperCase())) {
            throw new Error(`A snippet named '${trimmedLabel}' already exists.`);
        }

        const now = new Date().toISOString();
        const id = this.createUserSnippetId();
        const userSnippets = this.getUserSqlSnippets();
        userSnippets.push({ id, label: trimmedLabel, stmt: trimmedStmt, group: trimmedGroup, order: normalizedOrder, createdAt: now, updatedAt: now });
        await this.setUserSqlSnippets(userSnippets);

        const snippetOrder = this.getSqlSnippetOrder();
        snippetOrder.push(id);
        await this.setSqlSnippetOrder(snippetOrder);
        this.notifyCodeSnippetsChanged();
    }

    private async updateUserSqlSnippet(id: string, label: string, stmt: string, group?: string, order?: number): Promise<void> {
        const trimmedLabel = label.trim();
        const trimmedStmt = stmt.trim();
        const trimmedGroup = group?.trim();
        const normalizedOrder = normalizeSnippetOrder(order);
        if (!trimmedLabel || !trimmedStmt) {
            throw new Error('Label and snippet text are required.');
        }

        const all = this.getMergedSqlSnippets();
        if (all.some((snippet) => snippet.id !== id && snippet.label.trim().toUpperCase() === trimmedLabel.toUpperCase())) {
            throw new Error(`A snippet named '${trimmedLabel}' already exists.`);
        }

        const userSnippets = this.getUserSqlSnippets();
        const index = userSnippets.findIndex((item) => item.id === id);
        if (index < 0) {
            const builtIn = BUILT_IN_SQL_SNIPPETS.find((snippet) => snippet.id === id);
            if (!builtIn) {
                throw new Error('Snippet no longer exists.');
            }

            const now = new Date().toISOString();
            userSnippets.push({
                id,
                label: trimmedLabel,
                stmt: trimmedStmt,
                group: trimmedGroup || builtIn.group || 'Admin',
                order: normalizedOrder,
                createdAt: now,
                updatedAt: now
            });
            await this.setUserSqlSnippets(userSnippets);
            this.notifyCodeSnippetsChanged();
            return;
        }

        userSnippets[index] = {
            ...userSnippets[index],
            label: trimmedLabel,
            stmt: trimmedStmt,
            group: trimmedGroup || userSnippets[index].group || 'Admin',
            order: normalizedOrder,
            updatedAt: new Date().toISOString()
        };
        await this.setUserSqlSnippets(userSnippets);
        this.notifyCodeSnippetsChanged();
    }

    private async deleteSqlSnippet(id: string): Promise<void> {
        const userSnippets = this.getUserSqlSnippets();
        const kept = userSnippets.filter((item) => item.id !== id);
        let changed = kept.length !== userSnippets.length;
        if (changed) {
            await this.setUserSqlSnippets(kept);
        }

        const builtIn = BUILT_IN_SQL_SNIPPETS.find((snippet) => snippet.id === id);
        if (builtIn) {
            const hiddenBuiltIns = this.getHiddenBuiltInSnippetIds();
            if (!hiddenBuiltIns.has(id)) {
                hiddenBuiltIns.add(id);
                await this.setHiddenBuiltInSnippetIds(hiddenBuiltIns);
                changed = true;
            }
        }

        if (!changed) {
            throw new Error('Snippet no longer exists.');
        }

        const order = this.getSqlSnippetOrder().filter((entryId) => entryId !== id);
        await this.setSqlSnippetOrder(order);
        this.notifyCodeSnippetsChanged();
    }

    private async moveSnippet(id: string, direction: 'up' | 'down'): Promise<void> {
        const snippets = this.getMergedSqlSnippets();
        const index = snippets.findIndex((item) => item.id === id);
        if (index < 0) {
            throw new Error('Snippet no longer exists.');
        }

        const target = direction === 'up' ? index - 1 : index + 1;
        if (target < 0 || target >= snippets.length) {
            return;
        }

        const reordered = [...snippets];
        const [item] = reordered.splice(index, 1);
        reordered.splice(target, 0, item);
        await this.persistMergedSnippetOrder(reordered.map((entry) => entry.id));
        this.notifyCodeSnippetsChanged();
    }

    private notifyCodeSnippetsChanged(): void {
        this.onDidChangeCodeSnippetsEmitter.fire();
    }

    private failed(command: string, mode: CommandExecutionMode, failure: string) {
        return { id: `${Date.now()}-connection`, command, mode, startedAt: new Date().toISOString(), elapsedMs: 0, outcome: 'error' as const, messages: [], failure };
    }

    private currentSqlJobId(connection = this.getConnection()): string | undefined {
        return this.jobManager.getDisplayJobId(connection);
    }

    private messageDetailsMode(): MessageDetailsMode {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const raw = String(
            config.get<string | undefined>('cmdEntryMessageDetails')
            ?? config.get<string>('commandEntryMessageDetails', 'SHOW')
            ?? 'SHOW'
        ).trim().toUpperCase();
        return raw === 'HIDE' ? 'HIDE' : 'SHOW';
    }

    private clearHistoryOnStartupEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');
        return config.get<boolean | undefined>('cmdEntryClearHistoryOnStartup')
            ?? config.get<boolean>('commandEntryClearHistoryOnStartup', false);
    }

    private async consumeSkipHistoryClearOnNextReady(): Promise<boolean> {
        const shouldSkip = this.context.globalState.get<boolean>(SKIP_HISTORY_CLEAR_ON_NEXT_READY_KEY, false);
        if (shouldSkip) {
            await this.context.globalState.update(SKIP_HISTORY_CLEAR_ON_NEXT_READY_KEY, false);
        }
        return shouldSkip;
    }

    private async toggleMessageDetailsPreference(): Promise<void> {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const current = this.messageDetailsMode();
        const next: MessageDetailsMode = current === 'SHOW' ? 'HIDE' : 'SHOW';
        await config.update('cmdEntryMessageDetails', next, vscode.ConfigurationTarget.Global);
        this.post({ type: 'messageDetailsPreference', mode: next });
        this.post({ type: 'notice', message: next === 'SHOW' ? vscode.l10n.t('Command message sections expanded.') : vscode.l10n.t('Command message sections collapsed.') });
    }

    private logSqlStatementsToCommandLogEnabled(): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');
        return config.get<boolean>('cmdEntryRecordSqlStmtsToLog', false);
    }

    private postSqlLoggingPreference(): void {
        this.post({
            type: 'sqlLoggingPreference',
            logSqlStatementsToCommandLog: this.logSqlStatementsToCommandLogEnabled()
        });
    }

    private consumeSqlNotLoggedFeedbackAllowance(): boolean {
        if (!Number.isFinite(this.remainingSqlNotLoggedFeedbackCount) || this.remainingSqlNotLoggedFeedbackCount <= 0) {
            return false;
        }

        this.remainingSqlNotLoggedFeedbackCount -= 1;
        return true;
    }

    private async toggleSqlStatementsToCommandLogPreference(): Promise<void> {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const next = !this.logSqlStatementsToCommandLogEnabled();
        await config.update('cmdEntryRecordSqlStmtsToLog', next, vscode.ConfigurationTarget.Global);
        this.postSqlLoggingPreference();
        this.post({
            type: 'notice',
            message: next
                ? vscode.l10n.t('SQL statement logging to Command Entry Log is enabled.')
                : vscode.l10n.t('SQL statement logging to Command Entry Log is disabled.')
        });
    }

    private isUsingSharedSqlJob(connection = this.getConnection()): boolean {
        const dedicatedUsable = this.jobManager.isDedicatedUsable(connection);
        if (!dedicatedUsable) {
            return true;
        }

        return !this.jobManager.hasActiveDedicatedJob(connection);
    }

    private postJobCapabilities(): void {
        const connection = this.getConnection();
        const dedicatedJobEnabled = this.jobManager.isDedicatedUsable(connection);
        const remoteMapepireEnabled = this.jobManager.isRemoteMapepireServerEnabled(connection);
        const dedicatedReady = dedicatedJobEnabled;
        const useSharedSqlJob = this.isUsingSharedSqlJob(connection);
        this.post({
            type: 'jobCapabilities',
            dedicatedJobEnabled,
            remoteMapepireEnabled,
            useSharedSqlJob,
            canStartNewJob: dedicatedReady,
            canCancelSqlJob: dedicatedReady
        });
    }

    private postAppearancePreferences(): void {
        this.post({
            type: 'appearancePreferences',
            commandTextColor: this.commandEntryCommandTextColor(),
            sqlStatementColor: this.commandEntrySqlStatementColor()
        });
    }

    private commandEntryCommandTextColor(): string {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const value = config.get<string | undefined>('cmdEntryCommandTextColor')
            ?? config.get<string>('commandEntryCommandTextColor', '#569CD6');
        return String(value || '#569CD6').trim() || '#569CD6';
    }

    private commandEntrySqlStatementColor(): string {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const value = config.get<string>('cmdEntrySqlStmtColor', '#3794FF');
        return String(value || '#3794FF').trim() || '#3794FF';
    }

    private resolveWildcardLookupRowLimit(connection?: IBMi): number {
        const settings = getConnectionSqlSettings(this.context, connection);
        const configured = Number.isInteger(settings.fetchRowLimit) && settings.fetchRowLimit > 0
            ? settings.fetchRowLimit
            : COMMAND_PICKER_MIN_ROWS_LIMIT;
        const effective = Math.max(configured, COMMAND_PICKER_MIN_ROWS_LIMIT);
        return Math.min(effective, COMMAND_PICKER_MAX_ROWS_LIMIT);
    }

    private resolveWildcardLookupFetchRows(wildcardRowLimit: number): number {
        const configured = vscode.workspace.getConfiguration('clPrompter').get<number>('cmdGenericCmdFetchBufferSize', COMMAND_PICKER_GENERIC_FETCH_ROWS_DEFAULT);
        const normalized = Number.isInteger(configured) && configured > 0
            ? configured
            : COMMAND_PICKER_GENERIC_FETCH_ROWS_DEFAULT;
        return Math.min(normalized, wildcardRowLimit);
    }

    private sqlFetchLimitDisplay(): string {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const limitEnabled = config.get<boolean | undefined>('cmdEntrySQLLimitFetch')
            ?? config.get<boolean | undefined>('cmdEntryLimitSqlFetch')
            ?? config.get<boolean | undefined>('cmdEntrySqlFetchLimitEnabled')
            ?? config.get<boolean>('commandEntrySqlFetchLimitEnabled', true);
        const prefetchRows = config.get<number | undefined>('cmdEntrySqlFirstPageRowsToFetch')
            ?? config.get<number | undefined>('cmdEntrySqlPrefetchRows')
            ?? config.get<number>('commandEntrySqlPrefetchRows', 200);
        const safePrefetchRows = Number.isInteger(prefetchRows) && prefetchRows > 0 ? prefetchRows : 200;
        if (!limitEnabled) {
            return vscode.l10n.t('SQL rows: *NOMAX (fetch all on run)');
        }

        const configuredRows = config.get<number | undefined>('cmdEntrySqlFetchRowLimit')
            ?? config.get<number | undefined>('cmdEntrySqlFetchLimitRows')
            ?? config.get<number>('commandEntrySqlFetchLimitRows', 1000);
        const chunkRows = Number.isInteger(configuredRows) && configuredRows > 0 ? configuredRows : 1000;
        const effectivePrefetchRows = Math.min(chunkRows, safePrefetchRows);
        return vscode.l10n.t('SQL rows: cap {0}, continuation chunk {1}', String(chunkRows), String(effectivePrefetchRows));
    }

    private async initializeDedicatedJobIfNeeded(): Promise<void> {
        const connection = this.getConnection();
        if (!this.jobManager.isDedicatedUsable(connection)) {
            return; // Not enabled, skip
        }

        if (!connection || !connection.sqlRunnerAvailable()) {
            return; // No connection available
        }

        // Dedicated mode should only consider a real dedicated job as initialized.
        if (this.jobManager.hasActiveDedicatedJob(connection)) {
            return;
        }

        const connectionKey = this.buildHistoryConnectionKey(connection);
        if (this.autoInitInFlightConnectionKeys.has(connectionKey)) {
            return;
        }

        const lastFailureAt = this.autoInitLastFailureByConnectionKey.get(connectionKey);
        if (typeof lastFailureAt === 'number' && (Date.now() - lastFailureAt) < AUTO_INIT_FAILURE_COOLDOWN_MS) {
            return;
        }

        // Create the dedicated job automatically
        this.autoInitInFlightConnectionKeys.add(connectionKey);
        try {
            this.safeOutputAppendLine(`[Cmd Entry] Auto-initializing private SQL job on panel startup...`);
            const sqlJobId = await this.jobManager.restartJob(connection);
            this.refreshSqlJobId(connection);
            this.autoInitLastFailureByConnectionKey.delete(connectionKey);
            if (sqlJobId) {
                this.safeOutputAppendLine(`[Cmd Entry] Auto-initialized private SQL job: ${sqlJobId}`);
            }
        } catch (error) {
            this.refreshSqlJobId(connection);
            this.autoInitLastFailureByConnectionKey.set(connectionKey, Date.now());
            this.safeOutputAppendLine(`[Cmd Entry] Auto-initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.autoInitInFlightConnectionKeys.delete(connectionKey);
        }
    }

    public async handleConnectionAvailable(
        connection = this.getConnection(),
        options: { autoInitializeDedicatedJob?: boolean } = {}
    ): Promise<void> {
        const { autoInitializeDedicatedJob = true } = options;
        this.refreshSqlJobId(connection);
        this.postJobCapabilities();
        this.post({ type: 'connectionScope', connectionScopeKey: this.buildHistoryConnectionKey(connection) });
        this.post({ type: 'historyUpdated', history: this.history(connection) });
        if (autoInitializeDedicatedJob) {
            await this.initializeDedicatedJobIfNeeded();
        }
        this.refreshSqlJobId(connection);
    }

    public refreshSqlJobId(connection = this.getConnection()): void {
        const sqlJobId = this.currentSqlJobId(connection);
        if (sqlJobId !== this.lastPostedSqlJobId) {
            this.safeOutputAppendLine(`[Cmd Entry] SQL job display ID changed: ${this.lastPostedSqlJobId || '<none>'} -> ${sqlJobId || '<none>'}`);
        }
        this.lastPostedSqlJobId = sqlJobId;

        const debugEnabled = vscode.workspace.getConfiguration('clPrompter').get<boolean>('cmdEntryDebugLogging', false);
        if (debugEnabled) {
            console.log('[Cmd Entry][SqlJobDisplayRefresh] posting sqlJobId', {
                sqlJobId: sqlJobId ?? '<none>',
                connection: connection?.currentConnectionName ?? '<unknown>',
                dedicatedEnabled: this.jobManager.isDedicatedEnabled(connection),
                sharedJobId: connection?.getSqlJobId?.() ?? '<none>'
            });
        }
        this.post({ type: 'sqlJobId', sqlJobId });
    }

    private buildHistoryConnectionKey(connection = this.getConnection()): string {
        if (!connection) {
            return 'disconnected';
        }

        const host = String(connection.currentHost ?? (connection as any).host ?? '').trim().toLowerCase();
        const user = String(connection.currentUser ?? (connection as any).username ?? '').trim().toLowerCase();
        const port = String(connection.currentPort ?? (connection as any).port ?? '').trim();
        const key = `${host}|${user}|${port}`;

        return key.length > 0 ? key : 'disconnected';
    }

    private buildLegacyHistoryConnectionKey(connection = this.getConnection()): string {
        if (!connection) {
            return 'disconnected';
        }

        const host = String(connection.currentHost ?? (connection as any).host ?? '').trim().toLowerCase();
        const user = String(connection.currentUser ?? (connection as any).username ?? '').trim().toLowerCase();
        const name = String(connection.currentConnectionName ?? (connection as any).name ?? '').trim().toLowerCase();
        const port = String(connection.currentPort ?? (connection as any).port ?? '').trim();
        const key = `${host}|${user}|${name}|${port}`;

        return key.length > 0 ? key : 'disconnected';
    }

    private historyIsConnectionScoped(): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');
        return config.get<boolean>('cmdEntryHistoryConnectionScoped', false);
    }

    private historyStorageKey(connection = this.getConnection()): string {
        if (!this.historyIsConnectionScoped()) {
            return HISTORY_KEY;
        }
        return `${HISTORY_KEY}.${this.buildHistoryConnectionKey(connection)}`;
    }

    private history(connection = this.getConnection()): CommandEntryHistory[] {
        // History Log entries are stored per connection scope so recall stays local to the active IBM i endpoint.
        const scopedKey = this.historyStorageKey(connection);
        const scopedHistory = this.context.globalState.get<CommandEntryHistory[] | undefined>(scopedKey);
        if (Array.isArray(scopedHistory)) {
            return scopedHistory;
        }

        // Compatibility fallback for older per-connection keys that included
        // the connection name segment.
        if (this.historyIsConnectionScoped()) {
            const legacyScopedKey = `${HISTORY_KEY}.${this.buildLegacyHistoryConnectionKey(connection)}`;
            const legacyScopedHistory = this.context.globalState.get<CommandEntryHistory[] | undefined>(legacyScopedKey);
            if (Array.isArray(legacyScopedHistory)) {
                void this.context.globalState.update(scopedKey, legacyScopedHistory.slice(0, MAX_HISTORY));
                return legacyScopedHistory;
            }
        }

        // One-time compatibility fallback for pre-connection-scoped history.
        const legacyHistory = this.context.globalState.get<CommandEntryHistory[]>(HISTORY_KEY, []);
        if (legacyHistory.length > 0 && this.historyIsConnectionScoped()) {
            void this.context.globalState.update(scopedKey, legacyHistory.slice(0, MAX_HISTORY));
        }
        return legacyHistory;
    }

    private async setHistory(history: CommandEntryHistory[], connection = this.getConnection()): Promise<void> {
        await this.context.globalState.update(this.historyStorageKey(connection), history.slice(0, MAX_HISTORY));
    }
    private shouldAddToHistory(sourceType: 'user' | 'snippet' = 'user', isSql: boolean = false): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');

        if (sourceType === 'snippet') {
            return config.get<boolean>('cmdEntryRecordSnippetsToHistory', false);
        }
        if (isSql) {
            return config.get<boolean>('cmdEntryRecordSqlStmtsToHistory', false);
        }
        return config.get<boolean>('cmdEntryRecordClCmdsToHistory', true);
    }

    private shouldAddToCommandEntryLog(sourceType: 'user' | 'snippet' = 'user', isSql: boolean = false): boolean {
        if (sourceType === 'snippet') {
            return false;
        }

        const config = vscode.workspace.getConfiguration('clPrompter');
        if (isSql) {
            return config.get<boolean>('cmdEntryRecordSqlStmtsToLog', false);
        }
        return true;
    }

    private remember(entry: CommandEntryHistory): void {
        const history = this.history().filter(item => item.command !== entry.command || item.mode !== entry.mode);
        void this.setHistory([entry, ...history]);
    }

    private async openCmdEntrySettingsPanel(): Promise<void> {
        if (this.cmdEntrySettingsPanel) {
            this.cmdEntrySettingsPanel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        const connection = this.getConnection();
        this.cmdEntrySettingsPanel = vscode.window.createWebviewPanel(
            'clprompter.commandEntrySettings',
            vscode.l10n.t('Command Entry Connection Settings'),
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'images')
                ]
            }
        );

        this.cmdEntrySettingsPanel.onDidDispose(() => {
            this.cmdEntrySettingsPanel = undefined;
        });

        try {
            this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(this.cmdEntrySettingsPanel.webview, connection);
        } catch (error) {
            const failure = error instanceof Error ? error.message : String(error);
            this.safeOutputAppendLine(`[Cmd Entry] Connection settings panel fallback render: ${failure}`);
            this.cmdEntrySettingsPanel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:var(--vscode-font-family,sans-serif);background:var(--vscode-editor-background);color:var(--vscode-editor-foreground);padding:20px}p{margin:0 0 12px}.error{color:var(--vscode-testing-iconFailed,#f85149)}</style></head><body><h2>Command Entry Connection Settings</h2><p>Connection settings are unavailable while the IBM i Mapepire endpoint is unreachable.</p><p class="error">${this.escapeHtmlAttribute(failure)}</p></body></html>`;
        }

        this.cmdEntrySettingsPanel.webview.onDidReceiveMessage(async (message: { type?: string; useSharedJob?: boolean; naming?: string; commit?: string; autoCommit?: string; trueAutocommit?: string; extendedMetadata?: boolean; runStartupScript?: boolean; currentLibrary?: string; libraryList?: string; runAfterSqlJobInit?: string; datfmt?: string; timfmt?: string; initialSchema?: string; initialPath?: string; autoColumnViewForSingleRow?: boolean; hasUnsavedChanges?: boolean }) => {
            if (message.type === 'setSqlJobMode') {
                await this.setSharedSqlJobMode(Boolean(message.useSharedJob), 'command');
                if (this.cmdEntrySettingsPanel) {
                    this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(this.cmdEntrySettingsPanel.webview, connection);
                }
            }
            if (message.type === 'saveCmdEntrySettings' || message.type === 'saveAndCloseCmdEntrySettings') {
                const closeAfterSave = message.type === 'saveAndCloseCmdEntrySettings';
                const nextConnection = this.getConnection();
                if (!nextConnection) {
                    return;
                }

                const autoColumnViewForSingleRow = !!message.autoColumnViewForSingleRow;
                await updateConnectionSqlSettings(this.context, nextConnection, {
                    autoColumnViewForSingleRow
                });

                if (this.isUsingSharedSqlJob(nextConnection)) {
                    const statusNotice = vscode.l10n.t('Settings saved. Shared SQL job settings remain fixed by the active IBM i job.');
                    this.postNoticeText(statusNotice, true);
                    if (closeAfterSave) {
                        this.cmdEntrySettingsPanel?.dispose();
                    } else if (this.cmdEntrySettingsPanel) {
                        this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(this.cmdEntrySettingsPanel.webview, nextConnection, 'idle', undefined, statusNotice);
                    }
                    return;
                }

                if (this.hasDisallowedSessionPrefix(message.initialSchema, 'schema')) {
                    this.postNoticeText(vscode.l10n.t('Initial SCHEMA does not accept SET PATH input.'), true);
                    return;
                }
                if (this.hasDisallowedSessionPrefix(message.initialPath, 'path')) {
                    this.postNoticeText(vscode.l10n.t('Initial PATH does not accept SET SCHEMA input.'), true);
                    return;
                }

                const normalizedSchema = this.normalizeInitialSchemaForSave(message.initialSchema);
                if ((message.initialSchema ?? '').trim().length > 0 && !normalizedSchema) {
                    this.postNoticeText(vscode.l10n.t('Initial SCHEMA must be 128 characters or fewer, or *LIBL.'), true);
                    return;
                }
                const normalizedPath = this.normalizeInitialPathForSave(message.initialPath);
                const normalizedCurrentLibrary = this.normalizeCurrentLibraryForSave(message.currentLibrary);
                if ((message.currentLibrary ?? '').trim().length > 0 && !normalizedCurrentLibrary) {
                    this.postNoticeText(vscode.l10n.t('Current Library must be a valid IBM i library name (10 chars max) or *NONE or *CRTDFT.'), true);
                    return;
                }
                const normalizedLibraryList = this.normalizeLibraryListForSave(message.libraryList);
                if ((message.libraryList ?? '').trim().length > 0 && !normalizedLibraryList) {
                    this.postNoticeText(vscode.l10n.t('Library List must be a comma/space separated list of valid IBM i library names (max 10 chars each).'), true);
                    return;
                }
                const normalizedRunAfterSqlJobInit = this.normalizeRunAfterSqlJobInitForSave(message.runAfterSqlJobInit);
                const normalizedRunAfterSqlJobInitText = this.normalizeRunAfterSqlJobInitTextForSave(message.runAfterSqlJobInit);

                const nextOptions = {
                    naming: message.naming === 'system' ? 'system' as const : 'sql' as const,
                    commit: message.commit || undefined,
                    autoCommit: this.parseAutoCommitSelection(message.autoCommit),
                    trueAutocommit: this.parseAutoCommitSelection(message.trueAutocommit),
                    extendedMetadata: typeof message.extendedMetadata === 'boolean' ? message.extendedMetadata : true,
                    runStartupScript: typeof message.runStartupScript === 'boolean' ? message.runStartupScript : true,
                    runAfterSqlJobInitText: normalizedRunAfterSqlJobInitText,
                    currentLibrary: normalizedCurrentLibrary,
                    setCurrentLibraryAfterConnect: true,
                    libraryList: normalizedLibraryList,
                    runAfterSqlJobInit: normalizedRunAfterSqlJobInit,
                    datfmt: message.datfmt || undefined,
                    timfmt: message.timfmt || undefined,
                    initialSchema: normalizedSchema,
                    initialPath: normalizedPath,
                };

                await updateConnectionSqlSettings(this.context, nextConnection, {
                    sessionOptions: {
                        naming: nextOptions.naming,
                        commit: nextOptions.commit,
                        autoCommit: nextOptions.autoCommit,
                        trueAutocommit: nextOptions.trueAutocommit,
                        extendedMetadata: nextOptions.extendedMetadata,
                        runStartupScript: nextOptions.runStartupScript,
                        runAfterSqlJobInitText: nextOptions.runAfterSqlJobInitText,
                        currentLibrary: nextOptions.currentLibrary,
                        setCurrentLibraryAfterConnect: nextOptions.setCurrentLibraryAfterConnect,
                        libraryList: nextOptions.libraryList,
                        runAfterSqlJobInit: nextOptions.runAfterSqlJobInit,
                        datfmt: nextOptions.datfmt,
                        timfmt: nextOptions.timfmt,
                        initialSchema: nextOptions.initialSchema,
                        initialPath: nextOptions.initialPath,
                    }
                });
                const settingsSavedNotice = vscode.l10n.t('Settings saved.');
                this.postNoticeText(settingsSavedNotice, true);

                if (closeAfterSave) {
                    this.cmdEntrySettingsPanel?.dispose();
                } else if (this.cmdEntrySettingsPanel) {
                    this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(this.cmdEntrySettingsPanel.webview, nextConnection, 'idle', undefined, settingsSavedNotice);
                }
            }

            if (message.type === 'setSessionContextNow') {
                const nextConnection = this.getConnection();
                if (!nextConnection || !nextConnection.sqlRunnerAvailable()) {
                    this.postNoticeText(vscode.l10n.t('Not connected to IBM i, or the SQL runner is unavailable.'), true);
                    return;
                }

                if (this.isUsingSharedSqlJob(nextConnection)) {
                    this.postNoticeText(vscode.l10n.t('Shared SQL job settings are fixed by the active IBM i job and cannot be changed here.'), true);
                    return;
                }

                if (this.hasDisallowedSessionPrefix(message.initialSchema, 'schema')) {
                    this.postNoticeText(vscode.l10n.t('Initial SCHEMA does not accept SET PATH input.'), true);
                    return;
                }
                if (this.hasDisallowedSessionPrefix(message.initialPath, 'path')) {
                    this.postNoticeText(vscode.l10n.t('Initial PATH does not accept SET SCHEMA input.'), true);
                    return;
                }

                const normalizedSchema = this.normalizeInitialSchemaForSave(message.initialSchema);
                if ((message.initialSchema ?? '').trim().length > 0 && !normalizedSchema) {
                    this.postNoticeText(vscode.l10n.t('Initial SCHEMA must be 128 characters or fewer, or *LIBL.'), true);
                    return;
                }
                const normalizedPath = this.normalizeInitialPathForSave(message.initialPath);

                const currentOptions = getConnectionSqlSessionOptions(nextConnection);
                const sessionOptions = {
                    naming: currentOptions.naming,
                    commit: currentOptions.commit,
                    autoCommit: currentOptions.autoCommit,
                    extendedMetadata: currentOptions.extendedMetadata,
                    runStartupScript: currentOptions.runStartupScript,
                    runAfterSqlJobInitText: currentOptions.runAfterSqlJobInitText,
                    currentLibrary: currentOptions.currentLibrary,
                    setCurrentLibraryAfterConnect: currentOptions.setCurrentLibraryAfterConnect,
                    libraryList: currentOptions.libraryList,
                    runAfterSqlJobInit: currentOptions.runAfterSqlJobInit,
                    datfmt: currentOptions.datfmt,
                    timfmt: currentOptions.timfmt,
                    initialSchema: normalizedSchema,
                    initialPath: normalizedPath,
                };

                await updateConnectionSqlSettings(this.context, nextConnection, {
                    sessionOptions
                });

                const statements = buildImmediateSessionContextSql(sessionOptions);
                if (statements.length === 0) {
                    this.postNoticeText(vscode.l10n.t('No Initial SCHEMA/PATH override to apply.'), true);
                    return;
                }

                let sessionContextNotice = '';
                try {
                    for (const statement of statements) {
                        await this.jobManager.runSQL(nextConnection, statement, { skipSyntaxCheck: true });
                    }
                    sessionContextNotice = vscode.l10n.t('Session settings applied to the active SQL job.');
                    this.postNoticeText(sessionContextNotice, true);
                } catch (error) {
                    const failure = error instanceof Error ? error.message : String(error);
                    sessionContextNotice = vscode.l10n.t('Set Now failed: {failure}', { failure });
                    this.postNoticeText(sessionContextNotice, true);
                }

                if (this.cmdEntrySettingsPanel) {
                    this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(this.cmdEntrySettingsPanel.webview, nextConnection, 'idle', undefined, sessionContextNotice);
                }
            }

            if (message.type === 'getCurrentUserLibrarySettings') {
                const connection = this.getConnection();
                if (!connection || !connection.sqlRunnerAvailable()) {
                    this.postNoticeText(vscode.l10n.t('Not connected to IBM i, or the SQL runner is unavailable.'), true);
                    return;
                }
                if (this.isUsingSharedSqlJob(connection)) {
                    this.postNoticeText(vscode.l10n.t('Shared SQL job settings are fixed by the active IBM i job and cannot be changed here.'), true);
                    return;
                }

                try {
                    const query = `SELECT
  TRIM(CAST(U.CURRENT_LIBRARY_NAME AS CHAR(10))) AS CURLIB,
  TRIM(
    CASE
      WHEN JDI.LIBRARY_LIST IS NULL THEN S.LIBL
      WHEN JDI.LIBRARY_LIST = '*SYSVAL' THEN S.LIBL
      ELSE JDI.LIBRARY_LIST
    END
  ) AS LIBRARY_LIST
FROM TABLE (
  QSYS2.ACTIVE_JOB_INFO(JOB_NAME_FILTER => '*', DETAILED_INFO => 'NONE')
) J,
LATERAL (
  SELECT *
  FROM TABLE (QSYS2.QSYUSRINFO(J.AUTHORIZATION_NAME)) USR
) U,
LATERAL (
  SELECT *
  FROM TABLE (
    QSYS2.JOB_DESCRIPTION_INFO(
      U.JOB_DESCRIPTION_NAME,
      U.JOB_DESCRIPTION_LIBRARY_NAME
    )
  ) JDI
) JDI,
LATERAL (
  SELECT CURRENT_CHARACTER_VALUE AS LIBL
  FROM QSYS2.SYSTEM_VALUE_INFO
  WHERE SYSTEM_VALUE_NAME = 'QUSRLIBL'
) S
WHERE J.AUTHORIZATION_NAME = CURRENT_USER
FETCH FIRST 1 ROW ONLY`;
                    const rows = await this.jobManager.runSQL(connection, query, { skipSyntaxCheck: true });
                    const row = rows && rows.length > 0 ? rows[0] : undefined;
                    const rawCurrentLibrary = typeof row?.CURLIB === 'string' ? row.CURLIB : typeof row?.curlib === 'string' ? row.curlib : undefined;
                    const rawLibraryList = typeof row?.LIBRARY_LIST === 'string' ? row.LIBRARY_LIST : typeof row?.library_list === 'string' ? row.library_list : undefined;
                    const currentLibraryValue = rawCurrentLibrary ? this.normalizeCurrentLibraryForSave(String(rawCurrentLibrary)) : undefined;
                    const libraryListValue = rawLibraryList ? this.normalizeLibraryListForSave(String(rawLibraryList)) : undefined;

                    const payload: { type: 'applyCurrentUserLibrarySettings'; currentLibrary?: string; libraryList?: string } = {
                        type: 'applyCurrentUserLibrarySettings'
                    };
                    if (currentLibraryValue) {
                        payload.currentLibrary = currentLibraryValue;
                    }
                    if (libraryListValue && libraryListValue.length > 0) {
                        payload.libraryList = libraryListValue.join(', ');
                    }

                    if (!payload.currentLibrary && !payload.libraryList) {
                        this.postNoticeText(vscode.l10n.t('No usable current-user library settings were returned for this profile.'), true);
                        return;
                    }

                    this.cmdEntrySettingsPanel?.webview.postMessage(payload);
                } catch (error) {
                    const failure = error instanceof Error ? error.message : String(error);
                    this.postNoticeText(vscode.l10n.t('Could not read current-user library settings: {failure}', { failure }), true);
                }
            }
            if (message.type === 'viewStartupScriptLog') {
                const connection = this.getConnection();
                if (!connection) {
                    this.postNoticeText(vscode.l10n.t('No IBM i connection is available for the startup script log.'), true);
                    return;
                }

                const workspaceLogUri = this.jobManager.getStartupScriptLogUri(connection);
                if (!workspaceLogUri) {
                    this.postNoticeText(vscode.l10n.t('The startup script log is unavailable in this environment.'), true);
                    return;
                }

                try {
                    await vscode.workspace.fs.stat(workspaceLogUri);
                    await this.openStartupScriptLogPanel(workspaceLogUri, connection.currentConnectionName ?? 'connection');
                } catch {
                    this.postNoticeText(vscode.l10n.t('No startup script log has been generated yet for this connection.'), true);
                }
            }
            if (message.type === 'closeCmdEntrySettings') {
                if (message.hasUnsavedChanges) {
                    const exitWithoutSavingLabel = vscode.l10n.t('Exit without saving');
                    const selection = await vscode.window.showWarningMessage(
                        vscode.l10n.t('You have unsaved changes. Exit without saving?'),
                        { modal: true },
                        exitWithoutSavingLabel
                    );
                    if (selection !== exitWithoutSavingLabel) {
                        return;
                    }
                }
                this.cmdEntrySettingsPanel?.dispose();
            }
            if (message.type === 'reconnectPrivateSqlJob') {
                const reconnectConnection = this.getConnection();
                if (!reconnectConnection) {
                    await this.startNewJob();
                    return;
                }

                if (this.isUsingSharedSqlJob(reconnectConnection)) {
                    this.postNoticeText(vscode.l10n.t('Shared SQL job settings are fixed by the active IBM i job and cannot be changed here.'), true);
                    return;
                }

                if (this.hasDisallowedSessionPrefix(message.initialSchema, 'schema')) {
                    this.postNoticeText(vscode.l10n.t('Initial SCHEMA does not accept SET PATH input.'), true);
                    return;
                }
                if (this.hasDisallowedSessionPrefix(message.initialPath, 'path')) {
                    this.postNoticeText(vscode.l10n.t('Initial PATH does not accept SET SCHEMA input.'), true);
                    return;
                }

                const normalizedSchema = this.normalizeInitialSchemaForSave(message.initialSchema);
                if ((message.initialSchema ?? '').trim().length > 0 && !normalizedSchema) {
                    this.postNoticeText(vscode.l10n.t('Initial SCHEMA must be 128 characters or fewer, or *LIBL.'), true);
                    return;
                }
                const normalizedPath = this.normalizeInitialPathForSave(message.initialPath);
                const normalizedCurrentLibrary = this.normalizeCurrentLibraryForSave(message.currentLibrary);
                if ((message.currentLibrary ?? '').trim().length > 0 && !normalizedCurrentLibrary) {
                    this.postNoticeText(vscode.l10n.t('Current Library must be a valid IBM i library name (10 chars max) or *NONE or *CRTDFT.'), true);
                    return;
                }
                const normalizedLibraryList = this.normalizeLibraryListForSave(message.libraryList);
                if ((message.libraryList ?? '').trim().length > 0 && !normalizedLibraryList) {
                    this.postNoticeText(vscode.l10n.t('Library List must be a comma/space separated list of valid IBM i library names (max 10 chars each).'), true);
                    return;
                }
                const normalizedRunAfterSqlJobInit = this.normalizeRunAfterSqlJobInitForSave(message.runAfterSqlJobInit);
                const normalizedRunAfterSqlJobInitText = this.normalizeRunAfterSqlJobInitTextForSave(message.runAfterSqlJobInit);

                await updateConnectionSqlSettings(this.context, reconnectConnection, {
                    sessionOptions: {
                        naming: message.naming === 'system' ? 'system' : 'sql',
                        commit: message.commit || undefined,
                        autoCommit: this.parseAutoCommitSelection(message.autoCommit),
                        trueAutocommit: this.parseAutoCommitSelection(message.trueAutocommit),
                        extendedMetadata: typeof message.extendedMetadata === 'boolean' ? message.extendedMetadata : true,
                        runStartupScript: typeof message.runStartupScript === 'boolean' ? message.runStartupScript : true,
                        runAfterSqlJobInitText: normalizedRunAfterSqlJobInitText,
                        currentLibrary: normalizedCurrentLibrary,
                        setCurrentLibraryAfterConnect: true,
                        libraryList: normalizedLibraryList,
                        runAfterSqlJobInit: normalizedRunAfterSqlJobInit,
                        datfmt: message.datfmt || undefined,
                        timfmt: message.timfmt || undefined,
                        initialSchema: normalizedSchema,
                        initialPath: normalizedPath,
                    }
                });

                if (this.cmdEntrySettingsPanel) {
                    this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(
                        this.cmdEntrySettingsPanel.webview,
                        reconnectConnection,
                        'reconnecting'
                    );
                }

                try {
                    await this.startNewJob();
                    const refreshedConnection = this.getConnection();
                    const refreshedJobId = refreshedConnection ? this.currentSqlJobId(refreshedConnection) : undefined;
                    if (this.cmdEntrySettingsPanel) {
                        this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(
                            this.cmdEntrySettingsPanel.webview,
                            refreshedConnection ?? reconnectConnection,
                            'success',
                            refreshedJobId
                        );
                    }
                } catch (error) {
                    if (this.cmdEntrySettingsPanel) {
                        this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(
                            this.cmdEntrySettingsPanel.webview,
                            reconnectConnection,
                            'failed'
                        );
                    }
                    throw error;
                }
            }
        });

        this.cmdEntrySettingsPanel.webview.html = await this.buildConnectionSettingsHtml(this.cmdEntrySettingsPanel.webview, connection);
    }

    private readFirstColumnAsString(rows: Record<string, unknown>[] | undefined): string | undefined {
        const firstRow = rows?.[0];
        if (!firstRow) {
            return undefined;
        }

        const firstValue = Object.values(firstRow)[0];
        const normalized = String(firstValue ?? '').trim();
        return normalized.length > 0 ? normalized : undefined;
    }

    private async resolveCurrentSchemaAndPath(connection?: IBMi): Promise<{ currentSchema?: string; currentPath?: string }> {
        if (!connection) {
            return {};
        }

        try {
            const schemaRows = await this.jobManager.runSQL(connection, 'VALUES CURRENT SCHEMA', { skipSyntaxCheck: true });
            const pathRows = await this.jobManager.runSQL(connection, 'VALUES CURRENT PATH', { skipSyntaxCheck: true });
            return {
                currentSchema: this.readFirstColumnAsString(schemaRows),
                currentPath: this.readFirstColumnAsString(pathRows)
            };
        } catch {
            return {};
        }
    }

    private normalizeInitialSessionValue(value: string | undefined): string {
        const trimmed = (value ?? '').trim();
        return trimmed.length > 0 ? trimmed : '*LIBL';
    }

    private normalizeInitialSchemaForSave(value: string | undefined): string | undefined {
        const normalized = normalizeSchemaSessionContextValue(value);
        if (!normalized) {
            return undefined;
        }

        return normalized.length <= 128 ? normalized : undefined;
    }

    private normalizeInitialPathForSave(value: string | undefined): string | undefined {
        return normalizeSessionContextValue(value) ?? undefined;
    }

    private normalizeCurrentLibraryForSave(value: string | undefined): string | undefined {
        const trimmed = (value ?? '').trim();
        if (!trimmed) {
            return undefined;
        }

        const normalized = trimmed.toUpperCase();
        if (normalized === '*NONE' || normalized === '*CRTDFT') {
            return normalized;
        }
        if (normalized.length > 10 || !/^[A-Z0-9_$#@]+$/.test(normalized)) {
            return undefined;
        }

        return normalized;
    }

    private normalizeLibraryListForSave(value: string | undefined): string[] | undefined {
        const raw = (value ?? '').trim();
        if (!raw) {
            return undefined;
        }

        const tokens = splitLibraryListTokens(raw);
        if (!tokens || tokens.length === 0) {
            return undefined;
        }

        const normalized: string[] = [];
        const seen = new Set<string>();
        for (const token of tokens) {
            const item = this.normalizeLibraryListTokenForSave(token);
            if (!item) {
                return undefined;
            }
            if (!seen.has(item)) {
                seen.add(item);
                normalized.push(item);
            }
        }

        return normalized.length > 0 ? normalized : undefined;
    }

    private normalizeLibraryListTokenForSave(value: string | undefined): string | undefined {
        const trimmed = (value ?? '').trim();
        if (!trimmed) {
            return undefined;
        }

        if (trimmed.startsWith('"') || trimmed.endsWith('"')) {
            if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
                return trimmed;
            }
            return undefined;
        }

        return this.normalizeRegularLibraryNameForSave(trimmed);
    }

    private normalizeRegularLibraryNameForSave(value: string | undefined): string | undefined {
        const normalized = (value ?? '').trim().toUpperCase();
        if (!normalized || normalized.length > 10 || !/^[A-Z0-9_$#@]+$/.test(normalized)) {
            return undefined;
        }
        return normalized;
    }

    private normalizeRunAfterSqlJobInitForSave(value: string | undefined): string[] | undefined {
        return splitRunAfterSqlJobInitStatements(value);
    }

    private parseAutoCommitSelection(value: string | undefined): boolean | undefined {
        const normalized = String(value ?? '').trim().toUpperCase();
        if (!normalized) {
            return undefined;
        }

        if (normalized === '*AUTO' || normalized === '*YES' || normalized === 'TRUE') {
            return true;
        }

        if (normalized === '*NO' || normalized === 'FALSE') {
            return false;
        }

        return undefined;
    }

    private normalizeRunAfterSqlJobInitTextForSave(value: string | undefined): string | undefined {
        if (typeof value !== 'string') {
            return undefined;
        }

        const normalized = value.replace(/\r\n?/g, '\n');
        return normalized.trim().length > 0 ? normalized : undefined;
    }

    private hasDisallowedSessionPrefix(value: string | undefined, field: 'schema' | 'path'): boolean {
        const trimmed = (value ?? '').trim();
        if (!trimmed) {
            return false;
        }

        if (field === 'schema') {
            return /^SET\s+PATH\b/i.test(trimmed);
        }

        return /^SET\s+(?:CURRENT\s+)?SCHEMA\b/i.test(trimmed);
    }

    private escapeHtmlAttribute(value: string): string {
        return value
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    private async buildConnectionSettingsHtml(
        webview: vscode.Webview,
        connection = this.getConnection(),
        reconnectStatus: 'idle' | 'reconnecting' | 'success' | 'failed' = 'idle',
        reconnectJobId?: string,
        settingsStatusMessage = ''
    ): Promise<string> {
        const isDedicatedUsable = this.jobManager.isDedicatedUsable(connection);
        const remoteMapepireEnabled = this.jobManager.isRemoteMapepireServerEnabled(connection);
        const useSharedJob = this.isUsingSharedSqlJob(connection);
        const notAvailableLabel = vscode.l10n.t('Not available');
        const currentSqlJobId = this.currentSqlJobId(connection) ?? notAvailableLabel;
        const effectiveJobId = reconnectJobId ?? currentSqlJobId;
        const sqlSettings = getConnectionSqlSettings(this.context, connection);
        const sessionOptions = sqlSettings.sessionOptions;
        const autoColumnViewForSingleRow = !!sqlSettings.autoColumnViewForSingleRow;
        const modeSummary = remoteMapepireEnabled
            ? (useSharedJob ? vscode.l10n.t('Shared SQL Job selected') : vscode.l10n.t('Private SQL Job selected'))
            : vscode.l10n.t('Shared SQL Job selected (server mode unavailable)');
        const sessionControlsDisabled = useSharedJob ? 'disabled' : '';
        const mapepireStatusText = remoteMapepireEnabled
            ? `${vscode.l10n.t('Mapepire')} <span class="server-badge">${vscode.l10n.t('SERVER')}</span> ${vscode.l10n.t('mode is available.')}`
            : vscode.l10n.t('Mapepire server mode is unavailable. Command Entry falls back to the shared SQL job.');
        const sessionReadOnlyNotice = useSharedJob
            ? `<div class="small">${vscode.l10n.t('Shared SQL jobs use the active IBM i job settings and cannot be changed here.')}</div>`
            : `<div class="small">${vscode.l10n.t('Easily change the active SQL Job PATH and SCHEMA by modifying these settings and press Apply now.')}</div>`;
        let liveSessionContext: { currentSchema?: string; currentPath?: string } = {};
        try {
            liveSessionContext = await this.resolveCurrentSchemaAndPath(connection);
        } catch {
            liveSessionContext = {};
        }

        let effectiveConfig: { currentLibrary?: string; libraryList: string[] } | undefined;
        if (connection) {
            try {
                effectiveConfig = await this.jobManager.getConfig(connection);
            } catch {
                effectiveConfig = undefined;
            }
        }
        const currentLibrary = sessionOptions.currentLibrary ?? effectiveConfig?.currentLibrary ?? '';
        const libraryList = (sessionOptions.libraryList ?? effectiveConfig?.libraryList ?? []).join(', ');
        const setCurrentLibraryAfterConnect = sessionOptions.setCurrentLibraryAfterConnect !== false;
        const initialSchema = this.normalizeInitialSessionValue(sessionOptions.initialSchema ?? liveSessionContext.currentSchema);
        const initialPath = this.normalizeInitialSessionValue(sessionOptions.initialPath ?? liveSessionContext.currentPath);
        const runAfterSqlJobInitDefaults = buildRunAfterSqlJobInitDefaults({
            ...sessionOptions,
            currentLibrary: currentLibrary || undefined,
            setCurrentLibraryAfterConnect,
            initialSchema,
            initialPath
        });
        const runAfterSqlJobInitValue = sessionOptions.runAfterSqlJobInitText && sessionOptions.runAfterSqlJobInitText.trim().length > 0
            ? sessionOptions.runAfterSqlJobInitText
            : (sessionOptions.runAfterSqlJobInit && sessionOptions.runAfterSqlJobInit.length > 0
                ? sessionOptions.runAfterSqlJobInit
                : runAfterSqlJobInitDefaults)
                .map((statement) => {
                    const trimmed = statement.trim().replace(/;\s*$/, '');
                    return trimmed.length > 0 ? `${trimmed};` : trimmed;
                })
                .join('\n');
        const currentLibraryEscaped = this.escapeHtmlAttribute(currentLibrary);
        const libraryListEscaped = this.escapeHtmlAttribute(libraryList);
        const runAfterSqlJobInitEscaped = this.escapeHtmlAttribute(runAfterSqlJobInitValue);
        const initialSchemaEscaped = this.escapeHtmlAttribute(initialSchema);
        const initialPathEscaped = this.escapeHtmlAttribute(initialPath);
        const reconnectingLabel = vscode.l10n.t('Reconnecting...');
        const reconnectSuccessLabel = vscode.l10n.t('Reconnect successful');
        const reconnectButtonLabel = reconnectStatus === 'reconnecting'
            ? reconnectingLabel
            : reconnectStatus === 'success'
                ? vscode.l10n.t('Reconnect successful. Job {jobId}', { jobId: effectiveJobId })
                : vscode.l10n.t('Reconnect Server Job');
        const reconnectButtonDisabled = reconnectStatus === 'reconnecting' || !isDedicatedUsable ? 'disabled' : '';
        const reconnectStatusBlock = reconnectStatus === 'success'
            ? `<div class="small success-message">${vscode.l10n.t('Reconnect successful. Job {jobId} is active.', { jobId: effectiveJobId })}</div>`
            : reconnectStatus === 'failed'
                ? `<div class="small error-message">${vscode.l10n.t('Reconnect failed. Try again in a moment.')}</div>`
                : '';
        const noOverrideLabel = '*SAME';
        const panelTitle = vscode.l10n.t('Command Entry Connection Settings');
        const connectionTypeTitle = vscode.l10n.t('Connection Type');
        const connectionSettingsTitle = vscode.l10n.t('Connection Settings');
        const dynamicSettingsTitle = vscode.l10n.t('SQL SCHEMA and PATH Settings');
        const sharedJobLabel = vscode.l10n.t('Shared SQL Job');
        const privateJobLabel = vscode.l10n.t('Private SQL Job');
        const namingLabel = vscode.l10n.t('Naming');
        const commitLabel = vscode.l10n.t('COMMIT');
        const autoCommitLabel = vscode.l10n.t('Auto Commit');
        const trueAutocommitLabel = vscode.l10n.t('True Autocommit');
        const extendedMetadataLabel = vscode.l10n.t('Extended Metadata');
        const extendedMetadataHelpText = vscode.l10n.t('Enables better SQL column information.');
        const currentLibraryLabel = vscode.l10n.t('Value for &CURLIB (current Library):');
        const libraryListLabel = vscode.l10n.t('Value for &LIBL (library list):');
        const runAfterSqlJobInitLabel = vscode.l10n.t('Start up Script');
        const runStartupScriptLabel = vscode.l10n.t('Run startup script after connection is established');
        const runStartupScriptHelpText = vscode.l10n.t('Disable this to keep the script text without executing it.');
        const runAfterSqlJobInitHelpText = vscode.l10n.t('Type the startup script using CL cmd or SQL stmt. Embed &CURLIB or &LIBL where needed (for example, CHGCURLIB &CURLIB). Terminate each stmt with a semicolon.');
        const viewStartupScriptLogLabel = vscode.l10n.t('View Last Startup Log');
        const mapepireSqlJobSettingsTitle = vscode.l10n.t('Mapepire SQL Job Settings');
        const getCurrentUserSettingsHint = vscode.l10n.t('Retrieve Library List from User Profile now');
        const datfmtLabel = vscode.l10n.t('DATFMT');
        const timfmtLabel = vscode.l10n.t('TIMFMT');
        const schemaLabel = vscode.l10n.t('SCHEMA');
        const pathLabel = vscode.l10n.t('PATH');
        const applyNowLabel = vscode.l10n.t('Apply now');
        const applyNowHelpText = vscode.l10n.t('Applies both values shown above to the active SQL job.');
        const autoColumnViewLabel = vscode.l10n.t('Use Column View when result set size is 1 row');
        const autoColumnViewHelpText = vscode.l10n.t('When enabled, an SQL run from Command Entry that returns exactly one row automatically switches to the custom Column View presentation.');
        const getCurrentUserSettingsLabel = vscode.l10n.t('Get from current user');
        const saveLabel = vscode.l10n.t('Save');
        const exitLabel = vscode.l10n.t('Exit');
        const unsavedExitPrompt = vscode.l10n.t('You have unsaved changes. Exit without saving?');
        const sqlJobIdLabel = vscode.l10n.t('SQL Job ID: {jobId}', { jobId: effectiveJobId });
        const applyOnReconnectLabel = vscode.l10n.t('Connection settings are applied when connecting to the IBM i system.');
        const connectionNameLabel = vscode.l10n.t('Connection:');
        const notConnectedLabel = vscode.l10n.t('Not connected');
        const unknownHostLabel = vscode.l10n.t('unknown host');
        const liblPlaceholder = vscode.l10n.t('*LIBL');
        const autoColumnViewChecked = autoColumnViewForSingleRow ? 'checked' : '';
        const extendedMetadataChecked = sessionOptions.extendedMetadata !== false ? 'checked' : '';
        const runStartupScriptChecked = sessionOptions.runStartupScript !== false ? 'checked' : '';
        const trueAutocommitValue = typeof sessionOptions.trueAutocommit === 'boolean'
            ? sessionOptions.trueAutocommit
            : sessionOptions.autoCommit === true && (sessionOptions.commit === '*CHG' || sessionOptions.commit === '*CS' || sessionOptions.commit === '*RR');
        const trueAutocommitDisabled = sessionOptions.autoCommit !== true || !(sessionOptions.commit === '*CHG' || sessionOptions.commit === '*CS' || sessionOptions.commit === '*RR') ? 'disabled' : '';
        const trueAutocommitChecked = trueAutocommitValue ? 'selected' : '';
        const settingsStatusEscaped = this.escapeHtmlAttribute(settingsStatusMessage);

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
            body { font-family: var(--vscode-font-family, sans-serif); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 20px; }
            .panel { max-width: 540px; margin: 0 auto; }
            h1 { margin: 0 0 12px; font-size: 1.2rem; }
            .section { margin-top: 18px; padding: 12px 14px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-sideBar-background); }
            .row { display: flex; align-items: center; gap: 12px; margin: 10px 0; }
            .status { font-size: 12px; opacity: 0.8; }
            label { display: flex; align-items: center; gap: 8px; }
            input[type="radio"] { accent-color: var(--vscode-button-background); }
            input, select, textarea, button { border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px; padding: 6px 10px; }
            input[type="text"] { width: 100%; box-sizing: border-box; }
            select:disabled { opacity: 0.6; cursor: not-allowed; }
            input:disabled { opacity: 0.6; cursor: not-allowed; }
            textarea { width: 100%; box-sizing: border-box; font-family: var(--vscode-editor-font-family, var(--vscode-font-family, monospace)); resize: vertical; }
            textarea:disabled { opacity: 0.6; cursor: not-allowed; }
            button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; }
            button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
            button[disabled] { opacity: 0.5; cursor: not-allowed; }
            .small { font-size: 12px; opacity: 0.8; }
                        .server-badge { font-weight: 700; color: var(--vscode-textLink-foreground, var(--vscode-foreground)); }
                        .success-message { color: var(--vscode-testing-iconPassed, #2ea043); }
                        .error-message { color: var(--vscode-testing-iconFailed, #f85149); }
            .actions-row { justify-content: flex-end; }
            .field { display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; margin: 8px 0; }
            .field-inline { display: flex; align-items: center; gap: 8px; width: 100%; }
            .field-inline input, .field-inline textarea { flex: 1; }
            .settings-fieldset { border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin: 12px 0 4px; padding: 10px 12px 8px; }
            .settings-fieldset legend { padding: 0 6px; font-weight: 600; }
            .startup-script-fieldset { border: 1px solid var(--vscode-panel-border); border-radius: 6px; margin: 12px 0 4px; padding: 10px 12px 8px; }
            .startup-script-fieldset legend { padding: 0 6px; font-weight: 600; }
            .startup-script-examples { margin: 4px 0 8px 18px; padding: 0; }
            .startup-script-examples li { margin: 2px 0; }
            .reset-button { width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-size: 18px; line-height: 1; font-weight: 400; }
                    </style></head><body><div class="panel"><h1>${panelTitle}</h1><div class="status">${connectionNameLabel} ${connection && connection.sqlRunnerAvailable() ? `${connection.currentConnectionName ?? notConnectedLabel} - ${connection.currentHost ?? unknownHostLabel} • ${effectiveJobId}` : notConnectedLabel}</div>
                <div class="section">
                                <div><strong>${connectionTypeTitle}</strong></div>
          <div class="status">${modeSummary}</div>
                      <div class="row"><label><input type="radio" name="sqlJobMode" value="shared" ${useSharedJob ? 'checked' : ''} ${remoteMapepireEnabled ? '' : 'disabled'}> ${sharedJobLabel}</label></div>
                      <div class="row"><label><input type="radio" name="sqlJobMode" value="private" ${!useSharedJob ? 'checked' : ''} ${remoteMapepireEnabled ? '' : 'disabled'}> ${privateJobLabel}</label></div>
                    <div class="small">${mapepireStatusText}</div>
                </div>
                <div class="section">
                                <div><strong>${connectionSettingsTitle}</strong></div>
                                <div class="small">${applyOnReconnectLabel}</div>
                                <fieldset class="settings-fieldset">
                                    <legend>${mapepireSqlJobSettingsTitle}</legend>
                                    <div class="field"><label for="session-naming">${namingLabel}</label><select id="session-naming" ${sessionControlsDisabled}><option value="sql" ${sessionOptions.naming === 'sql' ? 'selected' : ''}>*SQL</option><option value="system" ${sessionOptions.naming === 'system' ? 'selected' : ''}>*SYS</option></select></div>
                                    <div class="field"><label for="session-commit">${commitLabel}</label><select id="session-commit" ${sessionControlsDisabled}><option value="">${noOverrideLabel}</option><option value="*AUTO" ${sessionOptions.commit === '*AUTO' ? 'selected' : ''}>*AUTO</option><option value="*NONE" ${sessionOptions.commit === '*NONE' ? 'selected' : ''}>*NONE</option><option value="*CHG" ${sessionOptions.commit === '*CHG' ? 'selected' : ''}>*CHG</option><option value="*CS" ${sessionOptions.commit === '*CS' ? 'selected' : ''}>*CS</option><option value="*RR" ${sessionOptions.commit === '*RR' ? 'selected' : ''}>*RR</option></select></div>
                                    <div class="field"><label for="session-auto-commit">${autoCommitLabel}</label><select id="session-auto-commit" ${sessionControlsDisabled}><option value="">${noOverrideLabel}</option><option value="*YES" ${sessionOptions.autoCommit === true ? 'selected' : ''}>*YES</option><option value="*NO" ${sessionOptions.autoCommit === false ? 'selected' : ''}>*NO</option></select></div>
                                    <div class="field"><label for="session-true-autocommit">${trueAutocommitLabel}</label><select id="session-true-autocommit" ${sessionControlsDisabled} ${trueAutocommitDisabled}><option value="">${noOverrideLabel}</option><option value="*YES" ${trueAutocommitChecked}>*YES</option><option value="*NO" ${!trueAutocommitValue ? 'selected' : ''}>*NO</option></select></div>
                                    <div class="field"><label for="session-datfmt">${datfmtLabel}</label><select id="session-datfmt" ${sessionControlsDisabled}><option value="">${noOverrideLabel}</option><option value="*ISO" ${sessionOptions.datfmt === '*ISO' ? 'selected' : ''}>*ISO</option><option value="*USA" ${sessionOptions.datfmt === '*USA' ? 'selected' : ''}>*USA</option><option value="*EUR" ${sessionOptions.datfmt === '*EUR' ? 'selected' : ''}>*EUR</option><option value="*JIS" ${sessionOptions.datfmt === '*JIS' ? 'selected' : ''}>*JIS</option><option value="*MDY" ${sessionOptions.datfmt === '*MDY' ? 'selected' : ''}>*MDY</option><option value="*DMY" ${sessionOptions.datfmt === '*DMY' ? 'selected' : ''}>*DMY</option><option value="*YMD" ${sessionOptions.datfmt === '*YMD' ? 'selected' : ''}>*YMD</option></select></div>
                                    <div class="field"><label for="session-timfmt">${timfmtLabel}</label><select id="session-timfmt" ${sessionControlsDisabled}><option value="">${noOverrideLabel}</option><option value="*HMS" ${sessionOptions.timfmt === '*HMS' ? 'selected' : ''}>*HMS</option><option value="*ISO" ${sessionOptions.timfmt === '*ISO' ? 'selected' : ''}>*ISO</option><option value="*USA" ${sessionOptions.timfmt === '*USA' ? 'selected' : ''}>*USA</option><option value="*EUR" ${sessionOptions.timfmt === '*EUR' ? 'selected' : ''}>*EUR</option><option value="*JIS" ${sessionOptions.timfmt === '*JIS' ? 'selected' : ''}>*JIS</option></select></div>
                                    <div class="row"><label><input id="session-extended-metadata" type="checkbox" ${extendedMetadataChecked} ${sessionControlsDisabled}> ${extendedMetadataLabel}</label></div>
                                    <div class="small">${extendedMetadataHelpText}</div>
                                </fieldset>
                                <fieldset class="startup-script-fieldset">
                                    <legend>${runAfterSqlJobInitLabel}</legend>
                                    <div class="field"><label for="session-current-library">${currentLibraryLabel}</label><div class="field-inline"><input id="session-current-library" type="text" maxlength="10" value="${currentLibraryEscaped}" placeholder="${vscode.l10n.t('QGPL or *NONE')}" ${sessionControlsDisabled}></div></div>
                                    <div class="field"><label for="session-library-list">${libraryListLabel}</label><textarea id="session-library-list" rows="2" cols="80" placeholder="${vscode.l10n.t('QGPL, QTEMP')}" ${sessionControlsDisabled}>${libraryListEscaped}</textarea></div>
                                    <div class="row"><button id="session-load-current-user-settings" type="button" ${sessionControlsDisabled}>${getCurrentUserSettingsLabel}</button><span class="small">${getCurrentUserSettingsHint}</span></div>
                                    <div class="row"><label><input id="session-run-startup-script" type="checkbox" ${runStartupScriptChecked} ${sessionControlsDisabled}> ${runStartupScriptLabel}</label></div>
                                    <div class="small">${runStartupScriptHelpText}</div>
                                    <div class="small">${runAfterSqlJobInitHelpText}</div>
                                    <textarea id="session-run-after-sql-job-init" rows="4" cols="80" ${sessionControlsDisabled}>${runAfterSqlJobInitEscaped}</textarea>
                                    <div class="row"><button id="view-startup-script-log" type="button">${viewStartupScriptLogLabel}</button></div>
                                </fieldset>
                    <div class="row"><button id="reconnect-private-job" ${reconnectButtonDisabled}>${reconnectButtonLabel}</button></div>
                    ${reconnectStatusBlock}
                                <div class="small">${sqlJobIdLabel}</div>
        </div>
        <div class="section">
                                <div><strong>${dynamicSettingsTitle}</strong></div>
          ${sessionReadOnlyNotice}
                                <div class="field"><label for="session-initial-schema">${schemaLabel}</label><div class="field-inline"><input id="session-initial-schema" type="text" maxlength="128" value="${initialSchemaEscaped}" placeholder="${liblPlaceholder}" ${sessionControlsDisabled}><button type="button" class="reset-button" title="${vscode.l10n.t('Reset to default value')}" aria-label="${vscode.l10n.t('Reset to default value')}" data-reset-target="session-initial-schema">↻</button></div></div>
                                <div class="field"><label for="session-initial-path">${pathLabel}</label><div class="field-inline"><textarea id="session-initial-path" rows="3" cols="80" placeholder="${liblPlaceholder}" ${sessionControlsDisabled}>${initialPathEscaped}</textarea><button type="button" class="reset-button" title="${vscode.l10n.t('Reset to default value')}" aria-label="${vscode.l10n.t('Reset to default value')}" data-reset-target="session-initial-path">↻</button></div></div>
                                                    <div class="row"><button id="set-session-context-now" ${sessionControlsDisabled}>${applyNowLabel}</button></div>
                                                    <div class="small">${applyNowHelpText}</div>
        </div>
        <div class="section">
                    <div><strong>${vscode.l10n.t('Result View')}</strong></div>
                    <div class="row"><label><input id="auto-column-view-single-row" type="checkbox" ${autoColumnViewChecked}> ${autoColumnViewLabel}</label></div>
                    <div class="small">${autoColumnViewHelpText}</div>
        </div>
                <div class="section">
                    <div id="settings-status-line" class="small">${settingsStatusEscaped}</div>
                    <div class="row actions-row">
                                    <button id="save-settings">${saveLabel}</button>
                                    <button id="close-settings-panel" class="secondary">${exitLabel}</button>
                    </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          const radios = document.querySelectorAll('input[name="sqlJobMode"]');
          for (const radio of radios) {
            radio.addEventListener('change', () => {
              const useSharedJob = radio.value === 'shared';
              vscode.postMessage({ type: 'setSqlJobMode', useSharedJob });
            });
          }
          const naming = document.getElementById('session-naming');
          const commit = document.getElementById('session-commit');
          const autoCommit = document.getElementById('session-auto-commit');
          const trueAutocommit = document.getElementById('session-true-autocommit');
          const extendedMetadata = document.getElementById('session-extended-metadata');
                            const syncTrueAutocommit = () => {
                                if (!trueAutocommit) {
                                    return;
                                }
                                const commitValue = commit ? commit.value : '';
                                const autoCommitEnabled = autoCommit ? (autoCommit.value === '*YES' || autoCommit.value === '*AUTO') : false;
                                const allowTrueAutocommit = autoCommitEnabled && (commitValue === '*CHG' || commitValue === '*CS' || commitValue === '*RR');
                                trueAutocommit.disabled = !allowTrueAutocommit;
                                if (!allowTrueAutocommit) {
                                    trueAutocommit.value = '*NO';
                                }
                            };
                            commit?.addEventListener('change', syncTrueAutocommit);
                            autoCommit?.addEventListener('change', syncTrueAutocommit);
                            syncTrueAutocommit();
          const runStartupScript = document.getElementById('session-run-startup-script');
          const currentLibrary = document.getElementById('session-current-library');
          const libraryList = document.getElementById('session-library-list');
          const loadCurrentUserSettingsButton = document.getElementById('session-load-current-user-settings');
          const runAfterSqlJobInit = document.getElementById('session-run-after-sql-job-init');
          const viewStartupScriptLog = document.getElementById('view-startup-script-log');
          const datfmt = document.getElementById('session-datfmt');
          const timfmt = document.getElementById('session-timfmt');
                    const initialSchema = document.getElementById('session-initial-schema');
                    const initialPath = document.getElementById('session-initial-path');
                    const autoColumnViewSingleRow = document.getElementById('auto-column-view-single-row');
                    loadCurrentUserSettingsButton?.addEventListener('click', () => {
                        vscode.postMessage({ type: 'getCurrentUserLibrarySettings' });
                    });
                    viewStartupScriptLog?.addEventListener('click', () => {
                        vscode.postMessage({ type: 'viewStartupScriptLog' });
                    });
                    window.addEventListener('message', (event) => {
                        const message = event.data;
                        if (!message) {
                            return;
                        }
                        if (message.type === 'settingsStatus') {
                            const settingsStatusLine = document.getElementById('settings-status-line');
                            if (settingsStatusLine && typeof message.message === 'string') {
                                settingsStatusLine.textContent = message.message;
                            }
                            return;
                        }
                        if (message.type !== 'applyCurrentUserLibrarySettings') {
                            return;
                        }
                        if (currentLibrary && typeof message.currentLibrary === 'string') {
                            currentLibrary.value = message.currentLibrary;
                        }
                        if (libraryList && typeof message.libraryList === 'string') {
                            libraryList.value = message.libraryList;
                        }
                    });
                    document.querySelectorAll('[data-reset-target]').forEach((resetButton) => {
                        resetButton.addEventListener('click', () => {
                            const target = resetButton.getAttribute('data-reset-target');
                            const field = target === 'session-initial-schema' ? initialSchema : target === 'session-initial-path' ? initialPath : null;
                            if (!field) {
                                return;
                            }
                            field.value = '*LIBL';
                            field.dispatchEvent(new Event('input', { bubbles: true }));
                        });
                    });
                    const collectValues = () => ({
                        naming: naming ? naming.value : 'sql',
                        commit: commit ? commit.value : '',
                        autoCommit: autoCommit ? autoCommit.value : '',
                        trueAutocommit: trueAutocommit ? trueAutocommit.value : '',
                        extendedMetadata: extendedMetadata ? !!extendedMetadata.checked : true,
                        runStartupScript: runStartupScript ? !!runStartupScript.checked : true,
                        currentLibrary: currentLibrary ? currentLibrary.value : '',
                        libraryList: libraryList ? libraryList.value : '',
                        runAfterSqlJobInit: runAfterSqlJobInit ? runAfterSqlJobInit.value : '',
                        datfmt: datfmt ? datfmt.value : '',
                        timfmt: timfmt ? timfmt.value : '',
                        initialSchema: initialSchema ? initialSchema.value : '',
                        initialPath: initialPath ? initialPath.value : '',
                        autoColumnViewForSingleRow: autoColumnViewSingleRow ? !!autoColumnViewSingleRow.checked : false
                    });
                    const serializeValues = (values) => JSON.stringify(values);
                    const initialValuesSnapshot = serializeValues(collectValues());
                    const hasUnsavedChanges = () => serializeValues(collectValues()) !== initialValuesSnapshot;
          const reconnect = document.getElementById('reconnect-private-job');
          reconnect?.addEventListener('click', () => {
                        if (reconnect.disabled) {
                            return;
                        }
                        reconnect.disabled = true;
                        reconnect.textContent = '${reconnectingLabel}';
                        vscode.postMessage({ type: 'reconnectPrivateSqlJob', ...collectValues() });
          });

                    const setNow = document.getElementById('set-session-context-now');
                    setNow?.addEventListener('click', () => {
                        if (setNow.disabled) {
                            return;
                        }
                        vscode.postMessage({ type: 'setSessionContextNow', ...collectValues() });
                    });

                    const save = document.getElementById('save-settings');
                    save?.addEventListener('click', () => {
                        if (save.disabled) {
                            return;
                        }
                        vscode.postMessage({ type: 'saveCmdEntrySettings', ...collectValues() });
                    });

                    const closePanel = document.getElementById('close-settings-panel');
                    closePanel?.addEventListener('click', () => {
                        vscode.postMessage({ type: 'closeCmdEntrySettings', hasUnsavedChanges: hasUnsavedChanges() });
                    });
        </script>
        </div></body></html>`;
    }

    private async openCmdEntryHelpPanel(): Promise<void> {
        if (this.cmdEntryHelpPanel) {
            this.cmdEntryHelpPanel.reveal(vscode.ViewColumn.Beside, true);
            return;
        }

        this.cmdEntryHelpPanel = vscode.window.createWebviewPanel(
            CMD_ENTRY_HELP_PANEL_TYPE,
            CMD_ENTRY_HELP_PANEL_TITLE,
            vscode.ViewColumn.Beside,
            {
                enableScripts: false,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'media'),
                    vscode.Uri.joinPath(this.context.extensionUri, 'images')
                ]
            }
        );

        this.cmdEntryHelpPanel.onDidDispose(() => {
            this.cmdEntryHelpPanel = undefined;
        });

        this.cmdEntryHelpPanel.webview.html = await this.buildCmdEntryHelpHtml(this.cmdEntryHelpPanel.webview);
    }

    private async openStartupScriptLogPanel(logUri: vscode.Uri, connectionName: string): Promise<void> {
        const startupScriptLogPanelTitle = vscode.l10n.t('Startup Script Log - {connectionName}', { connectionName });
        if (this.startupScriptLogPanel) {
            this.startupScriptLogPanel.reveal(vscode.ViewColumn.Beside, true);
            const markdown = await vscode.workspace.fs.readFile(logUri).then((bytes) => Buffer.from(bytes).toString('utf8'));
            this.startupScriptLogPanel.webview.html = this.buildStartupScriptLogHtml(markdown, connectionName);
            return;
        }

        this.startupScriptLogPanel = vscode.window.createWebviewPanel(
            'clprompter.startupScriptLog',
            startupScriptLogPanelTitle,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: false,
                localResourceRoots: []
            }
        );

        this.startupScriptLogPanel.onDidDispose(() => {
            this.startupScriptLogPanel = undefined;
        });

        const markdown = await vscode.workspace.fs.readFile(logUri).then((bytes) => Buffer.from(bytes).toString('utf8'));
        this.startupScriptLogPanel.webview.html = this.buildStartupScriptLogHtml(markdown, connectionName);

        this.startupScriptLogPanel.webview.onDidReceiveMessage((message: { type?: string }) => {
            if (message.type === 'openStartupScriptSource') {
                void vscode.commands.executeCommand('vscode.open', logUri, { preview: false });
            }
        });
    }

    private buildStartupScriptLogHtml(markdown: string, connectionName: string): string {
        const viewRawFileLabel = vscode.l10n.t('View raw file');
        const startupScriptLogTitle = vscode.l10n.t('Startup Script Log - {connectionName}', { connectionName: this.escapeHtmlAttribute(connectionName) });
        const sanitized = markdown
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        const body = sanitized
            .split('\n')
            .map((line) => {
                const trimmed = line.trim();
                if (/^#{1,6} /.test(line)) {
                    return `<h3>${line.replace(/^#{1,6}\s*/, '')}</h3>`;
                }
                if (/^- /.test(line) || /^\* /.test(line)) {
                    return `<li>${trimmed.slice(2)}</li>`;
                }
                if (!line.trim()) {
                    return '<br>';
                }
                return `<div>${line}</div>`;
            })
            .join('');

        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>
            body { font-family: var(--vscode-font-family, sans-serif); background: var(--vscode-editor-background); color: var(--vscode-editor-foreground); margin: 0; padding: 16px; }
            .panel { max-width: 900px; margin: 0 auto; }
            h1 { margin: 0 0 12px; font-size: 1.2rem; }
            .toolbar { display: flex; justify-content: flex-end; margin-bottom: 12px; }
            button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 4px; padding: 6px 10px; cursor: pointer; }
            pre { white-space: pre-wrap; word-break: break-word; margin: 0; font-family: var(--vscode-editor-font-family, monospace); }
            li { margin-left: 18px; }
            .log { background: var(--vscode-editor-inactiveSelectionBackground); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 12px; }
        </style></head><body><div class="panel"><div class="toolbar"><button id="open-source">${viewRawFileLabel}</button></div><h1>${startupScriptLogTitle}</h1><div class="log"><pre>${body}</pre></div></div><script>
            const vscode = acquireVsCodeApi();
            document.getElementById('open-source')?.addEventListener('click', () => vscode.postMessage({ type: 'openStartupScriptSource' }));
        </script></body></html>`;
    }

    private async buildCmdEntryHelpHtml(webview: vscode.Webview): Promise<string> {
        const templateUri = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'cmdEntryHelp.html');
        const screenshotUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'images', 'cmdEntry_FullPanel.png')
        ).toString();

        try {
            const bytes = await vscode.workspace.fs.readFile(templateUri);
            const template = Buffer.from(bytes).toString('utf8');
            return template
                .split('{{CSP_SOURCE}}').join(webview.cspSource)
                .split('{{HELP_TITLE}}').join(CMD_ENTRY_HELP_PANEL_TITLE)
                .split('{{IMG_CMDENTRY_FULL_PANEL}}').join(screenshotUri);
        } catch (error) {
            this.safeOutputAppendLine(`[Cmd Entry] Failed to load cmdEntry help template: ${error instanceof Error ? error.message : String(error)}`);
            return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${CMD_ENTRY_HELP_PANEL_TITLE}</title></head><body><h1>${CMD_ENTRY_HELP_PANEL_TITLE}</h1><p>Unable to load help content.</p></body></html>`;
        }
    }

    private post(message: unknown): void { void this.view?.webview.postMessage(message); }

    private postNoticeText(message: string, mirrorToSettingsStatus = false): void {
        this.post({ type: 'notice', message });
        if (mirrorToSettingsStatus) {
            void this.cmdEntrySettingsPanel?.webview.postMessage({ type: 'settingsStatus', message });
        }
    }

    private safeOutputAppendLine(message: string): void {
        try {
            this.output.appendLine(message);
        } catch (error) {
            // During extension-host shutdown/deactivation the channel may already be closed.
            const text = error instanceof Error ? error.message : String(error);
            if (!/channel has been closed/i.test(text)) {
                console.warn(`[clPrompter] Command Entry output append failed: ${text}`);
            }
        }
    }

    private html(webview: vscode.Webview): string {
        const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commandEntry.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commandEntry.css'));
        const commandEntryL10n = {
            noConnectionText: vscode.l10n.t('no connection'),
            runningStatusPrefix: vscode.l10n.t('Running…'),
            sqlJobIdLabel: vscode.l10n.t('SQL job ID'),
            sharedJobMarkerLabel: vscode.l10n.t('(shared job; trailing * marker shown)'),
            clickToCopyDisplayJoblogLabel: vscode.l10n.t('Click to copy, double-click to display joblog, right-click for menu.'),
            noConnectionJobDetectedLabel: vscode.l10n.t('No IBM i connection job detected. Connect to an IBM i server to enable Command Entry.'),
            runModePrefix: vscode.l10n.t('Run Mode'),
            selectRunModeTitle: vscode.l10n.t('Select run mode'),
            runModeRunLabel: vscode.l10n.t('Run'),
            runModeRunTitle: vscode.l10n.t('Run CL command'),
            runModeLimitLabel: vscode.l10n.t('Limit'),
            runModeLimitTitle: vscode.l10n.t('Run as limited user profile'),
            runModeCheckLabel: vscode.l10n.t('Check'),
            runModeCheckTitle: vscode.l10n.t('Syntax check only'),
            showMessageDetailsLabel: vscode.l10n.t('Show Message Details'),
            hideMessageDetailsLabel: vscode.l10n.t('Hide Message Details'),
            showMessageDetailsTitle: vscode.l10n.t('Show command-level message details'),
            hideMessageDetailsTitle: vscode.l10n.t('Hide command-level message details'),
            commandCopyRecallTooltip: vscode.l10n.t('Click=Recall, Ctrl/Cmd+Click=Copy')
        };
        const head = `
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <link rel="stylesheet" href="${style}">
            </head>`;

        const body = `
            <body>
                <main>
                    <div class="command-row">
                        <label class="sr-only" for="command">${vscode.l10n.t('CL command')}</label>
                        <div class="command-input-wrap">
                            <textarea id="command" spellcheck="false" placeholder="${vscode.l10n.t('Enter CL command or SQL statement')}" aria-label="${vscode.l10n.t('CL command')}" rows="3"></textarea>
                        </div>
                        <button id="run" type="button" aria-label="${vscode.l10n.t('Run command')}" data-tooltip="${vscode.l10n.t('Run command')}">${vscode.l10n.t('Run')}</button>
                        <button id="prompt" type="button" aria-label="${vscode.l10n.t('Prompt command')}" data-tooltip="${vscode.l10n.t('Prompt command')}">${vscode.l10n.t('Prompt')}</button>
                        <div class="severity-wrap">
                            <label class="mode-label" for="message-severity-filter" title="${vscode.l10n.t('Minimum Severity Filter')}">${vscode.l10n.t('SEV')}</label>
                            <select id="message-severity-filter" aria-label="${vscode.l10n.t('Minimum message severity to display')}" title="${vscode.l10n.t('Minimum Severity Filter')}">
                                <option value="0">00</option>
                                <option value="10">10</option>
                                <option value="20">20</option>
                                <option value="30">30</option>
                                <option value="40">40</option>
                                <option value="50">50</option>
                                <option value="60">60</option>
                                <option value="70">70</option>
                                <option value="80">80</option>
                                <option value="90">90</option>
                                <option value="99">99</option>
                            </select>
                        </div>
                        <button id="history-next" type="button" aria-label="${vscode.l10n.t('Recall next command (F8)')}" data-tooltip="${vscode.l10n.t('F8=Retrieve Next CL Cmd')}">↓</button>
                        <button id="history-prev" type="button" aria-label="${vscode.l10n.t('Recall prior command (F9)')}" data-tooltip="${vscode.l10n.t('F9=Retrieve Prior CL Cmd')}">↑</button>
                        <select id="mode" class="sr-only" aria-hidden="true" tabindex="-1">
                            <option value="*RUN" title="${vscode.l10n.t('Run CL Command')}">${vscode.l10n.t('Run')}</option>
                            <option value="*LIMIT" title="${vscode.l10n.t('Run as Limited USRPRF')}">${vscode.l10n.t('Limit')}</option>
                            <option value="*CHECK" title="${vscode.l10n.t('Syntax Check Only')}">${vscode.l10n.t('Check')}</option>
                        </select>
                    </div>
                    <div id="status" role="status" aria-live="polite">
                        <span id="status-text"></span>
                        <span id="status-jobid" aria-label="${vscode.l10n.t('SQL job ID')}" title="${vscode.l10n.t('Click=Copy, Double-Click=Display Joblog')}" tabindex="0" hidden></span>
                        <div id="status-job-menu" class="toolbar-menu-list" role="menu" aria-hidden="true">
                            <button id="status-job-menu-copy" type="button" role="menuitem">${vscode.l10n.t('Copy job name')}</button>
                            <button id="status-job-menu-display-joblog" type="button" role="menuitem">${vscode.l10n.t('Display Joblog')}</button>
                        </div>
                    </div>
                    <section id="results" aria-label="Command results"></section>
                </main>
            </body>`;

        const scripts = `
            <script nonce="${nonce}">const vscode = acquireVsCodeApi(); window.__clPrompterCommandEntryL10n = ${JSON.stringify(commandEntryL10n)};</script>
            <script nonce="${nonce}" src="${script}"></script>`;

        return `<!DOCTYPE html>
            <html lang="en">
                ${head}
                ${body}
                ${scripts}
            </html>`;
    }
}
