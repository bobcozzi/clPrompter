import * as vscode from 'vscode';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { CLPrompter } from './clPrompter';
import { CommandEntryHistory, CommandExecutionMode } from './commandEntryModel';
import { CommandEntryService } from './commandEntryService';
import { CommandEntryJobManager } from './commandEntryJobManager';
import { configureSqlResultPanelAssets, notifySqlResultSessionClosed, setSqlResultPanelRequestHandler, showSqlResultPanel } from './sqlResultPanel';

const HISTORY_KEY = 'commandEntry.history';
const MAX_HISTORY = 100;
const SQL_SNIPPETS_USER_KEY = 'commandEntry.sqlSnippets.user';
const SQL_SNIPPETS_ORDER_KEY = 'commandEntry.sqlSnippets.order';
const SQL_SNIPPETS_HIDDEN_BUILTINS_KEY = 'commandEntry.sqlSnippets.hiddenBuiltins';
const SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY = 'commandEntry.sqlSnippets.defaultsMergedVersion';
const SQL_SNIPPETS_MAX = 200;
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
    | { type: 'openSnippetsMenu' }
    | { type: 'openSqlSnippetsMenu' }
    | { type: 'menuDebug'; phase: string; payload?: unknown }
    | { type: 'toggleMessageDetails' }
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
    source: 'built-in' | 'user';
    createdAt?: string;
    updatedAt?: string;
}

export interface CodeSnippetRecord {
    id: string;
    label: string;
    codeTemplate: string;
    group: string;
    source: 'built-in' | 'user';
}

interface CommandEntrySqlSnippetUser {
    id: string;
    label: string;
    stmt: string;
    group: string;
    createdAt: string;
    updatedAt: string;
}

type CodeSnippetImportMode = 'merge' | 'replace-all' | 'add-new-only';

interface SnippetTemplateContext {
    sqlJobId?: string;
    sqlJobName?: string;
    sqlJobNumber?: string;
    currentUser?: string;
    currentLibrary?: string;
}




const BUILT_IN_SQL_SNIPPETS: ReadonlyArray<CommandEntrySqlSnippet> = [
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
        source: 'built-in'
    },
    {
        id: 'builtin.lastest-joblog',
        label: 'Joblog: Last 200 msgs',
        stmt: [
            'SELECT ORDINAL_POSITION as SEQNBR,',
            "   TRIM(from_library) CONCAT '/' CONCAT TRIM(from_program) CONCAT '(' CONCAT TRIM(from_instruction) CONCAT ')'",
            '      AS "FROM_PGM(Stmt)",',
            "   TRIM(to_library) CONCAT '/' CONCAT TRIM(to_program) CONCAT '(' CONCAT TRIM(to_instruction) CONCAT ')'",
            '      AS "TO_PGM(Stmt)",',
            '       MESSAGE_ID as MSGID, SEVERITY as SEV, ',
            "       CASE UPPER(TRIM(MESSAGE_TYPE)) WHEN 'COMMAND' THEN '*CMD' WHEN 'COMPLETION' THEN '*COMP'",
            "       WHEN 'DIAGNOSTIC' THEN '*DIAG' WHEN 'ESCAPE' THEN '*ESCAPE' WHEN 'INFORMATIONAL' THEN '*INFO'",
            "       WHEN 'INQUIRY' THEN '*INQ' WHEN 'NOTIFY' THEN '*NOTIFY' WHEN 'REPLY' THEN '*RPY'",
            "       WHEN 'REQUEST' THEN '*RQS' WHEN 'SCOPE' THEN '*SCOPE' WHEN 'SENDER' THEN '*SENDER'",
            '       ELSE MESSAGE_TYPE END AS MSGTYPE,',
            '       MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT as MSG_SECOND_LVL,',
            '       QUALIFIED_JOB_NAME as JOB, MESSAGE_TIMESTAMP',
            "FROM TABLE(QSYS2.JOBLOG_INFO('${sqlJobId}'))",
            'ORDER BY ORDINAL_POSITION DESC FETCH FIRST 200 ROWS ONLY'
        ].join(' '),
        group: 'Job Info',
        source: 'built-in'
    },
    {
        id: 'builtin.full-joblog',
        label: 'Joblog: Full',
        stmt: [
            'SELECT ORDINAL_POSITION as SEQNBR,',
            "   TRIM(from_library) CONCAT '/' CONCAT TRIM(from_program) CONCAT '(' CONCAT TRIM(from_instruction) CONCAT ')'",
            '      AS "FROM_PGM(Stmt)",',
            "   TRIM(to_library) CONCAT '/' CONCAT TRIM(to_program) CONCAT '(' CONCAT TRIM(to_instruction) CONCAT ')'",
            '      AS "TO_PGM(Stmt)",',
            '       MESSAGE_ID as MSGID, SEVERITY as SEV, ',
            "       CASE UPPER(TRIM(MESSAGE_TYPE)) WHEN 'COMMAND' THEN '*CMD' WHEN 'COMPLETION' THEN '*COMP'",
            "       WHEN 'DIAGNOSTIC' THEN '*DIAG' WHEN 'ESCAPE' THEN '*ESCAPE' WHEN 'INFORMATIONAL' THEN '*INFO'",
            "       WHEN 'INQUIRY' THEN '*INQ' WHEN 'NOTIFY' THEN '*NOTIFY' WHEN 'REPLY' THEN '*RPY'",
            "       WHEN 'REQUEST' THEN '*RQS' WHEN 'SCOPE' THEN '*SCOPE' WHEN 'SENDER' THEN '*SENDER'",
            '       ELSE MESSAGE_TYPE END AS MSGTYPE,',
            '       MESSAGE_TEXT, MESSAGE_SECOND_LEVEL_TEXT as MSG_SECOND_LVL,',
            '       QUALIFIED_JOB_NAME as JOB, MESSAGE_TIMESTAMP',
            "FROM TABLE(QSYS2.JOBLOG_INFO('${sqlJobId}'))",
            'ORDER BY ORDINAL_POSITION DESC'
        ].join(' '),
        group: 'Job Info',
        source: 'built-in'
    },
    {
        id: 'builtin.library-list',
        label: 'Library List',
        stmt: "SELECT * FROM QSYS2.LIBRARY_LIST_INFO",
        group: 'Job Info',
        source: 'built-in'
    },
    {
        id: 'builtin.job-info-splf',
        label: 'SPOOLED Files (Job)',
        stmt: [
            'SELECT SPOOLED_FILE_NAME AS SPLFNAME, SPOOLED_FILE_NUMBER AS SPLNBR, STATUS,',
            '       QUALIFIED_JOB_NAME AS JOB, OUTPUT_PRIORITY AS OUTPTY, TOTAL_PAGES AS PAGES,',
            '       COPIES, CREATION_TIMESTAMP AS CREATED, USER_DATA, FILE_AVAILABLE AS FILE_AVAIL,',
            '       SIZE, FORM_TYPE, OUTPUT_QUEUE_LIBRARY AS OUTQ_LIB, OUTPUT_QUEUE AS OUTQ_NAME,',
            '       ASP_NUMBER, SYSTEM',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${sqlJobId}' ))",
            "WHERE SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE'",
            'ORDER BY CREATION_TIMESTAMP'
        ].join(' '),
        group: 'Job Info',
        source: 'built-in'
    },
    {
        id: 'builtin.current-library-objects',
        label: 'Active Jobs (Slow: All Info)',
        stmt: [
            'SELECT JOB_NAME, SUBSYSTEM, AUTHORIZATION_NAME as USER_NAME, FUNCTION_TYPE, "FUNCTION",',
            '       JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT,',
            '       OUTPUT_QUEUE, JOB_USER_IDENTITY, PAGE_FAULTS, DATABASE_LOCK_WAITS, OPEN_FILES',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'ALL'))",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-all',
        label: 'Active Jobs (Faster)',
        stmt: [
            'SELECT JOB_NAME, SUBSYSTEM, AUTHORIZATION_NAME as USER_NAME, FUNCTION_TYPE, "FUNCTION",',
            '       JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            'FROM TABLE(QSYS2.ACTIVE_JOB_INFO())',
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qinter',
        label: 'Active Jobs (QINTER)',
        stmt: [
            'SELECT JOB_NAME, SUBSYSTEM, AUTHORIZATION_NAME as USER_NAME, FUNCTION_TYPE, "FUNCTION",',
            '       JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QINTER'))",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        source: 'built-in'
    },
    {
        id: 'builtin.active-jobs-qinter',
        label: 'Active Jobs (QUSRWRK)',
        stmt: [
            'SELECT JOB_NAME, SUBSYSTEM, AUTHORIZATION_NAME as USER_NAME, FUNCTION_TYPE, "FUNCTION",',
            '       JOB_STATUS, MEMORY_POOL, TEMPORARY_STORAGE, CPU_TIME, TOTAL_DISK_IO_COUNT',
            "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(SUBSYSTEM_LIST_FILTER => 'QUSRWRK'))",
            'ORDER BY ORDINAL_POSITION'
        ].join(' '),
        group: 'Admin',
        source: 'built-in'
    },
    {
        id: 'builtin.spooled-files-job',
        label: 'SPOOLED Files (Job)',
        stmt: [
            'SELECT SPOOLED_FILE_NAME AS SPLFNAME, SPOOLED_FILE_NUMBER AS SPLNBR, STATUS,',
            '       QUALIFIED_JOB_NAME AS JOB, OUTPUT_PRIORITY AS OUTPTY, TOTAL_PAGES AS PAGES,',
            '       COPIES, CREATION_TIMESTAMP AS CREATED, USER_DATA, FILE_AVAILABLE AS FILE_AVAIL,',
            '       SIZE, FORM_TYPE, OUTPUT_QUEUE_LIBRARY AS OUTQ_LIB, OUTPUT_QUEUE AS OUTQ_NAME,',
            '       ASP_NUMBER, SYSTEM',
            "FROM TABLE(QSYS2.SPOOLED_FILE_INFO(JOB_NAME => '${sqlJobId}' ))",
            "WHERE SPOOLED_FILE_NAME <> 'QPRINT' AND JOB_NAME <> 'MAPEPIRE'",
            'ORDER BY CREATION_TIMESTAMP'
        ].join(' '),
        group: 'SPOOLED Files',
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
        source: 'built-in'
    }
];

function isSqlCommandText(command: string): boolean {
    const text = String(command ?? '');
    return /^\s*sql\s*:/i.test(text) || /^\s*(select|values|with)\b/i.test(text);
}

/** Persistent panel webview. It deliberately does not own an IBM i connection. */
export class CommandEntryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'clprompter.commandEntryView';
    private view: vscode.WebviewView | undefined;
    private running = false;
    private activeExecutionId: string | undefined;
    private pendingCommandText: string | undefined;
    private clearInputOnFirstReady = true;
    private clearHistoryOnFirstReady = true;
    private lastPostedSqlJobId: string | undefined;
    private snippetManagerPanel: vscode.WebviewPanel | undefined;
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
        this.jobManager = dependencies?.jobManager ?? new CommandEntryJobManager(this.output);
        this.service = dependencies?.service ?? new CommandEntryService(this.jobManager);
        configureSqlResultPanelAssets(this.context.extensionUri);

        setSqlResultPanelRequestHandler((request) => this.handleSqlResultPanelRequest(request));

        this.context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
            const sqlFetchConfigChanged = event.affectsConfiguration('clPrompter.commandEntrySqlFetchLimitEnabled')
                || event.affectsConfiguration('clPrompter.commandEntrySqlFetchLimitRows')
                || event.affectsConfiguration('clPrompter.commandEntrySqlPrefetchRows')
                || event.affectsConfiguration('clPrompter.commandEntrySqlFetchLimit');
            if (!sqlFetchConfigChanged
                && !event.affectsConfiguration('clPrompter.commandEntryUseDedicatedJob')
                && !event.affectsConfiguration('clPrompter.commandEntryMessageDetails')) {
                return;
            }

            if (sqlFetchConfigChanged) {
                this.output.appendLine(`[Command Entry] ${this.sqlFetchLimitDisplay()}`);
            }
            this.post({
                type: 'messageDetailsPreference',
                mode: this.messageDetailsMode()
            });
            this.postJobCapabilities();
        }));
    }

    resolveWebviewView(view: vscode.WebviewView): void {
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')] };
        view.webview.html = this.html(view.webview);
        view.webview.onDidReceiveMessage((message: CommandEntryRequest) => this.receive(message), undefined, this.context.subscriptions);
        view.onDidDispose(() => { if (this.view === view) { this.view = undefined; } }, undefined, this.context.subscriptions);
    }

    focus(): void {
        this.view?.show?.(true);
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
            source: snippet.source
        }));
    }
    async createCodeSnippet(label: string, codeTemplate: string, group = 'Admin'): Promise<void> {
        await this.addUserSqlSnippet(label, codeTemplate, group);
    }
    async updateCodeSnippet(id: string, label: string, codeTemplate: string, group?: string): Promise<void> {
        await this.updateUserSqlSnippet(id, label, codeTemplate, group);
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
    openAdvancedCodeSnippetEditor(): void {
        this.showSnippetManagerPanel();
    }
    requestExportCodeSnippets(): void {
        void this.exportCodeSnippetsToJson().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: `Export Code Snippets failed: ${message}` });
        });
    }
    requestImportCodeSnippets(): void {
        void this.importCodeSnippetsFromJson().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: `Import Code Snippets failed: ${message}` });
        });
    }
    clear(): void {
        void this.service.closeSqlSession();
        this.post({ type: 'clearResults' });
    }

    async dispose(): Promise<void> {
        await this.service.closeSqlSession();
        setSqlResultPanelRequestHandler(undefined);
        this.snippetManagerPanel?.dispose();
        this.snippetManagerPanel = undefined;
        this.onDidChangeCodeSnippetsEmitter.dispose();
        await this.jobManager.dispose();
        this.output.dispose();
    }

    private async handleSqlResultPanelRequest(request: { type: 'loadMore' | 'loadAll' | 'prefetch' | 'closeSession'; sessionId: string } | { type: 'rerunSql'; statement: string }) {
        if (request.type === 'rerunSql') {
            const statement = String(request.statement || '').trim();
            if (!statement) {
                throw new Error('No SQL statement was provided to rerun.');
            }

            const connection = this.getConnection();
            if (!connection || !connection.sqlRunnerAvailable()) {
                throw new Error('Not connected to IBM i, or the SQL runner is unavailable.');
            }

            const execution = await this.service.execute(connection, `SQL: ${statement}`, '*RUN');
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
                await vscode.commands.executeCommand('clprompter.codeSnippet.resolvePinnedVisibility');
                const clearHistoryOnStartup = this.clearHistoryOnFirstReady && this.clearHistoryOnStartupEnabled();
                if (clearHistoryOnStartup) {
                    await this.context.globalState.update(HISTORY_KEY, []);
                }
                this.lastPostedSqlJobId = this.currentSqlJobId();
                this.post({
                    type: 'initialize',
                    history: clearHistoryOnStartup ? [] : this.history(),
                    running: this.running,
                    sqlJobId: this.lastPostedSqlJobId,
                    dedicatedJobEnabled: this.jobManager.isDedicatedEnabled(),
                    remoteMapepireEnabled: this.jobManager.isRemoteMapepireServerEnabled(this.getConnection()),
                    canStartNewJob: this.jobManager.isDedicatedEnabled(),
                    canCancelSqlJob: this.jobManager.isDedicatedEnabled(),
                    messageDetailsMode: this.messageDetailsMode(),
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

                // Automatically initialize dedicated job if enabled and not already initialized
                this.initializeDedicatedJobIfNeeded();
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
            case 'menuDebug': {
                let payloadText = '';
                if (message.payload !== undefined) {
                    try {
                        payloadText = ` ${JSON.stringify(message.payload)}`;
                    } catch {
                        payloadText = ' <payload-unserializable>';
                    }
                }
                this.output.appendLine(`[Command Entry][MenuDebug] ${message.phase}${payloadText}`);
                break;
            }
            case 'toggleMessageDetails':
                await this.toggleMessageDetailsPreference();
                break;
            case 'startNewJob':
                await this.startNewJob();
                break;
            case 'run':
                await this.run(message.command, message.mode);
                break;
        }
    }

    private async copyCommandToClipboard(command: string): Promise<void> {
        const trimmed = command.trim();
        if (!trimmed) {
            this.post({ type: 'notice', message: 'Nothing to copy from this history entry.' });
            return;
        }
        await vscode.env.clipboard.writeText(command);
        this.post({ type: 'notice', message: 'Copied command to clipboard.' });
    }

    private async copySqlJobIdToClipboard(sqlJobId: string): Promise<void> {
        const trimmed = sqlJobId.trim();
        if (!trimmed) {
            this.post({ type: 'notice', message: 'No SQL job ID is available to copy.' });
            return;
        }
        await vscode.env.clipboard.writeText(trimmed);
        this.post({ type: 'notice', message: `Copied SQL job ID ${trimmed} to clipboard.` });
    }

    private async displayJoblogForSqlJob(sqlJobId: string): Promise<void> {
        const qualifiedJob = sqlJobId.trim();
        if (!qualifiedJob) {
            this.post({ type: 'notice', message: 'No SQL job ID is available.' });
            return;
        }

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'notice', message: 'Not connected to IBM i, or the SQL runner is unavailable.' });
            return;
        }

        if (this.running) {
            this.post({ type: 'notice', message: 'A command is currently running. Try Display Joblog again in a moment.' });
            return;
        }

        const escapedJob = qualifiedJob.replace(/'/g, "''");
        const sql = [
            'SELECT ORDINAL_POSITION,',
            '       FROM_PROGRAM,',
            '       FROM_INSTRUCTION,',
            '       TO_PROGRAM,',
            '       TO_INSTRUCTION,',
            '       MESSAGE_ID,',
            '       SEVERITY,',
            '       CASE UPPER(TRIM(MESSAGE_TYPE))',
            "         WHEN 'COMMAND' THEN '*CMD'",
            "         WHEN 'COMPLETION' THEN '*COMP'",
            "         WHEN 'DIAGNOSTIC' THEN '*DIAG'",
            "         WHEN 'ESCAPE' THEN '*ESCAPE'",
            "         WHEN 'INFORMATIONAL' THEN '*INFO'",
            "         WHEN 'INQUIRY' THEN '*INQ'",
            "         WHEN 'NOTIFY' THEN '*NOTIFY'",
            "         WHEN 'REPLY' THEN '*RPY'",
            "         WHEN 'REQUEST' THEN '*RQS'",
            "         WHEN 'SCOPE' THEN '*SCOPE'",
            "         WHEN 'SENDER' THEN '*SENDER'",
            '         ELSE MESSAGE_TYPE',
            '       END AS MESSAGE_TYPE,',
            '       MESSAGE_TEXT,',
            '       MESSAGE_SECOND_LEVEL_TEXT,',
            '       QUALIFIED_JOB_NAME as JOB,',
            '       MESSAGE_TIMESTAMP',
            '  FROM TABLE (',
            `      QSYS2.JOBLOG_INFO('${escapedJob}')`,
            '    )',
            '  ORDER BY ORDINAL_POSITION DESC',
            '  FETCH FIRST 200 ROWS ONLY'
        ].join('\n');

        const command = `SQL: ${sql}`;
        const execution = await this.service.execute(connection, command, '*RUN');
        if (execution.failure) {
            this.output.appendLine(`[Command Entry] Display Joblog failed for ${qualifiedJob}: ${execution.failure}`);
            this.post({ type: 'notice', message: `Display Joblog failed: ${execution.failure}` });
            return;
        }

        if (execution.sqlResult) {
            showSqlResultPanel(execution.sqlResult);
        }
        this.post({ type: 'notice', message: `Displayed joblog for ${qualifiedJob}.` });
    }

    private async showHistoryPicker(): Promise<void> {
        const history = this.history();
        if (history.length === 0) {
            this.post({ type: 'notice', message: 'No command history is available yet.' });
            return;
        }

        const items = history.map((entry, index) => ({
            label: entry.command,
            description: entry.mode,
            picked: index === 0,
            entry
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a CL command from history',
            matchOnDescription: true,
            ignoreFocusOut: false
        });

        if (!selected) { return; }

        this.post({ type: 'setCommandMode', command: selected.entry.command, mode: selected.entry.mode });
        this.post({ type: 'focusInput' });
    }

    private async clearHistoryAndMessagesWithConfirmation(): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            'Clear all CL command history and associated messages?',
            {
                modal: true,
                detail: 'This action cannot be undone.'
            },
            'Yes',
            'No'
        );

        if (choice !== 'Yes') {
            return;
        }

        await this.context.globalState.update(HISTORY_KEY, []);
        this.post({ type: 'clearResults' });
        this.post({ type: 'historyUpdated', history: [] });
        this.post({ type: 'notice', message: 'CL command history and messages cleared.' });
    }

    private async clearSqlHistoryAndMessagesWithConfirmation(): Promise<void> {
        const history = this.history();
        const sqlHistory = history.filter(entry => isSqlCommandText(entry.command));
        const sqlCount = sqlHistory.length;

        const choice = await vscode.window.showWarningMessage(
            'Clear SQL history log entries and associated SQL messages?',
            {
                modal: true,
                detail: 'Only SQL-tagged entries are removed. CL command history and CL messages remain intact.'
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
        await this.context.globalState.update(HISTORY_KEY, keptHistory);
        this.post({ type: 'clearSqlResults' });
        this.post({ type: 'historyUpdated', history: keptHistory });
        this.post({
            type: 'notice',
            message: sqlCount > 0
                ? `Cleared ${sqlCount} SQL history entr${sqlCount === 1 ? 'y' : 'ies'} and SQL log messages.`
                : 'No SQL history entries were found. SQL log messages were cleared.'
        });
    }

    private async prompt(command: string): Promise<void> {
        if (!command.trim()) { this.post({ type: 'notice', message: 'Enter a CL command to prompt.' }); return; }
        if (isSqlCommandText(command)) {
            this.post({ type: 'notice', message: 'Prompt is only available for CL commands. Run SQL statements directly.' });
            return;
        }
        try {
            const result = await CLPrompter(this.context.extensionUri, command);
            if (result && result !== command) { this.post({ type: 'setCommand', command: result }); }
        } catch (error) {
            this.output.appendLine(`[Command Entry] Prompt failed: ${String(error)}`);
            this.post({ type: 'notice', message: 'Unable to open the CL prompter. See CLPROMPTER Output for details.' });
        } finally {
            this.post({ type: 'focusInput' });
            // Webview focus can race panel disposal, so retry once.
            setTimeout(() => this.post({ type: 'focusInput' }), 50);
        }
    }

    private async run(
        command: string,
        mode: CommandExecutionMode,
        options: { sourceType?: 'user' | 'snippet'; logToHistory?: boolean; logToCommandEntryLog?: boolean } = {}
    ): Promise<void> {
        if (this.running) { return; }
        if (!command.trim()) { this.post({ type: 'notice', message: 'Enter a CL command to run.' }); return; }

        const sourceType = options.sourceType ?? 'user';
        const isSql = isSqlCommandText(command);
        const shouldAddToHistory = options.logToHistory ?? this.shouldAddToHistory(sourceType, isSql);
        const shouldAddToCommandEntryLog = options.logToCommandEntryLog ?? this.shouldAddToCommandEntryLog(sourceType, isSql);

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
        this.running = true;
        this.activeExecutionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sqlJobId = this.currentSqlJobId(connection);
        const dedicatedState = this.jobManager.getState(connection);
        const showDedicatedStartupMessage = this.jobManager.isDedicatedEnabled()
            && !this.jobManager.isRemoteMapepireServerEnabled(connection)
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
            const execution = await this.service.execute(connection, command, mode, this.activeExecutionId);
            if (shouldAddToHistory) {
                this.remember({ command, mode });
            }
            if (execution.failure) { this.output.appendLine(`[Command Entry] CMD_RUN failed: ${execution.failure}`); }
            if (execution.sqlResult) {
                showSqlResultPanel(execution.sqlResult);
            }
            this.post({
                type: 'execution',
                execution,
                addToHistory: shouldAddToHistory,
                addToCommandEntryLog: shouldAddToCommandEntryLog
            });
            if (isSql && !shouldAddToCommandEntryLog) {
                this.post({ type: 'notice', message: 'SQL execution was run, but logging to Command Entry Log is disabled by settings.' });
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
            this.post({ type: 'notice', message: 'Not connected to IBM i, or the SQL runner is unavailable.' });
            return;
        }

        if (!this.jobManager.isDedicatedEnabled()) {
            this.post({ type: 'notice', message: 'Dedicated SQL job mode is disabled. Enable clPrompter.commandEntryUseDedicatedJob to use Reconnect Server Job.' });
            return;
        }

        try {
            const sqlJobId = await this.jobManager.restartJob(connection);
            this.refreshSqlJobId(connection);
            this.postJobCapabilities();
            this.post({ type: 'notice', message: sqlJobId ? `Reconnected dedicated SQL job ${sqlJobId}.` : 'Reconnected dedicated SQL job.' });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[Command Entry] Reconnect Server Job failed: ${message}`);
            this.post({ type: 'notice', message: `Reconnect Server Job failed: ${message}` });
        }
    }

    private async requestCancelSqlJob(): Promise<void> {
        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'notice', message: 'Not connected to IBM i, or the SQL runner is unavailable.' });
            return;
        }

        if (!this.jobManager.isDedicatedEnabled()) {
            this.post({ type: 'notice', message: 'Cancel SQL Job is only available in dedicated SQL job mode.' });
            this.postJobCapabilities();
            return;
        }

        const sqlJobId = this.currentSqlJobId(connection);
        if (!sqlJobId) {
            this.post({ type: 'notice', message: 'No dedicated SQL job ID is available to cancel.' });
            this.postJobCapabilities();
            return;
        }

        try {
            await this.jobManager.cancelActive(connection);
            this.output.appendLine(`[Command Entry] Manual cancel requested for dedicated SQL job ${sqlJobId}.`);
            this.post({ type: 'notice', message: `Cancel SQL requested for job ${sqlJobId}. IBM i may ignore this when no interruptible SQL is active.` });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[Command Entry] Manual cancel request failed: ${message}`);
            this.post({ type: 'notice', message: `Cancel SQL request failed: ${message}` });
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
                description: snippet.source === 'user' ? 'User' : undefined,
                detail: `${snippet.group}${snippet.source === 'user' ? ' · User' : ''}`,
                snippetId: snippet.id
            })),
            { label: '$(add) Add more...', action: 'add', description: 'Create a new Code Snippet' },
            { label: '$(list-tree) Toggle Code Snippets in Tree View', action: 'toggleTreeView', description: 'Show or hide the Code Snippets tree view' },
            { label: '$(arrow-down) Import Code Snippets...', action: 'import', description: 'Load Code Snippets from a JSON file' },
            { label: '$(arrow-up) Export Code Snippets...', action: 'export', description: 'Save user Code Snippets to a JSON file' },
            { label: '$(refresh) Refresh default snippets', action: 'refreshDefaults', description: 'Restore shipped defaults and pick up latest built-in snippets' }
        ];

        const selected = await vscode.window.showQuickPick(pickerItems, {
            placeHolder: 'Select a Code Snippet to run',
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
            if (!id || !label || !stmt) {
                continue;
            }
            snippets.push({
                id,
                label,
                stmt,
                group,
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

        this.post({ type: 'notice', message: `Code Snippet defaults merged for CLPROMPTER ${currentVersion}.` });
    }

    private async refreshDefaultSnippets(): Promise<void> {
        const builtInIds = new Set(BUILT_IN_SQL_SNIPPETS.map((snippet) => snippet.id));
        const hidden = this.getHiddenBuiltInSnippetIds();
        const hiddenCount = hidden.size;

        if (hiddenCount > 0) {
            await this.setHiddenBuiltInSnippetIds(new Set<string>());
        }

        const userSnippets = this.getUserSqlSnippets();
        const keptUserSnippets = userSnippets.filter((snippet) => !builtInIds.has(snippet.id));
        const removedOverrides = userSnippets.length - keptUserSnippets.length;
        if (removedOverrides > 0) {
            await this.setUserSqlSnippets(keptUserSnippets);
        }

        const existingOrder = this.getSqlSnippetOrder().filter((id) => !builtInIds.has(id));
        const refreshedOrder = [...BUILT_IN_SQL_SNIPPETS.map((snippet) => snippet.id), ...existingOrder];
        await this.setSqlSnippetOrder(refreshedOrder);

        const currentVersion = this.currentExtensionVersion();
        if (currentVersion) {
            await this.context.globalState.update(SQL_SNIPPETS_DEFAULTS_MERGED_VERSION_KEY, currentVersion);
        }

        this.notifyCodeSnippetsChanged();
        this.post({
            type: 'notice',
            message: `Default Code Snippets refreshed. Restored: ${hiddenCount}, Removed custom starter overrides: ${removedOverrides}.`
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
            source: 'user',
            createdAt: snippet.createdAt,
            updatedAt: snippet.updatedAt
        }));

        const all = [...builtInSnippets, ...userSnippets];
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
        ordered.push(...byId.values());
        return ordered;
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

    private normalizeImportedSnippets(raw: unknown): Array<{ label: string; stmt: string; group: string }> {
        const sourceArray = Array.isArray(raw)
            ? raw
            : (raw && typeof raw === 'object' && Array.isArray((raw as any).snippets) ? (raw as any).snippets : []);

        const normalized: Array<{ label: string; stmt: string; group: string }> = [];
        const seenLabels = new Set<string>();
        for (const item of sourceArray) {
            if (!item || typeof item !== 'object') {
                continue;
            }

            const record = item as Record<string, unknown> & { sqlTemplate?: string; stmt?: string };
            const label = String(record.label ?? record.name ?? '').trim();
            const stmt = String(record.stmt ?? record.sqlTemplate ?? record.codeTemplate ?? record.snippetText ?? record.text ?? record.command ?? '').trim();
            const group = String(record.group ?? record.category ?? 'Admin').trim() || 'Admin';
            if (!this.isValidSnippetLabel(label) || !stmt) {
                continue;
            }

            const key = label.toUpperCase();
            if (seenLabels.has(key)) {
                continue;
            }
            seenLabels.add(key);
            normalized.push({ label, stmt, group });
        }

        return normalized.slice(0, SQL_SNIPPETS_MAX);
    }

    private postCodeSnippetsUpdated(selectedId?: string): void {
        this.notifyCodeSnippetsChanged();
        if (!this.snippetManagerPanel) {
            return;
        }
        this.snippetManagerPanel.webview.postMessage({
            type: 'snippetsData',
            snippets: this.getMergedSqlSnippets(),
            selectedId
        });
    }

    private async exportCodeSnippetsToJson(): Promise<void> {
        try {
            const userSnippets = this.getUserSqlSnippets();
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
            const saveUri = await vscode.window.showSaveDialog({
                title: 'Export Code Snippets',
                saveLabel: 'Export Code Snippets',
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
                    createdAt: snippet.createdAt,
                    updatedAt: snippet.updatedAt
                }))
            };

            const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2));
            await vscode.workspace.fs.writeFile(saveUri, bytes);
            this.post({ type: 'notice', message: `Exported ${userSnippets.length} Code Snippet(s) to ${saveUri.fsPath}.` });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: `Export Code Snippets failed: ${message}` });
        }
    }

    private async promptCodeSnippetImportMode(): Promise<CodeSnippetImportMode | undefined> {
        const choice = await vscode.window.showQuickPick([
            { label: 'Merge', mode: 'merge' as const, description: 'Add new and update existing Code Snippets by name' },
            { label: 'Replace All', mode: 'replace-all' as const, description: 'Replace all user Code Snippets with imported Code Snippets' },
            { label: 'Add New Only', mode: 'add-new-only' as const, description: 'Import only Code Snippets that do not already exist by name' }
        ], {
            title: 'Import Code Snippets',
            placeHolder: 'Choose how to apply imported Code Snippets',
            ignoreFocusOut: true
        });
        return choice?.mode;
    }

    private async importCodeSnippetsFromJson(): Promise<void> {
        try {
            const openUris = await vscode.window.showOpenDialog({
                title: 'Import Code Snippets',
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                openLabel: 'Import Code Snippets',
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
                this.post({ type: 'notice', message: 'Import failed: selected file is not valid JSON.' });
                return;
            }

            const imported = this.normalizeImportedSnippets(parsed);
            if (imported.length === 0) {
                this.post({ type: 'notice', message: 'Import failed: no valid Code Snippets were found in the JSON file.' });
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
                message: `Imported Code Snippets from ${sourceUri.fsPath}. Added: ${created}, Updated: ${updated}, Skipped: ${skipped}.`
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.post({ type: 'notice', message: `Import Code Snippets failed: ${message}` });
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
        return {
            sqlJobId: parts.sqlJobId,
            sqlJobName: parts.sqlJobName,
            sqlJobNumber: parts.sqlJobNumber,
            currentUser: connection?.currentUser,
            currentLibrary: typeof config?.currentLibrary === 'string' ? config.currentLibrary : undefined
        };
    }

    private resolveSqlTemplate(template: string, context: SnippetTemplateContext): { resolved: string; missing: string[] } {
        const tokenValues: Record<string, string | undefined> = {
            sqlJobId: context.sqlJobId,
            sqlJobName: context.sqlJobName,
            sqlJobNumber: context.sqlJobNumber,
            currentUser: context.currentUser,
            currentLibrary: context.currentLibrary
        };

        const missing = new Set<string>();
        const resolved = template.replace(/\$\{([A-Za-z0-9_]+)\}/g, (_all, tokenName: string) => {
            const key = String(tokenName || '').trim();
            if (!(key in tokenValues)) {
                return `\${${key}}`;
            }
            const value = tokenValues[key];
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
                this.post({ type: 'notice', message: 'The selected snippet is no longer available.' });
                return;
            }

            const connection = this.getConnection();
            if (!connection) {
                this.post({ type: 'notice', message: 'Not connected to IBM i.' });
                return;
            }

            const resolution = this.resolveSnippetTemplateText(snippet.stmt);
            if (resolution.missing.length > 0) {
                this.post({
                    type: 'notice',
                    message: `Snippet '${snippet.label}' requires unavailable value(s): ${resolution.missing.map((name) => `\${${name}}`).join(', ')}`
                });
                return;
            }

            const sqlLike = isSqlCommandText(resolution.resolved);

            await this.run(resolution.resolved, '*RUN', {
                sourceType: 'snippet',
                logToHistory: this.shouldAddToHistory('snippet', sqlLike),
                logToCommandEntryLog: this.shouldAddToCommandEntryLog('snippet', sqlLike)
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[CLPROMPTER][Snippet] Failed id=${snippetId}: ${message}`);
            this.post({ type: 'notice', message: `Code Snippet failed: ${message}` });
        }
    }

    private async addUserSqlSnippet(label: string, stmt: string, group = 'Admin'): Promise<void> {
        const trimmedLabel = label.trim();
        const trimmedStmt = stmt.trim();
        const trimmedGroup = group.trim() || 'Admin';
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
        userSnippets.push({ id, label: trimmedLabel, stmt: trimmedStmt, group: trimmedGroup, createdAt: now, updatedAt: now });
        await this.setUserSqlSnippets(userSnippets);

        const order = this.getSqlSnippetOrder();
        order.push(id);
        await this.setSqlSnippetOrder(order);
        this.notifyCodeSnippetsChanged();
    }

    private async updateUserSqlSnippet(id: string, label: string, stmt: string, group?: string): Promise<void> {
        const trimmedLabel = label.trim();
        const trimmedStmt = stmt.trim();
        const trimmedGroup = group?.trim();
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

    private showSnippetManagerPanel(options?: { createNew?: boolean }): void {
        if (this.snippetManagerPanel) {
            this.snippetManagerPanel.reveal(vscode.ViewColumn.Active);
            this.snippetManagerPanel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets(), createNew: !!options?.createNew });
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'clprompter.sqlSnippetManager',
            'CLPROMPTER Code Snippets',
            vscode.ViewColumn.Active,
            { enableScripts: true }
        );
        this.snippetManagerPanel = panel;

        panel.onDidDispose(() => {
            if (this.snippetManagerPanel === panel) {
                this.snippetManagerPanel = undefined;
            }
        });

        panel.webview.onDidReceiveMessage(async (message: any) => {
            try {
                switch (message?.type) {
                    case 'ready':
                        panel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets(), createNew: !!options?.createNew });
                        break;
                    case 'create':
                        await this.addUserSqlSnippet(String(message.label || ''), String(message.stmt ?? message.sqlTemplate ?? ''));
                        panel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets() });
                        this.post({ type: 'notice', message: 'Code Snippet created.' });
                        break;
                    case 'update':
                        await this.updateUserSqlSnippet(String(message.id || ''), String(message.label || ''), String(message.stmt ?? message.sqlTemplate ?? ''));
                        panel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets(), selectedId: String(message.id || '') });
                        this.post({ type: 'notice', message: 'Code Snippet updated.' });
                        break;
                    case 'delete':
                        await this.deleteSqlSnippet(String(message.id || ''));
                        panel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets() });
                        this.post({ type: 'notice', message: 'Code Snippet deleted.' });
                        break;
                    case 'moveUp':
                        await this.moveSnippet(String(message.id || ''), 'up');
                        panel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets(), selectedId: String(message.id || '') });
                        break;
                    case 'moveDown':
                        await this.moveSnippet(String(message.id || ''), 'down');
                        panel.webview.postMessage({ type: 'snippetsData', snippets: this.getMergedSqlSnippets(), selectedId: String(message.id || '') });
                        break;
                    case 'run':
                        await this.executeSnippet(String(message.id || ''));
                        break;
                }
            } catch (error) {
                const messageText = error instanceof Error ? error.message : String(error);
                panel.webview.postMessage({ type: 'error', message: messageText });
            }
        });

        panel.webview.html = this.snippetManagerHtml(panel.webview);
    }

    private snippetManagerHtml(webview: vscode.Webview): string {
        const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <style>
        :root {
            --radius: 10px;
            --gap: 16px;
            --panel-border: var(--vscode-panel-border, var(--vscode-editorWidget-border));
            --panel-bg: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-input-background) 8%);
            --muted: var(--vscode-descriptionForeground);
            --chip-bg: color-mix(in srgb, var(--vscode-button-secondaryBackground, var(--vscode-input-background)) 88%, var(--vscode-foreground) 12%);
            --chip-border: color-mix(in srgb, var(--vscode-foreground) 16%, transparent);
            --accent: var(--vscode-focusBorder);
        }
        * { box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background:
                radial-gradient(1200px 420px at 10% -10%, color-mix(in srgb, var(--accent) 15%, transparent), transparent),
                var(--vscode-editor-background);
            margin: 0;
            padding: 18px;
        }
        h2 {
            margin: 0;
            font-size: 15px;
            line-height: 1.2;
            letter-spacing: .2px;
        }
        .subtle {
            margin-top: 4px;
            font-size: 11px;
            color: var(--muted);
        }
        .shell {
            border: 1px solid var(--panel-border);
            border-radius: 12px;
            padding: 16px;
            background: var(--panel-bg);
            backdrop-filter: blur(3px);
        }
        .layout {
            margin-top: 12px;
            display: grid;
            gap: var(--gap);
            grid-template-columns: minmax(260px, 1fr) minmax(420px, 2fr);
            align-items: start;
        }
        .panel {
            border: 1px solid var(--panel-border);
            border-radius: var(--radius);
            background: var(--vscode-editor-background);
            padding: 12px;
        }
        .panel-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--muted);
        }
        .count {
            border: 1px solid var(--chip-border);
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 10px;
            color: var(--muted);
            background: var(--chip-bg);
        }
        select,
        input,
        textarea,
        button {
            font: inherit;
            color: var(--vscode-input-foreground);
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border, transparent);
            border-radius: 8px;
        }
        input,
        textarea {
            width: 100%;
            padding: 8px;
            outline: none;
        }
        input:focus,
        textarea:focus,
        select:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px var(--accent);
        }
        .search-wrap {
            margin-bottom: 8px;
        }
        #snippet-search {
            font-size: 12px;
            min-height: 30px;
        }
        #snippet-list {
            width: 100%;
            min-height: 320px;
            padding: 4px;
            background: var(--vscode-sideBar-background, var(--vscode-editor-background));
        }
        .label {
            margin: 10px 0 6px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            font-size: 11px;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: .5px;
        }
        .kind-pill {
            border: 1px solid var(--chip-border);
            background: var(--chip-bg);
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 10px;
            text-transform: none;
            color: var(--vscode-foreground, var(--vscode-foreground));
            cursor: pointer;
            user-select: none;
            box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 25%, transparent);
            transition: transform .08s ease, border-color .12s ease, box-shadow .12s ease;
        }
        #snippet-sql {
            min-height: 280px;
            resize: vertical;
            font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
            line-height: 1.35;
        }
        .row {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
            margin-top: 12px;
        }
        button {
            padding: 6px 10px;
            min-height: 30px;
            cursor: pointer;
            color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
            background: var(--vscode-button-secondaryBackground, var(--vscode-input-background));
            border-color: color-mix(in srgb, var(--vscode-foreground) 18%, transparent);
        }
        button:hover {
            background: var(--vscode-button-secondaryHoverBackground, color-mix(in srgb, var(--vscode-input-background) 86%, var(--vscode-foreground) 14%));
        }
        button.primary {
            color: var(--vscode-button-foreground);
            background: var(--vscode-button-background);
            border-color: color-mix(in srgb, var(--vscode-button-background) 78%, #000 22%);
        }
        button.primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        button.warn {
            color: var(--vscode-errorForeground, #f14c4c);
        }
        button:disabled {
            opacity: .55;
            cursor: default;
        }
        .hint {
            margin-top: 8px;
            font-size: 11px;
            color: var(--muted);
            line-height: 1.35;
        }
        .readonly {
            margin-top: 10px;
            padding: 8px;
            border-radius: 8px;
            border: 1px dashed var(--chip-border);
            background: color-mix(in srgb, var(--chip-bg) 76%, transparent);
            color: var(--muted);
            min-height: 34px;
            display: flex;
            align-items: center;
        }
        .vars {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 8px;
        }
        .var-chip {
            appearance: none;
            border: 1px solid color-mix(in srgb, var(--accent) 42%, var(--chip-border));
            border-radius: 999px;
            padding: 5px 10px;
            font-size: 11px;
            font-weight: 600;
            color: var(--vscode-button-foreground, var(--vscode-foreground));
            background: color-mix(in srgb, var(--vscode-button-background, var(--chip-bg)) 70%, var(--chip-bg) 30%);
            cursor: pointer;
            user-select: none;
            box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 25%, transparent);
            transition: transform .08s ease, border-color .12s ease, box-shadow .12s ease;
        }
        .var-chip:hover {
            border-color: var(--accent);
            box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent) 65%, transparent);
            transform: translateY(-1px);
        }
        .var-chip:active {
            transform: translateY(0);
        }
        .var-chip:focus-visible {
            outline: 1px solid var(--accent);
            outline-offset: 1px;
        }
        .error {
            margin-top: 10px;
            min-height: 20px;
            color: var(--vscode-errorForeground, #f14c4c);
            font-size: 12px;
        }
        .footer {
            margin-top: 8px;
            font-size: 11px;
            color: var(--muted);
        }
        @media (max-width: 860px) {
            .layout {
                grid-template-columns: 1fr;
            }
            #snippet-list {
                min-height: 220px;
            }
        }
    </style>
</head>
<body>
    <div class="shell">
        <h2>Code Snippet Manager</h2>
        <div class="subtle">Build reusable CL and SQL Code Snippets. Search, run, and manage in one place.</div>

        <div class="layout">
            <div class="panel">
                <div class="panel-title">
                    <span>Library</span>
                    <span id="snippet-count" class="count">0</span>
                </div>
                <div class="search-wrap">
                    <input id="snippet-search" type="text" placeholder="Search Code Snippets..." aria-label="Search Code Snippets" />
                </div>
                <select id="snippet-list" size="14" aria-label="Code Snippet list"></select>
                <div class="row">
                    <button id="move-up" type="button">Move Up</button>
                    <button id="move-down" type="button">Move Down</button>
                    <button id="run-snippet" class="primary" type="button">Run</button>
                </div>
            </div>

            <div class="panel">
                <div class="label">
                    <span>Snippet Name</span>
                    <span id="snippet-kind" class="kind-pill">Type: -</span>
                </div>
                <input id="snippet-label" type="text" maxlength="120" placeholder="Example: List active jobs" />

                <div class="label"><span>Snippet Text</span></div>
                <textarea id="snippet-sql" placeholder="Type a CL command or SQL statement..."></textarea>

                <div class="hint">SQL Code Snippets can use SQL: prefix, or start with SELECT or VALUES.</div>
                <div class="vars" id="vars">
                    <button class="var-chip" data-token="\${sqlJobId}" type="button" title="Insert \${sqlJobId}">+ \${sqlJobId}</button>
                    <button class="var-chip" data-token="\${sqlJobName}" type="button" title="Insert \${sqlJobName}">+ \${sqlJobName}</button>
                    <button class="var-chip" data-token="\${sqlJobNumber}" type="button" title="Insert \${sqlJobNumber}">+ \${sqlJobNumber}</button>
                    <button class="var-chip" data-token="\${currentUser}" type="button" title="Insert \${currentUser}">+ \${currentUser}</button>
                    <button class="var-chip" data-token="\${currentLibrary}" type="button" title="Insert \${currentLibrary}">+ \${currentLibrary}</button>
                </div>

                <div class="row">
                    <button id="new-snippet" type="button">New</button>
                    <button id="save-snippet" class="primary" type="button">Save</button>
                    <button id="delete-snippet" class="warn" type="button">Delete</button>
                </div>

                <div id="readonly-hint" class="readonly"></div>
                <div id="error" class="error"></div>
                <div class="footer">Shortcuts: Cmd/Ctrl+S to save, Cmd/Ctrl+Enter to run selected Code Snippet.</div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const list = document.getElementById('snippet-list');
        const search = document.getElementById('snippet-search');
        const snippetCount = document.getElementById('snippet-count');
        const kindPill = document.getElementById('snippet-kind');
        const label = document.getElementById('snippet-label');
        const sql = document.getElementById('snippet-sql');
        const vars = document.getElementById('vars');
        const errorEl = document.getElementById('error');
        const readonlyHint = document.getElementById('readonly-hint');
        const moveUp = document.getElementById('move-up');
        const moveDown = document.getElementById('move-down');
        const runBtn = document.getElementById('run-snippet');
        const newBtn = document.getElementById('new-snippet');
        const saveBtn = document.getElementById('save-snippet');
        const deleteBtn = document.getElementById('delete-snippet');
        let snippets = [];
        let selectedId = '';

        function clearError() { errorEl.textContent = ''; }
        function setError(message) { errorEl.textContent = message || ''; }
        function findSelected() { return snippets.find(s => s.id === selectedId); }

        function inferKind(text) {
            const value = String(text || '').trim();
            if (!value) return '-';
            if (/^SQL\s*:/i.test(value)) return 'SQL';
            if (/^(SELECT|VALUES)\b/i.test(value)) return 'SQL';
            return 'CL';
        }

        function updateKindPill() {
            kindPill.textContent = 'Type: ' + inferKind(sql.value);
        }

        function filteredSnippets() {
            const query = String(search.value || '').trim().toLowerCase();
            if (!query) return snippets;
            return snippets.filter((snippet) => {
                const sourceText = String(snippet.source || '');
                const labelText = String(snippet.label || '');
                const templateText = String(snippet.stmt || '');
                return sourceText.toLowerCase().includes(query)
                    || labelText.toLowerCase().includes(query)
                    || templateText.toLowerCase().includes(query);
            });
        }

        function renderList() {
            const visible = filteredSnippets();
            list.replaceChildren();

            visible.forEach((snippet) => {
                const option = document.createElement('option');
                option.value = snippet.id;
                const sourceTag = snippet.source === 'built-in' ? 'BI' : 'USR';
                option.textContent = '[' + sourceTag + '] ' + snippet.label;
                list.append(option);
            });

            snippetCount.textContent = String(visible.length) + ' of ' + String(snippets.length);

            const visibleIds = new Set(visible.map((item) => item.id));
            if (selectedId && visibleIds.has(selectedId)) {
                list.value = selectedId;
                return;
            }

            if (visible.length > 0) {
                selectedId = visible[0].id;
                list.value = selectedId;
            } else {
                selectedId = '';
            }
        }

        function renderForm() {
            const selected = findSelected();
            if (!selected) {
                label.value = '';
                sql.value = '';
                label.readOnly = false;
                sql.readOnly = false;
                deleteBtn.disabled = true;
                runBtn.disabled = true;
                moveUp.disabled = true;
                moveDown.disabled = true;
                saveBtn.textContent = 'Save';
                readonlyHint.textContent = 'Create a new Code Snippet, then Save.';
                updateKindPill();
                return;
            }

            label.value = selected.label || '';
            sql.value = selected.stmt || '';
            const isBuiltIn = selected.source === 'built-in';
            label.readOnly = isBuiltIn;
            sql.readOnly = isBuiltIn;
            deleteBtn.disabled = isBuiltIn;
            runBtn.disabled = false;
            moveUp.disabled = false;
            moveDown.disabled = false;
            saveBtn.textContent = isBuiltIn ? 'Save as New' : 'Save';
            readonlyHint.textContent = isBuiltIn
                ? 'Built-in Code Snippet is read-only. Use Save as New to create your own copy.'
                : 'User Code Snippet. You can edit, reorder, run, or delete it.';
            updateKindPill();
        }

        function selectSnippet(id) {
            selectedId = id || '';
            renderList();
            renderForm();
            clearError();
        }

        function insertToken(token) {
            if (!token || sql.readOnly) return;
            sql.focus();
            const currentText = String(sql.value || '');
            const start = Number(sql.selectionStart ?? currentText.length);
            const end = Number(sql.selectionEnd ?? start);
            sql.setSelectionRange(start, end);

            let inserted = false;
            try {
                inserted = document.execCommand('insertText', false, token);
            } catch {
                inserted = false;
            }

            if (!inserted) {
                sql.setRangeText(token, start, end, 'end');
                sql.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: token }));
            }
            updateKindPill();
        }

        list.addEventListener('change', () => selectSnippet(list.value));
        search.addEventListener('input', () => {
            renderList();
            renderForm();
            clearError();
        });

        label.addEventListener('input', clearError);
        sql.addEventListener('input', () => {
            clearError();
            updateKindPill();
        });

        vars.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof HTMLElement)) return;
            const token = target.dataset?.token;
            if (!token) return;
            insertToken(token);
        });

        newBtn.addEventListener('click', () => {
            selectedId = '';
            label.value = '';
            sql.value = '';
            renderList();
            renderForm();
            label.focus();
            clearError();
        });

        saveBtn.addEventListener('click', () => {
            clearError();
            const selected = findSelected();
            const payload = { label: label.value || '', stmt: sql.value || '' };
            if (selected && selected.source === 'user') {
                vscode.postMessage({ type: 'update', id: selected.id, ...payload });
            } else {
                vscode.postMessage({ type: 'create', ...payload });
            }
        });

        deleteBtn.addEventListener('click', () => {
            clearError();
            const selected = findSelected();
            if (!selected || selected.source !== 'user') return;
            const confirmed = confirm('Delete Code Snippet "' + selected.label + '"?');
            if (!confirmed) return;
            vscode.postMessage({ type: 'delete', id: selected.id });
        });

        moveUp.addEventListener('click', () => {
            const selected = findSelected();
            if (selected) vscode.postMessage({ type: 'moveUp', id: selected.id });
        });
        moveDown.addEventListener('click', () => {
            const selected = findSelected();
            if (selected) vscode.postMessage({ type: 'moveDown', id: selected.id });
        });
        runBtn.addEventListener('click', () => {
            const selected = findSelected();
            if (selected) vscode.postMessage({ type: 'run', id: selected.id });
        });

        window.addEventListener('keydown', (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
                event.preventDefault();
                saveBtn.click();
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                runBtn.click();
            }
        });

        window.addEventListener('message', (event) => {
            const message = event.data || {};
            if (message.type === 'snippetsData') {
                snippets = Array.isArray(message.snippets) ? message.snippets : [];
                const preferred = message.selectedId || (message.createNew ? '' : selectedId) || snippets[0]?.id || '';
                selectedId = preferred;
                renderList();
                renderForm();
                clearError();
                if (message.createNew) {
                    selectedId = '';
                    renderList();
                    renderForm();
                    label.focus();
                }
            }
            if (message.type === 'error') {
                setError(message.message || 'Unexpected error.');
            }
        });

        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
    }

    private failed(command: string, mode: CommandExecutionMode, failure: string) {
        return { id: `${Date.now()}-connection`, command, mode, startedAt: new Date().toISOString(), elapsedMs: 0, outcome: 'error' as const, messages: [], failure };
    }

    private currentSqlJobId(connection = this.getConnection()): string | undefined {
        return this.jobManager.getDisplayJobId(connection);
    }

    private messageDetailsMode(): MessageDetailsMode {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const raw = String(config.get<string>('commandEntryMessageDetails', 'SHOW') || 'SHOW').trim().toUpperCase();
        return raw === 'HIDE' ? 'HIDE' : 'SHOW';
    }

    private clearHistoryOnStartupEnabled(): boolean {
        return vscode.workspace.getConfiguration('clPrompter').get<boolean>('commandEntryClearHistoryOnStartup', false);
    }

    private async toggleMessageDetailsPreference(): Promise<void> {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const current = this.messageDetailsMode();
        const next: MessageDetailsMode = current === 'SHOW' ? 'HIDE' : 'SHOW';
        await config.update('commandEntryMessageDetails', next, vscode.ConfigurationTarget.Global);
        this.post({ type: 'messageDetailsPreference', mode: next });
        this.post({ type: 'notice', message: next === 'SHOW' ? 'Command message sections expanded.' : 'Command message sections collapsed.' });
    }

    private postJobCapabilities(): void {
        const dedicatedJobEnabled = this.jobManager.isDedicatedEnabled();
        const remoteMapepireEnabled = this.jobManager.isRemoteMapepireServerEnabled(this.getConnection());
        const dedicatedReady = dedicatedJobEnabled;
        this.post({
            type: 'jobCapabilities',
            dedicatedJobEnabled,
            remoteMapepireEnabled,
            canStartNewJob: dedicatedReady,
            canCancelSqlJob: dedicatedReady
        });
    }

    private sqlFetchLimitDisplay(): string {
        const config = vscode.workspace.getConfiguration('clPrompter');
        const limitEnabled = config.get<boolean>('commandEntrySqlFetchLimitEnabled', true);
        const prefetchRows = config.get<number>('commandEntrySqlPrefetchRows', 200);
        const safePrefetchRows = Number.isInteger(prefetchRows) && prefetchRows > 0 ? prefetchRows : 200;
        if (!limitEnabled) {
            return `SQL rows: *NOMAX (fetch all on run)`;
        }

        const configuredRows = config.get<number>('commandEntrySqlFetchLimitRows', 1000);
        const chunkRows = Number.isInteger(configuredRows) && configuredRows > 0 ? configuredRows : 1000;
        const effectivePrefetchRows = Math.min(chunkRows, safePrefetchRows);
        return `SQL rows: rows/fetch ${chunkRows}, prefetch ${effectivePrefetchRows}`;
    }

    private async initializeDedicatedJobIfNeeded(): Promise<void> {
        if (!this.jobManager.isDedicatedEnabled()) {
            return; // Not enabled, skip
        }

        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            return; // No connection available
        }

        // Dedicated mode should only consider a real dedicated job as initialized.
        if (this.jobManager.hasActiveDedicatedJob(connection)) {
            return;
        }

        // Create the dedicated job automatically
        try {
            this.output.appendLine(`[Command Entry] Auto-initializing dedicated SQL job on panel startup...`);
            const sqlJobId = await this.jobManager.restartJob(connection);
            if (sqlJobId) {
                this.refreshSqlJobId(connection);
                this.output.appendLine(`[Command Entry] Auto-initialized dedicated SQL job: ${sqlJobId}`);
            }
        } catch (error) {
            this.output.appendLine(`[Command Entry] Auto-initialization failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    public refreshSqlJobId(connection = this.getConnection()): void {
        const sqlJobId = this.currentSqlJobId(connection);
        if (sqlJobId !== this.lastPostedSqlJobId) {
            this.output.appendLine(`[Command Entry] SQL job display ID changed: ${this.lastPostedSqlJobId || '<none>'} -> ${sqlJobId || '<none>'}`);
        }
        this.lastPostedSqlJobId = sqlJobId;
        this.post({ type: 'sqlJobId', sqlJobId });
    }

    private history(): CommandEntryHistory[] { return this.context.globalState.get<CommandEntryHistory[]>(HISTORY_KEY, []); }
    private shouldAddToHistory(sourceType: 'user' | 'snippet' = 'user', isSql: boolean = false): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');

        if (sourceType === 'snippet') {
            return config.get<boolean>('commandEntryLogSnippets', false);
        }
        if (isSql) {
            return config.get<boolean>('commandEntryLogSqlStatements', false);
        }
        return true;
    }

    private shouldAddToCommandEntryLog(sourceType: 'user' | 'snippet' = 'user', isSql: boolean = false): boolean {
        const config = vscode.workspace.getConfiguration('clPrompter');

        if (sourceType === 'snippet') {
            return config.get<boolean>('commandEntryLogSnippetsToCommandEntryLog', false);
        }
        if (isSql) {
            return config.get<boolean>('commandEntryLogSqlStatementsToCommandEntryLog', false);
        }
        return true;
    }

    private remember(entry: CommandEntryHistory): void {
        const history = this.history().filter(item => item.command !== entry.command || item.mode !== entry.mode);
        void this.context.globalState.update(HISTORY_KEY, [entry, ...history].slice(0, MAX_HISTORY));
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
                        <button id="snippets" type="button" aria-label="Open code snippets" data-tooltip="Code Snippets">{ }</button>
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
                                <button id="menu-clear-log" type="button" role="menuitem">Clear Log Messages</button>
                                <button id="menu-start-new-job" type="button" role="menuitem">Reconnect Server Job</button>
                                <button id="menu-cancel-sql-job" type="button" role="menuitem">Cancel Last SQL stmt</button>
                            </div>
                        </div>
                        <button id="history-prev" type="button" aria-label="Recall prior command (F9)" data-tooltip="Retrieve Prior, right-Click=History">↑</button>
                        <button id="history-next" type="button" aria-label="Recall next command (F8)" data-tooltip="Retrieve Next, right-Click=History">↓</button>
                        <select id="mode" aria-label="Run mode" title="Run CL Command">
                            <option value="*RUN" title="Run CL Command">Run</option>
                            <option value="*LIMIT" title="Run as Limited USRPRF">Limit</option>
                            <option value="*CHECK" title="Syntax Check Only">Check</option>
                        </select>
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
