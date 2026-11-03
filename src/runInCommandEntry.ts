/*
 * MIT License
 *
 * Copyright (c) 2026 R. Cozzi, Jr.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import * as vscode from 'vscode';
import { code4i } from './extension';
import type { CommandEntryViewProvider } from './commandEntryView';
import { collectAllCLCmds, collectCLCmdFromLine, CollectedCLCmd, extractGotoTargetLabel, findCLLabelLine } from './extractor';
import { promptForClVariables, substituteClVariables } from './runClVariables';

const SUPPORTED_CL_LANGUAGE_IDS = ['clle', 'clp', 'cl'];
const MAX_BATCH_STATEMENTS = 500;

/** CL commands that only make sense inside a compiled CL program and cannot run
 *  interactively in Command Entry. `RTV*` covers all retrieve commands. */
const UNSUPPORTED_STATEMENT_COMMANDS = new Set(['PGM', 'ENDPGM', 'DCL', 'DCLF', 'MONMSG', 'CHGVAR', 'SNDPGMMSG']);
const UNSUPPORTED_STATEMENT_PREFIXES = ['RTV'];

/** Leading command name of a statement, uppercased; undefined when none can be determined. */
function leadingCommandName(command: string): string | undefined {
    const match = /^\s*([A-Za-z@#$][A-Za-z0-9@#$.]*)/.exec(command);
    return match ? match[1].toUpperCase() : undefined;
}

function isUnsupportedCommandName(commandName: string | undefined): boolean {
    if (!commandName) { return false; }
    if (UNSUPPORTED_STATEMENT_COMMANDS.has(commandName)) { return true; }
    return UNSUPPORTED_STATEMENT_PREFIXES.some((prefix) => commandName.startsWith(prefix));
}

/** Whether the user is prompted for &variable values before running (clPrompter.cmdEntryPromptForVariables). */
function promptForVariablesEnabled(): boolean {
    return vscode.workspace.getConfiguration('clPrompter').get<boolean>('cmdEntryPromptForVariables', true);
}

type RunSourceScope = 'selected' | 'file';
type ErrorAction = 'retry' | 'ignore' | 'ignoreAll' | 'stop';

let batchRunning = false;

export function registerRunInCommandEntry(context: vscode.ExtensionContext, commandEntry: CommandEntryViewProvider): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('clprompter.runSelectedInCommandEntry', () => runEditorStatementsInCommandEntry(commandEntry, 'selected')),
        vscode.commands.registerCommand('clprompter.runFileInCommandEntry', () => runEditorStatementsInCommandEntry(commandEntry, 'file'))
    );
}

async function runEditorStatementsInCommandEntry(commandEntry: CommandEntryViewProvider, scope: RunSourceScope): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No active editor'));
        return;
    }
    if (!SUPPORTED_CL_LANGUAGE_IDS.includes(editor.document.languageId)) {
        void vscode.window.showInformationMessage(vscode.l10n.t('CL Prompter: Not a supported IBM i source type.'));
        return;
    }
    if (batchRunning) {
        void vscode.window.showInformationMessage(vscode.l10n.t('A Command Entry source run is already in progress.'));
        return;
    }

    const collected = collectStatementsForScope(editor, scope);
    const skippedCommands = new Set<string>();
    const statements: CollectedCLCmd[] = [];
    for (const statement of collected) {
        const commandName = leadingCommandName(statement.command);
        // Easter egg: running GOTO (or MONMSG EXEC(GOTO ...)) jumps the editor to
        // the target label instead of going to Command Entry (GOTO is meaningless
        // outside a CL program). extractGotoTargetLabel returns undefined for a
        // plain MONMSG, which then falls through to the skip-list below.
        if (commandName === 'GOTO' || (commandName === 'MONMSG' && extractGotoTargetLabel(statement.command) !== undefined)) {
            gotoLabelInEditor(editor, statement.command);
            continue;
        }
        if (isUnsupportedCommandName(commandName)) {
            skippedCommands.add(commandName ?? statement.command.split(/\s+/)[0]);
            continue;
        }
        statements.push(statement);
    }
    if (skippedCommands.size > 0) {
        const skippedList = Array.from(skippedCommands).sort().join(', ');
        void vscode.window.showInformationMessage(vscode.l10n.t('Selection contains CL commands that cannot be run via Cmd Entry: {0}', skippedList));
        commandEntry.postNotice('info', vscode.l10n.t('Skipped CL command(s) that cannot be run via Cmd Entry: {0}', skippedList));
    }
    if (statements.length === 0) {
        void vscode.window.showInformationMessage(vscode.l10n.t('No runnable CL statements found.'));
        return;
    }
    if (statements.length > MAX_BATCH_STATEMENTS) {
        void vscode.window.showWarningMessage(vscode.l10n.t('Too many CL statements ({0}). The maximum for a single run is {1}.', statements.length, MAX_BATCH_STATEMENTS));
        return;
    }

    const connection = code4i?.instance?.getConnection();
    if (!connection || !connection.sqlRunnerAvailable()) {
        void vscode.window.showErrorMessage(vscode.l10n.t('Not connected to IBM i, or the Code for IBM i SQL runner is unavailable.'));
        return;
    }

    // Prompt for all &variable values up front, BEFORE revealing Command Entry.
    // (Revealing the panel pulls focus, which would dismiss a focus-sensitive prompt.)
    let variableValues: Map<string, string> | undefined;
    if (promptForVariablesEnabled()) {
        variableValues = new Map<string, string>();
        for (const statement of statements) {
            const collected = await promptForClVariables(statement.command, variableValues);
            if (collected === undefined) {
                // User cancelled a variable prompt: abort before revealing the panel.
                return;
            }
        }
    }

    // Reveal/initialize Command Entry and wait until its webview can accept posts.
    await vscode.commands.executeCommand('clprompter.openCommandEntry');
    await commandEntry.whenWebviewReady();

    batchRunning = true;
    let ignoreAllErrors = false;
    let succeeded = 0;
    let warnings = 0;
    let failed = 0;
    let skipped = 0;
    let stoppedEarly = false;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Running CL statements in Command Entry'),
            cancellable: true
        }, async (progress, token) => {
            for (let i = 0; i < statements.length; i++) {
                if (token.isCancellationRequested) {
                    stoppedEarly = true;
                    break;
                }

                const statement = statements[i];
                progress.report({ message: vscode.l10n.t('Statement {0} of {1}: {2}', i + 1, statements.length, truncate(statement.command, 60)) });

                // Substitute the &variable values collected up front.
                const commandToRun = variableValues ? substituteClVariables(statement.command, variableValues) : statement.command;

                let failureText: string | undefined;
                try {
                    const execution = await commandEntry.runStatementFromSource(commandToRun);
                    if (execution === undefined) {
                        // Re-routed to the prompter or a command picker, or another run was active.
                        skipped++;
                        continue;
                    }
                    failureText = execution.failure ?? firstErrorMessageText(execution.messages);
                    if (!failureText && execution.outcome === 'error') {
                        failureText = vscode.l10n.t('Command failed.');
                    }
                    if (!failureText) {
                        if (execution.outcome === 'warning') { warnings++; } else { succeeded++; }
                        continue;
                    }
                } catch (error) {
                    failureText = error instanceof Error ? error.message : String(error);
                }

                failed++;
                if (ignoreAllErrors || token.isCancellationRequested) {
                    continue;
                }

                const action = await promptForErrorAction(statement, failureText, i + 1, statements.length);
                if (action === 'retry') {
                    failed--;
                    i--;
                } else if (action === 'ignoreAll') {
                    ignoreAllErrors = true;
                } else if (action === 'stop') {
                    stoppedEarly = true;
                    break;
                }
                // 'ignore' simply continues with the next statement.
            }
        });
    } finally {
        batchRunning = false;
    }

    const summaryParts = [vscode.l10n.t('{0} succeeded', succeeded)];
    if (warnings > 0) { summaryParts.push(vscode.l10n.t('{0} with warnings', warnings)); }
    if (failed > 0) { summaryParts.push(vscode.l10n.t('{0} failed', failed)); }
    if (skipped > 0) { summaryParts.push(vscode.l10n.t('{0} skipped', skipped)); }
    if (skippedCommands.size > 0) { summaryParts.push(vscode.l10n.t('{0} unsupported', skippedCommands.size)); }
    const summary = vscode.l10n.t('Command Entry source run: {0}.{1}', summaryParts.join(', '), stoppedEarly ? vscode.l10n.t(' Stopped early.') : '');
    commandEntry.postNotice(failed > 0 ? 'error' : 'info', summary);
    void vscode.window.showInformationMessage(summary);
}

function collectStatementsForScope(editor: vscode.TextEditor, scope: RunSourceScope): CollectedCLCmd[] {
    const document = editor.document;
    if (scope === 'file') {
        return collectAllCLCmds(document);
    }

    const selection = editor.selection;
    if (selection.isEmpty) {
        // No selection: run the full statement under the cursor.
        return collectAllCLCmds(document, selection.active.line, selection.active.line);
    }

    // Expand the selection to whole-statement boundaries.
    const from = collectCLCmdFromLine(document, selection.start.line);
    const to = collectCLCmdFromLine(document, selection.end.line);
    const startLine = Math.min(from.startLine, to.startLine);
    const endLine = Math.max(from.endLine, to.endLine);
    return collectAllCLCmds(document, startLine, endLine);
}

function firstErrorMessageText(messages: Array<{ kind: string; messageId: string; text: string }>): string | undefined {
    const firstError = messages.find((message) => message.kind === 'error');
    if (!firstError) {
        return undefined;
    }
    const id = firstError.messageId.trim();
    const text = firstError.text.trim();
    return id ? `${id}: ${text}` : text;
}

// Failure prompt is a bottom-right toast (non-modal showErrorMessage) instead of
// a centered modal: the toast has a consistent width regardless of how short the
// failing command is, and because it carries action buttons it stays pinned until
// the user answers it (it does not auto-dismiss like a plain toast).
async function promptForErrorAction(statement: CollectedCLCmd, errorText: string, ordinal: number, total: number): Promise<ErrorAction> {
    const retryLabel = vscode.l10n.t('Retry');
    const ignoreLabel = vscode.l10n.t('Ignore');
    const ignoreAllLabel = vscode.l10n.t('Ignore All');
    const stopLabel = vscode.l10n.t('Stop');
    const choice = await vscode.window.showErrorMessage(
        vscode.l10n.t('Statement {0} of {1} failed: {2}\n{3}', ordinal, total, truncate(statement.command, 160), truncate(errorText, 240)),
        retryLabel, ignoreLabel, ignoreAllLabel, stopLabel
    );
    if (choice === retryLabel) { return 'retry'; }
    if (choice === ignoreLabel) { return 'ignore'; }
    if (choice === ignoreAllLabel) { return 'ignoreAll'; }
    // 'Stop' or a dismissed notification both end the run.
    return 'stop';
}

function truncate(text: string, maxLength: number): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return oneLine.length > maxLength ? `${oneLine.substring(0, maxLength - 1)}…` : oneLine;
}

/**
 * Easter egg for `GOTO`: resolve the target label and jump the editor to it.
 * Accepts both positional (`GOTO READNEXT`) and keyword (`GOTO CMDLBL(READNEXT)`)
 * forms. Searches the whole document for `LABEL:` at a line start (CL labels are
 * line-initial), case-insensitively, then reveals and selects that position.
 */
function gotoLabelInEditor(editor: vscode.TextEditor, command: string): void {
    const target = extractGotoTargetLabel(command);
    if (!target) {
        void vscode.window.showInformationMessage(vscode.l10n.t('GOTO has no target label.'));
        return;
    }

    const lineIndex = findCLLabelLine(editor.document, target);
    if (lineIndex === undefined) {
        void vscode.window.showInformationMessage(vscode.l10n.t("Label '{0}' not found in this source file.", target));
        return;
    }

    const lineText = editor.document.lineAt(lineIndex).text;
    const colonIndex = lineText.indexOf(':');
    const position = new vscode.Position(lineIndex, Math.max(colonIndex, 0));
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
}
