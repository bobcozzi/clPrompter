import * as vscode from 'vscode';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { CLPrompter } from './clPrompter';
import { CommandEntryHistory, CommandExecutionMode } from './commandEntryModel';
import { buildCancelSqlJobCommand, CommandEntryService, normalizeSqlJobId } from './commandEntryService';

const HISTORY_KEY = 'commandEntry.history';
const MAX_HISTORY = 100;

type CommandEntryRequest =
    | { type: 'ready' }
    | { type: 'run'; command: string; mode: CommandExecutionMode }
    | { type: 'prompt'; command: string }
    | { type: 'requestHistoryPicker' }
    | { type: 'copyCommand'; command: string }
    | { type: 'copySqlJobId'; sqlJobId: string }
    | { type: 'requestSqlJobId' }
    | { type: 'requestCancel' }
    | { type: 'clear' };

/** Persistent panel webview. It deliberately does not own an IBM i connection. */
export class CommandEntryViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'clprompter.commandEntryView';
    private view: vscode.WebviewView | undefined;
    private running = false;
    private activeExecutionId: string | undefined;
    private cancelRequested = false;
    private clearInputOnFirstReady = true;
    private readonly output = vscode.window.createOutputChannel('CLPROMPTER');
    private readonly service = new CommandEntryService();

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly getConnection: () => IBMi | undefined
    ) {
        context.subscriptions.push(this.output);
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
    requestCancel(): void { this.post({ type: 'requestCancel' }); }
    clear(): void { this.post({ type: 'clearResults' }); }

    private async receive(message: CommandEntryRequest): Promise<void> {
        switch (message.type) {
            case 'ready':
                this.post({
                    type: 'initialize',
                    history: this.history(),
                    running: this.running,
                    sqlJobId: this.currentSqlJobId(),
                    clearInputOnStartup: this.clearInputOnFirstReady
                });
                this.clearInputOnFirstReady = false;
                break;
            case 'clear':
                this.post({ type: 'clearResults' });
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
            case 'requestSqlJobId':
                this.post({ type: 'sqlJobId', sqlJobId: this.currentSqlJobId() });
                break;
            case 'requestCancel':
                await this.submitCancelRequest();
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

    private async prompt(command: string): Promise<void> {
        if (!command.trim()) { this.post({ type: 'notice', message: 'Enter a CL command to prompt.' }); return; }
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

    private async run(command: string, mode: CommandExecutionMode): Promise<void> {
        if (this.running) { return; }
        if (!command.trim()) { this.post({ type: 'notice', message: 'Enter a CL command to run.' }); return; }
        const connection = this.getConnection();
        if (!connection || !connection.sqlRunnerAvailable()) {
            this.post({ type: 'execution', execution: this.failed(command, mode, 'Not connected to IBM i, or the Code for IBM i SQL runner is unavailable.') });
            return;
        }
        this.running = true;
        this.activeExecutionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.cancelRequested = false;
        const rawSqlJobId = connection.getSqlJobId()?.trim();
        const sqlJobId = normalizeSqlJobId(rawSqlJobId) ?? rawSqlJobId;
        this.post({ type: 'running', running: true, executionId: this.activeExecutionId, startedAt: Date.now(), sqlJobId });
        try {
            const execution = await this.service.execute(connection, command, mode, this.activeExecutionId);
            this.remember({ command, mode });
            if (execution.failure) { this.output.appendLine(`[Command Entry] CMD_RUN failed: ${execution.failure}`); }
            this.post({ type: 'execution', execution });
        } finally {
            this.running = false;
            this.activeExecutionId = undefined;
            const refreshedRawSqlJobId = connection.getSqlJobId()?.trim();
            const refreshedSqlJobId = normalizeSqlJobId(refreshedRawSqlJobId) ?? refreshedRawSqlJobId;
            this.post({ type: 'running', running: false, sqlJobId: refreshedSqlJobId });
        }
    }

    /**
     * Requests cancellation from the SSH job rather than the busy Mapepire SQL
     * job. IBM i decides whether the active statement is interruptible.
     */
    private async submitCancelRequest(): Promise<void> {
        if (!this.running || !this.activeExecutionId || this.cancelRequested) { return; }
        this.cancelRequested = true;
        this.post({ type: 'cancelRequested' });
        const connection = this.getConnection();
        const sqlJobId = normalizeSqlJobId(connection?.getSqlJobId());
        if (!connection || !sqlJobId) {
            const message = 'Cancel request unavailable: Code for IBM i did not provide a valid Mapepire SQL job ID.';
            this.output.appendLine(`[Command Entry] ${message}`);
            this.post({ type: 'cancelFailed', message });
            this.cancelRequested = false;
            return;
        }
        try {
            // sendCommand uses Code for IBM i's authenticated SSH facility, not
            // connection.runSQL and therefore avoids the Mapepire SQL job.
            const cancelCommand = buildCancelSqlJobCommand(sqlJobId);
            this.output.appendLine(`[Command Entry] Sending cancel request for Mapepire SQL job ${sqlJobId}: ${cancelCommand}`);
            const result = await connection.sendCommand({
                command: cancelCommand
            });
            this.output.appendLine(`[Command Entry] Cancel request for ${sqlJobId} completed with code ${result.code}. stdout=${result.stdout || '<empty>'}; stderr=${result.stderr || '<empty>'}`);
            if (result.code !== 0) {
                const message = result.stderr || result.stdout || `IBM i command ended with code ${result.code}.`;
                this.output.appendLine(`[Command Entry] Cancel request for ${sqlJobId} failed: ${message}`);
                this.post({ type: 'cancelFailed', message: `Cancel request failed: ${message}` });
                this.cancelRequested = false;
                return;
            }
            this.output.appendLine(`[Command Entry] Cancel requested for Mapepire SQL job ${sqlJobId}.`);
            this.post({ type: 'cancelAccepted', sqlJobId });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.output.appendLine(`[Command Entry] Cancel request threw: ${message}`);
            this.post({ type: 'cancelFailed', message: `Cancel request failed: ${message}` });
            this.cancelRequested = false;
        }
    }

    private failed(command: string, mode: CommandExecutionMode, failure: string) {
        return { id: `${Date.now()}-connection`, command, mode, startedAt: new Date().toISOString(), elapsedMs: 0, outcome: 'error' as const, messages: [], failure };
    }

    private currentSqlJobId(): string | undefined {
        const rawSqlJobId = this.getConnection()?.getSqlJobId()?.trim();
        return normalizeSqlJobId(rawSqlJobId) ?? rawSqlJobId;
    }

    private history(): CommandEntryHistory[] { return this.context.globalState.get<CommandEntryHistory[]>(HISTORY_KEY, []); }
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
                        <button id="history-picker" type="button" aria-label="Open command history" data-tooltip="CL History">…</button>
                        <button id="history-prev" type="button" aria-label="Recall prior command (F9)" data-tooltip="Retrieve Prior, right-Click=History">↑</button>
                        <button id="history-next" type="button" aria-label="Recall next command (F10)" data-tooltip="Retrieve Next, right-Click=History">↓</button>
                        <button id="clear" type="button" aria-label="Clear log" data-tooltip="Clear log">Clear Log</button>
                        <select id="mode" aria-label="Run mode" title="Run CL Command">
                            <option value="*RUN" title="Run CL Command">Run</option>
                            <option value="*LIMIT" title="Run as Limited USRPRF">Limit</option>
                            <option value="*CHECK" title="Syntax Check Only">Check</option>
                        </select>
                    </div>
                    <div id="status" role="status" aria-live="polite">
                        <span id="status-text"></span>
                        <span id="status-jobid" aria-label="SQL job ID" title="Click=Select, Double-Click=Copy" tabindex="0" hidden></span>
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
