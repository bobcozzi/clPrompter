import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import * as vscode from 'vscode';
import { CLPrompter } from './clPrompter';
import { CommandEntryJobManager } from './commandEntryJobManager';
import { CommandEntryHistory, CommandExecutionMode } from './commandEntryModel';
import { detectCommandEntryPrefix } from './commandEntryPrefixes';
import { CommandEntryService } from './commandEntryService';
import { updateConnectionSqlSettings } from './commandEntrySqlSettings';
import { configureSqlResultPanelAssets, notifySqlResultSessionClosed, setSqlResultPanelRequestHandler, showSqlResultPanel } from './sqlResultPanel';

const HISTORY_KEY = 'commandEntry.history';
const MAX_HISTORY = 100;
const SKIP_HISTORY_CLEAR_ON_NEXT_READY_KEY = 'clprompter.skipHistoryClearOnNextReady';
const SQL_SNIPPETS_USER_KEY = 'commandEntry.sqlSnippets.user';
const SQL_SNIPPETS_ORDER_KEY = 'commandEntry.sqlSnippets.order';
const SQL_SNIPPETS_HIDDEN_BUILTINS_KEY = 'commandEntry.sqlSnippets.hiddenBuiltins';
const SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY = 'commandEntry.sqlSnippets.defaultsMergedVersion';
const SQL_SNIPPETS_MAX = 200;
const CMD_ENTRY_HELP_PANEL_TYPE = 'clprompter.commandEntryHelp';
const CMD_ENTRY_HELP_PANEL_TITLE = 'CL Command Entry Help';
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
    | { type: 'toggleSnippetsTreeView' }
    | { type: 'manageCodeSnippets' }
    | { type: 'addCodeSnippet' }
    | { type: 'refreshCodeSnippets' }
    | { type: 'importCodeSnippets' }
    | { type: 'exportCodeSnippets' }
    | { type: 'openCmdEntryHelp' }
    | { type: 'openCmdEntrySettings' }
    | { type: 'openSnippetsMenu' }
    | { type: 'openSqlSnippetsMenu' }
    | { type: 'menuDebug'; phase: string; payload?: unknown }
    | { type: 'toggleMessageDetails' }
    | { type: 'toggleSqlStatementsToCommandLog' }
    | { type: 'useSharedSqlJob' }
    | { type: 'usePrivateSqlJob' }
    | { type: 'startNewJob' }
    | { type: 'clearSqlHistoryAndMessages' }
    | { type: 'clearHistoryAndMessages' }
    | { type: 'clear' };

type MessageDetailsMode = 'SHOW' | 'HIDE';

interface CommandEntrySqlSnippet {
    id: string;
    label: string;
    stmt: string;
    group: string;
    order?: number;
    source: 'built-in' | 'user';
    createdAt?: string;
    updatedAt?: string;
}

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




// Command Entry uses two distinct user-facing log terms:
// History Log = recalled command history, and Joblog = the IBM i job message log.
const BUILT_IN_SQL_SNIPPETS: ReadonlyArray<CommandEntrySqlSnippet> = [
    {
        id: 'builtin.lastest-joblog',
        label: 'Joblog (last 200 msgs)',
        stmt: [
            'SELECT ORDINAL_POSITION as SEQNBR,',
            '       MESSAGE_ID as MSGID, SEVERITY as SEV, ',
            "       CASE UPPER(TRIM(MESSAGE_TYPE)) WHEN 'COMMAND' THEN '*CMD' WHEN 'COMPLETION' THEN '*COMP'",
            "       WHEN 'DIAGNOSTIC' THEN '*DIAG' WHEN 'ESCAPE' THEN '*ESCAPE' WHEN 'INFORMATIONAL' THEN '*INFO'",
            "       WHEN 'INQUIRY' THEN '*INQ' WHEN 'NOTIFY' THEN '*NOTIFY' WHEN 'REPLY' THEN '*RPY'",
            "       WHEN 'REQUEST' THEN '*RQS' WHEN 'SCOPE' THEN '*SCOPE' WHEN 'SENDER' THEN '*SENDER'",
            '       ELSE MESSAGE_TYPE END AS MSGTYPE,',
            '       MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT as MSG_SECOND_LVL,',
            "   TRIM(from_library) CONCAT '/' CONCAT TRIM(from_program) CONCAT '(' CONCAT TRIM(from_instruction) CONCAT ')'",
            '      AS "FROM_PGM(Stmt)",',
            "   TRIM(to_library) CONCAT '/' CONCAT TRIM(to_program) CONCAT '(' CONCAT TRIM(to_instruction) CONCAT ')'",
            '      AS "TO_PGM(Stmt)",',
            '       QUALIFIED_JOB_NAME as JOB, MESSAGE_TIMESTAMP',
            "FROM TABLE(QSYS2.JOBLOG_INFO('${sqlJobId}'))",
            'ORDER BY ORDINAL_POSITION DESC FETCH FIRST 200 ROWS ONLY'
        ].join(' '),
        group: 'Job Info',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.full-joblog',
        label: 'Joblog (full)',
        stmt: [
            'SELECT ORDINAL_POSITION as SEQNBR,',
            '       MESSAGE_ID as MSGID, SEVERITY as SEV, ',
            "       CASE UPPER(TRIM(MESSAGE_TYPE)) WHEN 'COMMAND' THEN '*CMD' WHEN 'COMPLETION' THEN '*COMP'",
            "       WHEN 'DIAGNOSTIC' THEN '*DIAG' WHEN 'ESCAPE' THEN '*ESCAPE' WHEN 'INFORMATIONAL' THEN '*INFO'",
            "       WHEN 'INQUIRY' THEN '*INQ' WHEN 'NOTIFY' THEN '*NOTIFY' WHEN 'REPLY' THEN '*RPY'",
            "       WHEN 'REQUEST' THEN '*RQS' WHEN 'SCOPE' THEN '*SCOPE' WHEN 'SENDER' THEN '*SENDER'",
            '       ELSE MESSAGE_TYPE END AS MSGTYPE,',
            '       MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT as MSG_SECOND_LVL,',
            "   TRIM(from_library) CONCAT '/' CONCAT TRIM(from_program) CONCAT '(' CONCAT TRIM(from_instruction) CONCAT ')'",
            '      AS "FROM_PGM(Stmt)",',
            "   TRIM(to_library) CONCAT '/' CONCAT TRIM(to_program) CONCAT '(' CONCAT TRIM(to_instruction) CONCAT ')'",
            '      AS "TO_PGM(Stmt)",',
            '       QUALIFIED_JOB_NAME as JOB, MESSAGE_TIMESTAMP',
            "FROM TABLE(QSYS2.JOBLOG_INFO('${sqlJobId}'))",
            'ORDER BY ORDINAL_POSITION DESC'
        ].join(' '),
        group: 'Job Info',
        order: 20,
        source: 'built-in'
    },
    {
        id: 'builtin.library-list',
        label: 'Library List',
        stmt: "SELECT * FROM QSYS2.LIBRARY_LIST_INFO",
        group: 'Job Info',
        order: 30,
        source: 'built-in'
    },
    {
        id: 'builtin.last-spooled-file',
        label: 'Display Last SPOOLED File',
        stmt: [
            'WITH sf AS (',
            'SELECT * FROM TABLE (qsys2.spooled_file_info(',
            "     USER_NAME => '*CURRENT', job_name => '*ALL',",
            "     STARTING_TIMESTAMP => current_date,",
            "     ENDING_TIMESTAMP => current_timestamp)) SF",
            '  ORDER BY sf.creation_timestamp DESC',
            '  LIMIT 1',
            ') ',
            'SELECT sd.* FROM sf',
            ',LATERAL (SELECT * FROM TABLE(systools.spooled_file_data(',
            '           JOB_NAME => SF.QUALIFIED_JOB_NAME,',
            '           SPOOLED_FILE_NAME => SF.SPOOLED_FILE_NAME,',
            '           SPOOLED_FILE_NUMBER => SF.SPOOLED_FILE_NUMBER)) spd',
            ') sd'
        ].join(' '),
        group: 'Job Info',
        order: 90,
        source: 'built-in'
    },
    {
        id: 'builtin.job-splf-list',
        label: 'SPOOLED Files (Job)',
        stmt: [
            'SELECT SPOOLED_FILE_NAME AS SPLFNAME, SPOOLED_FILE_NUMBER AS SPLNBR, STATUS,',
            '       QUALIFIED_JOB_NAME AS JOB, OUTPUT_PRIORITY AS OUTPTY, TOTAL_PAGES AS PAGES,',
            '       COPIES, CREATION_TIMESTAMP AS CREATED, USER_DATA, FILE_AVAILABLE AS FILE_AVAIL,',
            '       SIZE, FORM_TYPE, OUTPUT_QUEUE_LIBRARY AS OUTQ_LIB, OUTPUT_QUEUE AS OUTQ_NAME,',
            '       ASP_NUMBER, SYSTEM',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${sqlJobId}' ))",
            "WHERE (SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE')",
            'ORDER BY CREATION_TIMESTAMP'
        ].join(' '),
        group: 'Job Info',
        order: 100,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-slow',
        label: 'Active Jobs (Detailed)',
        stmt: [
            'SELECT aj.JOB_NAME, aj.SUBSYSTEM, aj.AUTHORIZATION_NAME as USER_NAME,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            ' , OUTPUT_QUEUE, JOB_USER_IDENTITY, PAGE_FAULTS, DATABASE_LOCK_WAITS, OPEN_FILES',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL', SUBSYSTEM_LIST_FILTER => '${userSBSList}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 10,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-usersbs',
        label: 'Active Jobs (Faster)',
        stmt: [
            'SELECT aj.JOB_NAME, aj.SUBSYSTEM, aj.AUTHORIZATION_NAME as USER_NAME,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => '${userSBSList}')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 20,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qinter',
        label: 'Active Jobs sbs(QINTER)',
        stmt: [
            'SELECT aj.JOB_NAME, aj.SUBSYSTEM, aj.AUTHORIZATION_NAME as USER_NAME,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QINTER')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 30,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qusrwrk',
        label: 'Active Jobs sbs(QUSRWRK)',
        stmt: [
            'SELECT aj.JOB_NAME, aj.SUBSYSTEM, aj.AUTHORIZATION_NAME as USER_NAME,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QUSRWRK')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 40,
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qhttpsvr',
        label: 'Active Jobs sbs(QHTTPSVR)',
        stmt: [
            'SELECT aj.JOB_NAME, aj.SUBSYSTEM, aj.AUTHORIZATION_NAME as USER_NAME,',
            " trim(aj.FUNCTION_TYPE) concat '-' concat aj.FUNCTION as FUNCTION_INFO,",
            ' JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QHTTPSVR')) aj",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        order: 50,
        source: 'built-in'
    },
    {
        id: 'builtin.spooled-files-user',
        label: 'SPOOLED Files (User)',
        stmt: [
            'SELECT SPOOLED_FILE_NAME AS SPLFNAME, SPOOLED_FILE_NUMBER AS SPLNBR, STATUS,',
            '       QUALIFIED_JOB_NAME AS JOB, OUTPUT_PRIORITY AS OUTPTY, TOTAL_PAGES AS PAGES,',
            '       COPIES, CREATION_TIMESTAMP AS CREATED, USER_DATA, FILE_AVAILABLE AS FILE_AVAIL,',
            '       SIZE, FORM_TYPE, OUTPUT_QUEUE_LIBRARY AS OUTQ_LIB, OUTPUT_QUEUE AS OUTQ_NAME,',
            '       ASP_NUMBER, SYSTEM',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(USER_NAME => '${currentUser}' ))",
            "WHERE SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE'",
            'ORDER BY CREATION_TIMESTAMP'
        ].join(' '),
        group: 'SPOOLED Files',
        order: 20,
        source: 'built-in'
    }
];

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
    private cmdEntryHelpPanel: vscode.WebviewPanel | undefined;
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
                this.output.appendLine(`[Cmd Entry] ${this.sqlFetchLimitDisplay()}`);
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
        await this.service.closeSqlSession();
        setSqlResultPanelRequestHandler(undefined);
        this.cmdEntryHelpPanel?.dispose();
        this.cmdEntryHelpPanel = undefined;
        this.onDidChangeCodeSnippetsEmitter.dispose();
        await this.jobManager.dispose();
        this.output.dispose();
    }

    private async handleSqlResultPanelRequest(
        request:
            | { type: 'loadMore' | 'loadAll' | 'prefetch' | 'closeSession'; sessionId: string }
            | { type: 'rerunSql'; statement: string; resultTitle?: string }
    ) {
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
                await this.context.workspaceState.update('clprompter.commandEntryTouchedThisSession', true);
                if (this.getConnection()) {
                    await vscode.commands.executeCommand('clprompter.codeSnippet.restoreVisibilityFromSetting');
                }
                await this.applyDefaultSnippetMergeOnVersionUpdateIfNeeded();
                const skipStartupClearForVsCodeUpdate = this.clearHistoryOnFirstReady && await this.consumeSkipHistoryClearOnNextReady();
                const clearHistoryOnStartup = this.clearHistoryOnFirstReady
                    && this.clearHistoryOnStartupEnabled()
                    && !skipStartupClearForVsCodeUpdate;
                if (clearHistoryOnStartup) {
                    await this.setHistory([]);
                }
                this.lastPostedSqlJobId = this.currentSqlJobId();
                this.post({
                    type: 'initialize',
                    connectionScopeKey: this.buildHistoryConnectionKey(),
                    history: clearHistoryOnStartup ? [] : this.history(),
                    running: this.running,
                    sqlJobId: this.lastPostedSqlJobId,
                    dedicatedJobEnabled: this.jobManager.isDedicatedUsable(this.getConnection()),
                    remoteMapepireEnabled: this.jobManager.isRemoteMapepireServerEnabled(this.getConnection()),
                    useSharedSqlJob: !this.jobManager.isDedicatedEnabled(this.getConnection()),
                    canStartNewJob: this.jobManager.isDedicatedUsable(this.getConnection()),
                    canCancelSqlJob: this.jobManager.isDedicatedUsable(this.getConnection()),
                    messageDetailsMode: this.messageDetailsMode(),
                    logSqlStatementsToCommandLog: this.logSqlStatementsToCommandLogEnabled(),
                    commandTextColor: this.commandEntryCommandTextColor(),
                    sqlStatementColor: this.commandEntrySqlStatementColor(),
                    clearInputOnStartup: this.clearInputOnFirstReady,
                    clearHistoryOnStartup
                });
                this.clearInputOnFirstReady = false;
                this.clearHistoryOnFirstReady = false;

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
                break;
            case 'clear':
                this.post({ type: 'clearResults' });
                break;
            case 'clearHistoryAndMessages':
                await this.clearHistoryAndMessagesWithConfirmation();
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
            case 'toggleSnippetsTreeView':
                await vscode.commands.executeCommand('clprompter.toggleCodeSnippetsTreeView');
                break;
            case 'manageCodeSnippets':
                await vscode.commands.executeCommand('clprompter.manageCodeSnippets');
                break;
            case 'addCodeSnippet':
                await vscode.commands.executeCommand('clprompter.manageCodeSnippets');
                await vscode.commands.executeCommand('clprompter.codeSnippet.add');
                break;
            case 'refreshCodeSnippets':
                await vscode.commands.executeCommand('clprompter.codeSnippet.refresh');
                break;
            case 'importCodeSnippets':
                await this.importCodeSnippetsFromJson();
                break;
            case 'exportCodeSnippets':
                await this.exportCodeSnippetsToJson();
                break;
            case 'openCmdEntryHelp':
                await this.openCmdEntryHelpPanel();
                break;
            case 'openCmdEntrySettings':
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
                this.output.appendLine(`[Cmd Entry][MenuDebug] ${message.phase}${payloadText}`);
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
            this.output.appendLine(`[Cmd Entry] SQL job mode switch => useSharedJob=${useSharedJob} resolvedSqlJobId=${displaySqlJobId || '<none>'} currentSqlJobId=${this.currentSqlJobId(connection) || '<none>'}`);
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
            this.output.appendLine(`[Cmd Entry] Failed to switch SQL job mode: ${message}`);
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
            this.output.appendLine(`[Cmd Entry] Deferred SQL job mode apply (${reason}) because a command is still running.`);
            return;
        }

        try {
            await this.service.closeSqlSession();
            await this.jobManager.ensureDedicatedJob(connection);
        } catch (error) {
            this.output.appendLine(`[Cmd Entry] Failed to apply SQL job mode from connection settings (${reason}): ${error instanceof Error ? error.message : String(error)}`);
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
            this.output.appendLine(`[Cmd Entry] Display Joblog failed for ${qualifiedJob}: ${execution.failure}`);
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
            vscode.l10n.t('Clear SQL History entries and associated SQL messages?'),
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
                ? vscode.l10n.t('Cleared {count} SQL history entries and SQL log messages.', { count: sqlCount })
                : vscode.l10n.t('No SQL history entries were found. SQL log messages were cleared.')
        });
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
            this.output.appendLine(`[Cmd Entry] Prompt failed: ${String(error)}`);
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
        const shouldAddToHistory = options.logToHistory ?? this.shouldAddToHistory(sourceType, isSql);
        const shouldAddToCommandEntryLog = options.logToCommandEntryLog ?? this.shouldAddToCommandEntryLog(sourceType, isSql);
        const commandForRecall = ensureSqlPrefixForRecall(command, isSql);

        await this.service.closeSqlSession();
        if (!isSql) {
            notifySqlResultSessionClosed('SQL result session is no longer available. Run the SQL statement again.');
        }

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({
                type: 'execution',
                execution: this.failed(command, mode, 'Not connected to IBM i, or the Code for IBM i SQL runner is unavailable.'),
                addToHistory: shouldAddToHistory,
                addToCommandEntryLog: shouldAddToCommandEntryLog
            });
            return;
        }

        const selectCommand = /^([^\s]*)\*/.exec(command);
        if (selectCommand !== null) {
            this.post({ type: 'notice', message: vscode.l10n.t("Selecting command...") });
            const [name, library] = connection.upperCaseName(selectCommand[1]).split('/').reverse();

            if (name.length > 10) {
                this.post({ type: 'notice', message: vscode.l10n.t("{0} is not a valid command name", name) });
            }

            const libraries = library ? [library] : [connection.getConfig().currentLibrary ?? '', ...connection.getConfig().libraryList, '*LIBL'].filter(Boolean);
            const query = [...libraries].map(lib => `select OBJLIB, OBJNAME, OBJTEXT from table(QSYS2.OBJECT_STATISTICS('${lib}', 'CMD', '${name}*'))`).join(' union all ') + ' order by OBJLIB, OBJNAME';
            const suggestions = (await connection.runSQL(query)).map(row => ({ library: String(row.OBJLIB), name: String(row.OBJNAME), text: row.OBJTEXT !== null ? String(row.OBJTEXT) : undefined }));

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

        try {
            const execution = await this.service.execute(connection, command, mode, this.activeExecutionId, {
                resultTitle: options.resultTitle
            });
            const executionForPost = isSql
                ? { ...execution, command: ensureSqlPrefixForRecall(execution.command, true) }
                : execution;
            if (shouldAddToHistory) {
                this.remember({ command: commandForRecall, mode, isSql });
            }
            if (execution.failure) { this.output.appendLine(`[Cmd Entry] CMD_RUN failed: ${execution.failure}`); }
            if (executionForPost.sqlResult) {
                showSqlResultPanel(executionForPost.sqlResult);
            }
            this.post({
                type: 'execution',
                execution: executionForPost,
                addToHistory: shouldAddToHistory,
                addToCommandEntryLog: shouldAddToCommandEntryLog
            });
            if (isSql && !shouldAddToCommandEntryLog) {
                this.post({ type: 'notice', message: vscode.l10n.t('SQL execution was run, but logging to Command Entry Log is disabled by settings.') });
            }
        } finally {
            this.running = false;
            this.activeExecutionId = undefined;
            const latestSqlJobId = this.currentSqlJobId(connection);
            this.lastPostedSqlJobId = latestSqlJobId;
            this.post({ type: 'running', running: false, sqlJobId: latestSqlJobId });
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
            this.post({ type: 'notice', message: sqlJobId ? vscode.l10n.t('Reconnected private SQL job {jobId}.', { jobId: sqlJobId }) : vscode.l10n.t('Reconnected private SQL job.') });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[Cmd Entry] Reconnect Server Job failed: ${message}`);
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
            this.output.appendLine(`[Cmd Entry] Manual cancel requested for private SQL job ${sqlJobId}.`);
            this.post({ type: 'notice', message: vscode.l10n.t('Cancel SQL requested for job {jobId}. IBM i may ignore this when no interruptible SQL is active.', { jobId: sqlJobId }) });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[Cmd Entry] Manual cancel request failed: ${message}`);
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
            this.output.appendLine(`[CLPROMPTER][Snippet] Failed id=${snippetId}: ${message}`);
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

    private postJobCapabilities(): void {
        const connection = this.getConnection();
        const dedicatedJobEnabled = this.jobManager.isDedicatedUsable(connection);
        const remoteMapepireEnabled = this.jobManager.isRemoteMapepireServerEnabled(connection);
        const dedicatedReady = dedicatedJobEnabled;
        const useSharedSqlJob = !this.jobManager.isDedicatedEnabled(connection);
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
            return `SQL rows: *NOMAX (fetch all on run)`;
        }

        const configuredRows = config.get<number | undefined>('cmdEntrySqlFetchRowLimit')
            ?? config.get<number | undefined>('cmdEntrySqlFetchLimitRows')
            ?? config.get<number>('commandEntrySqlFetchLimitRows', 1000);
        const chunkRows = Number.isInteger(configuredRows) && configuredRows > 0 ? configuredRows : 1000;
        const effectivePrefetchRows = Math.min(chunkRows, safePrefetchRows);
        return `SQL rows: rows/fetch ${chunkRows}, prefetch ${effectivePrefetchRows}`;
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

        // Create the dedicated job automatically
        try {
            this.output.appendLine(`[Cmd Entry] Auto-initializing private SQL job on panel startup...`);
            const sqlJobId = await this.jobManager.restartJob(connection);
            this.refreshSqlJobId(connection);
            if (sqlJobId) {
                this.output.appendLine(`[Cmd Entry] Auto-initialized private SQL job: ${sqlJobId}`);
            }
        } catch (error) {
            this.refreshSqlJobId(connection);
            this.output.appendLine(`[Cmd Entry] Auto-initialization failed: ${error instanceof Error ? error.message : String(error)}`);
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
            this.output.appendLine(`[Cmd Entry] SQL job display ID changed: ${this.lastPostedSqlJobId || '<none>'} -> ${sqlJobId || '<none>'}`);
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
        const config = vscode.workspace.getConfiguration('clPrompter');

        if (sourceType === 'snippet') {
            return config.get<boolean>('cmdEntryRecordSnippetsToLog', false);
        }
        if (isSql) {
            return config.get<boolean>('cmdEntryRecordSqlStmtsToLog', false);
        }
        return true;
    }

    private remember(entry: CommandEntryHistory): void {
        const history = this.history().filter(item => item.command !== entry.command || item.mode !== entry.mode);
        void this.setHistory([entry, ...history]);
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
            this.output.appendLine(`[Cmd Entry] Failed to load cmdEntry help template: ${error instanceof Error ? error.message : String(error)}`);
            return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${CMD_ENTRY_HELP_PANEL_TITLE}</title></head><body><h1>${CMD_ENTRY_HELP_PANEL_TITLE}</h1><p>Unable to load help content.</p></body></html>`;
        }
    }

    private post(message: unknown): void { void this.view?.webview.postMessage(message); }

    private html(webview: vscode.Webview): string {
        const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commandEntry.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'commandEntry.css'));
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
                        <label class="sr-only" for="command">CL command</label>
                        <div class="command-input-wrap">
                            <textarea id="command" spellcheck="false" placeholder="Enter a CL command" aria-label="CL command" rows="2"></textarea>
                            <button id="clear-command" type="button" aria-label="Clear command input" title="Clear command input">×</button>
                        </div>
                        <button id="run" type="button" aria-label="Run command" data-tooltip="Run command">Run</button>
                        <button id="prompt" type="button" aria-label="Prompt command" data-tooltip="Prompt command">Prompt</button>
                        <label class="mode-label" for="message-severity-filter" title="Minimum Severity Filter">SEV</label>
                        <select id="message-severity-filter" aria-label="Minimum message severity to display" title="Minimum Severity Filter">
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
                        <div class="toolbar-menu-wrap">
                            <button id="toolbar-menu" type="button" aria-label="Open command menu" data-tooltip="Command menu" aria-haspopup="menu" aria-expanded="false">…</button>
                            <div id="toolbar-menu-list" class="toolbar-menu-list" role="menu" aria-hidden="true">
                                <button id="menu-toggle-message-details" type="button" role="menuitem">Collapse Log Messages</button>
                                <button id="menu-view-log" type="button" role="menuitem">View CL History</button>
                                <button id="menu-clear-history" type="button" role="menuitem">Clear CL Cmd History</button>
                                <button id="menu-clear-sql-log" type="button" role="menuitem">Clear SQL Stmt History</button>
                                <button id="menu-toggle-sql-log" type="button" role="menuitem">Log SQL Statements</button>
                                <button id="menu-clear-log" type="button" role="menuitem">Clear Log Messages</button>
                                <button id="menu-use-shared-sql-job" type="button" role="menuitem">Use Shared SQL Job</button>
                                <button id="menu-use-private-sql-job" type="button" role="menuitem">Use Private SQL Job</button>
                                <button id="menu-start-new-job" type="button" role="menuitem">Reconnect Server Job</button>
                                <button id="menu-cancel-sql-job" type="button" role="menuitem">Cancel Last SQL stmt</button>
                            </div>
                        </div>
                        <button id="history-next" type="button" aria-label="Recall next command (F8)" data-tooltip="F8=Retrieve Next CL Cmd">↓</button>
                        <button id="history-prev" type="button" aria-label="Recall prior command (F9)" data-tooltip="F9=Retrieve Prior CL Cmd">↑</button>
                        <select id="mode" aria-label="Run mode" title="Run CL Command">
                            <option value="*RUN" title="Run CL Command">Run</option>
                            <option value="*LIMIT" title="Run as Limited USRPRF">Limit</option>
                            <option value="*CHECK" title="Syntax Check Only">Check</option>
                        </select>
                        <div class="toolbar-menu-wrap">
                            <button id="snippets" type="button" aria-label="Toggle code snippets tree view" data-tooltip="Toggle Code Snippets Tree View" aria-haspopup="menu" aria-expanded="false">{ }</button>
                            <div id="snippets-menu-list" class="toolbar-menu-list" role="menu" aria-hidden="true">
                                <button id="snippets-menu-toggle" type="button" role="menuitem">Toggle Code Snippets Tree View</button>
                                <button id="snippets-menu-refresh" type="button" role="menuitem">Refresh Code Snippets</button>
                                <button id="snippets-menu-import" type="button" role="menuitem">Import Code Snippets...</button>
                                <button id="snippets-menu-export" type="button" role="menuitem">Export Code Snippets...</button>
                                <button id="snippets-menu-add" type="button" role="menuitem">Add more...</button>
                            </div>
                        </div>
                        <button id="cmdentry-help" type="button" aria-label="Open Command Entry help" data-tooltip="Help">?</button>
                        <button id="cmdentry-settings" type="button" aria-label="Open Command Entry settings" data-tooltip="Cmd Entry Settings">⚙</button>
                    </div>
                    <div id="status" role="status" aria-live="polite">
                        <span id="status-text"></span>
                        <span id="status-jobid" aria-label="SQL job ID" title="Click=Copy, Double-Click=Display Joblog" tabindex="0" hidden></span>
                        <div id="status-job-menu" class="toolbar-menu-list" role="menu" aria-hidden="true">
                            <button id="status-job-menu-copy" type="button" role="menuitem">Copy job name</button>
                            <button id="status-job-menu-display-joblog" type="button" role="menuitem">Display Joblog</button>
                        </div>
                    </div>
                    <section id="results" aria-label="Command results"></section>
                </main>
            </body>`;

        const scripts = `
            <script nonce="${nonce}">const vscode = acquireVsCodeApi();</script>
            <script nonce="${nonce}" src="${script}"></script>`;

        return `<!DOCTYPE html>
            <html lang="en">
                ${head}
                ${body}
                ${scripts}
            </html>`;
    }
}
