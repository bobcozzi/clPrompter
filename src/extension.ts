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
import { DOMParser } from '@xmldom/xmldom';


import { CodeForIBMi } from "@halcyontech/vscode-ibmi-types";
export let code4i: CodeForIBMi;
import { Extension, extensions } from "vscode";
import { CmdHelpChecker } from './components/cmdHelp/cmdHelpChecker';

import { initializePrompter, CLPrompter, CLPrompterCallback } from './clPrompter';

import { ParmMeta, ParmMetaMap } from './types';
import {
    extractAllowedValsAndTypes,
    quoteIfNeeded,
    buildCLCommand,
    formatCLSource,
    FormatOptions
} from "./formatCL";

import {
    extractParmMetas,
    parseCLParms
} from './parseCL';

import * as fs from 'fs';
import * as path from 'path';
import { buildAPI2PartName, buildQualName } from './QlgPathName';
import { collectCLCmd, buildAllowedValsMap, buildDepConstraints, buildValToMapToMap, buildDefaultValMap, buildPmtCtlMap, buildAllMaps } from './extractor';
import { getCMDXML, clearCMDXMLCache, warmXmlCache, getCmdHelpViaUDTF } from './getcmdxml';

import {
    tokenizeCL,
    safeExtractKwdArg,
    rewriteLeadingPositionalsByList
} from './tokenizeCL';

let baseExtension: Extension<CodeForIBMi> | undefined;

/**
 * Helptext cache populated by the PASE-based prefetch.
 * Key: uppercase command name (e.g. "CPYF"). Value: raw GENCMDDOC HTML.
 * Checked before falling back to vscode-clle's getCLDoc so that pre-fetched
 * commands never touch the Mapepire connection when the ? button is clicked.
 * Cleared on IBM i disconnect so stale docs from one system never appear on another.
 */
const clpDocCache = new Map<string, string>();

/** Per-keyword UDTF help cache. Key: "CMDNAME.KWD" (uppercase). Value: raw HTML from CMD_HELP UDTF.
 * Cleared on IBM i disconnect so stale results from one system never appear on another.
 */
const clpHelpCache = new Map<string, string>();

/**
 * Extracts the raw HTML for a single parameter section from a GENCMDDOC HTML document.
 * GENCMDDOC wraps each parameter in: <div><a name="CMDNAME.PARM">...</a>...</div>
 * Returns null if the section cannot be found.
 */
function extractParamHtml(html: string, cmdName: string, kwd: string): string | null {
    const htmlUpper = html.toUpperCase();
    const target = `NAME="${cmdName.toUpperCase()}.${kwd.toUpperCase()}"`;
    const anchorPos = htmlUpper.indexOf(target);
    if (anchorPos === -1) { return null; }

    // Walk back to find the opening <div that is the parent of the anchor
    const divStart = htmlUpper.lastIndexOf('<DIV', anchorPos);
    if (divStart === -1) { return null; }

    // Count nested <div> tags to find the matching </div>
    let depth = 1;
    let pos = divStart + 4;
    while (depth > 0 && pos < html.length) {
        const nextOpen  = htmlUpper.indexOf('<DIV',  pos);
        const nextClose = htmlUpper.indexOf('</DIV', pos);
        if (nextClose === -1) { break; }
        if (nextOpen !== -1 && nextOpen < nextClose) {
            depth++;
            pos = nextOpen + 4;
        } else {
            depth--;
            pos = nextClose + 6; // skip past </div>
        }
    }

    return html.substring(divStart, pos);
}

export async function activate(context: vscode.ExtensionContext) {

    baseExtension = extensions.getExtension<CodeForIBMi>("halcyontechltd.code-for-ibmi");
    if (baseExtension) {
        if (!baseExtension.isActive) {
            await baseExtension.activate();
        }
        code4i = baseExtension.exports;

        // Register the CMD_HELP UDTF component so Code for IBM i automatically
        // checks and installs/updates it on every NEW connection.
        const cmdHelpChecker = new CmdHelpChecker();
        code4i.componentRegistry.registerComponent(context, cmdHelpChecker);

        // If the extension activates while a connection is already live (e.g. lazy
        // activation), the ComponentManager won't have called our component for the
        // current session. Run the check manually here so it still installs.
        // Guard prevents a concurrent run when the ComponentManager is already running it.
        let cmdHelpCheckRunning = false;
        const runCmdHelpCheck = async () => {
            if (cmdHelpCheckRunning) { return; }
            cmdHelpCheckRunning = true;
            try {
                const conn = code4i?.instance?.getConnection();
                if (!conn) { return; }
                const state = await cmdHelpChecker.getRemoteState(conn, '');
                if (state !== 'Installed') {
                    await cmdHelpChecker.update(conn, '');
                }
            } catch (e) {
                console.error(`[clPrompter] CmdHelpChecker manual check failed: ${e}`);
            } finally {
                cmdHelpCheckRunning = false;
            }
        };

        // Subscribe to IBM i connection events.
        // On disconnect: clear the XML cache so stale definitions from the previous
        // IBM i system are never reused after reconnecting to a different system.

        // Keep-alive: send a trivial no-op to the Mapepire SQL job every 20 seconds so
        // the JVM service job never goes idle between F4 presses.  Without this, opening
        // a second source member after a short pause causes a ~22 s cold-start because
        // the Mapepire job is recycled/reset while the IDE sits idle.
        let keepAliveInterval: ReturnType<typeof setInterval> | undefined;

        const startKeepAlive = () => {
            if (keepAliveInterval) { clearInterval(keepAliveInterval); }
            keepAliveInterval = setInterval(async () => {
                const conn = code4i?.instance?.getConnection();
                if (!conn || !conn.sqlRunnerAvailable()) { return; }
                try {
                    await conn.runSQL('@/* clPrompter keep-alive */');
                } catch (_) {
                    // Non-critical — silently ignore
                }
            }, 20_000);
        };

        const stopKeepAlive = () => {
            if (keepAliveInterval) {
                clearInterval(keepAliveInterval);
                keepAliveInterval = undefined;
            }
        };

        /**
         * Pre-loads both the command XML definition (QCDRCMDD → XML cache) and
         * GENCMDDOC helptext (PASE SSH channel → clpDocCache) for every command in
         * the prefetchCommands setting.
         *
         * XML warm uses Mapepire (fast, ~500 ms each) with no progress toast.
         * Helptext fetch uses a PASE SSH exec channel so it never touches the ileQueue.
         * Both run in parallel across all commands — total wall-clock time ≈ one command.
         */
        const prefetch = (): void => {
            const config = vscode.workspace.getConfiguration('clPrompter');
            const raw: string = config.get('prefetchCommands', '');
            if (!raw.trim()) { return; }

            const cmds = raw.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
            if (cmds.length === 0) { return; }

            const delayMs: number = (config.get<number>('prefetchDelay', 0)) * 1_000;

            setTimeout(async () => {
                const conn = code4i?.instance?.getConnection();
                if (!conn) { return; }

                const fetchOne = async (cmd: string): Promise<void> => {
                    const tmpFile = `clprompter_${cmd}.html`;
                    const tmpPath = `/tmp/${tmpFile}`;

                    const useGencmddoc = vscode.workspace.getConfiguration('clPrompter').get<string>('parmHelpText', 'CMD_HELP UDTF') === 'GENCMDDOC';

                    // XML warm (Mapepire, ~500 ms, no progress toast) and
                    // GENCMDDOC helptext (PASE SSH exec channel) run concurrently.
                    await Promise.allSettled([
                        // --- XML definition warm ---
                        warmXmlCache(cmd),

                        // --- Helptext (GENCMDDOC via PASE) — only when parmHelpText=GENCMDDOC ---
                        (async () => {
                            if (!useGencmddoc) { return; }
                            if (clpDocCache.has(cmd)) { return; }
                            const t0 = Date.now();
                            try {
                                const genResult = await conn.runCommand({
                                    command: `system "GENCMDDOC CMD(QSYS/${cmd}) GENOPT(*HTML *SHOWCHOICEPGMVAL) REPLACE(*YES) TOSTMF('${tmpFile}') TODIR('/tmp')"`,
                                    environment: 'pase'
                                });
                                if (genResult.code !== 0) {
                                    console.log(`[clPrompter] PASE GENCMDDOC for ${cmd} failed (code=${genResult.code}): ${genResult.stderr}`);
                                    return;
                                }
                                const buf = await conn.getContent().downloadStreamfileRaw(tmpPath);
                                clpDocCache.set(cmd, buf.toString('utf8'));
                                console.log(`[clPrompter] PASE helptext pre-fetch for ${cmd} done in ${Date.now() - t0}ms (${clpDocCache.get(cmd)!.length} bytes)`);
                            } catch (e: any) {
                                console.log(`[clPrompter] PASE helptext pre-fetch for ${cmd} failed (non-critical): ${e?.message ?? e}`);
                            } finally {
                                conn.runCommand({ command: `rm -f ${tmpPath}`, environment: 'pase' }).catch(() => {});
                            }
                        })()
                    ]);
                };

                // Run all commands in parallel — each uses its own SSH exec channel so
                // there is no serialization penalty. Total wall-clock time ≈ one command.
                await Promise.allSettled(cmds.map(fetchOne));
            }, delayMs);
        };

        code4i.instance.subscribe(context, 'connected', 'clPrompter-keepalive-start', startKeepAlive);
        code4i.instance.subscribe(context, 'connected', 'clPrompter-prefetch', prefetch);
        // NOTE: no 'connected' subscriber for runCmdHelpCheck — the ComponentManager
        // handles new connections automatically (it calls getRemoteState/update on all
        // registered components at connect time). The manual call below handles only
        // the case where the extension activates into an already-live session.
        code4i.instance.subscribe(context, 'disconnected', 'clPrompter-keepalive-stop', stopKeepAlive);

        // Start immediately if already connected when the extension activates.
        if (code4i.instance.getConnection()) {
            startKeepAlive();
            // Run the CMD_HELP check first, then prefetch — serialized so the
            // upload/compile step doesn't race prefetch for SSH channels.
            runCmdHelpCheck().finally(() => prefetch());
        }

        // Ensure the interval is cleared when the extension is deactivated.
        context.subscriptions.push({ dispose: stopKeepAlive });

        code4i.instance.subscribe(context, 'disconnected', 'clPrompter-cache-clear', () => {
            clearCMDXMLCache();
            clpDocCache.clear();
            clpHelpCache.clear();
            console.log('[clPrompter] Disconnected — XML cache and helptext cache cleared');
        });
    } else {
        vscode.window.showErrorMessage("Code for IBM i extension is not installed or not found.");
    }
    try {
        console.log('[clPrompter] activating...');
        context.subscriptions.push(
            vscode.commands.registerCommand('clPrompter.clPrompter', async () => {
                console.log('CL Prompter activated!');
                const config = vscode.workspace.getConfiguration('clPrompter');
                if (!config.get('enableF4Key')) {
                    vscode.window.showInformationMessage('Fn key for CL Prompter is disabled in settings.');
                    return;
                }
                await ClPromptPanel.createOrShow(context.extensionUri);
            })
        );

        // Register Format CL Current Command
        context.subscriptions.push(
            vscode.commands.registerCommand('clPrompter.formatCurrentCommand', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showInformationMessage('No active editor');
                    return;
                }

                const document = editor.document;

                // Only activate for supported languages
                const supportedLangs = ['clle', 'clp', 'cl','cmd', 'bnd'];
                if (!supportedLangs.includes(document.languageId)) {
                    vscode.window.showInformationMessage('CL Prompter: Not a supported IBM i source type.');
                    return;
                }

                // Extract the current command range
                const commandInfo = collectCLCmd(editor);
                if (!commandInfo || !commandInfo.command) {
                    vscode.window.showInformationMessage('No CL command found at cursor');
                    return;
                }

                // Get format options from configuration
                const config = vscode.workspace.getConfiguration('clPrompter');
                const formatOptions: FormatOptions = {
                    cvtcase: config.get('convertCmdAndParmNameCase', '*UPPER') as '*UPPER' | '*LOWER' | '*NONE',
                    indrmks: config.get('formatIndentComments', '*YES') as '*NO' | '*YES',
                    labelpos: config.get('formatLabelPosition', 2),
                    bgncol: config.get('formatCmdPosition', 14),
                    indcol: config.get('formatKwdPosition', 25),
                    indcont: config.get('formatContinuePosition', 27)
                };

                // Get the lines for the command
                const allLines: string[] = [];
                for (let i = commandInfo.startLine; i <= commandInfo.endLine; i++) {
                    allLines.push(document.lineAt(i).text);
                }

                // Format the command
                const formatted = formatCLSource(allLines, formatOptions, 0);

                // Replace in the editor
                await editor.edit(editBuilder => {
                    const range = new vscode.Range(
                        commandInfo.startLine, 0,
                        commandInfo.endLine, document.lineAt(commandInfo.endLine).text.length
                    );
                    editBuilder.replace(range, formatted.join('\n'));
                });

                vscode.window.showInformationMessage('CL command formatted');
            })
        );

        // Register Format CL Entire File
        context.subscriptions.push(
            vscode.commands.registerCommand('clPrompter.formatEntireFile', async () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) {
                    vscode.window.showInformationMessage('No active editor');
                    return;
                }

                const document = editor.document;

                // Only activate for supported languages
                const supportedLangs = ['clle', 'clp', 'cl', 'bnd'];
                if (!supportedLangs.includes(document.languageId)) {
                    vscode.window.showInformationMessage('CL Prompter: Not a supported IBM i source type.');
                    return;
                }

                // Get format options from configuration
                const config = vscode.workspace.getConfiguration('clPrompter');
                const formatOptions: FormatOptions = {
                    cvtcase: config.get('convertCmdAndParmNameCase', '*UPPER') as '*UPPER' | '*LOWER' | '*NONE',
                    indrmks: config.get('formatIndentComments', '*YES') as '*NO' | '*YES',
                    labelpos: config.get('formatLabelPosition', 2),
                    bgncol: config.get('formatCmdPosition', 14),
                    indcol: config.get('formatKwdPosition', 25),
                    indcont: config.get('formatContinuePosition', 27)
                };

                // Get all lines
                const allLines: string[] = [];
                for (let i = 0; i < document.lineCount; i++) {
                    allLines.push(document.lineAt(i).text);
                }

                // Format the entire file
                const formatted = formatCLSource(allLines, formatOptions, 0);

                // Replace entire document
                await editor.edit(editBuilder => {
                    const range = new vscode.Range(
                        0, 0,
                        document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length
                    );
                    editBuilder.replace(range, formatted.join('\n'));
                });

                vscode.window.showInformationMessage('CL file formatted');
            })
        );


    } catch (error) {
        console.error('[clPrompter] Activation error:', error);
        vscode.window.showErrorMessage(`Activation failed: ${error}`);
    }

    // Initialize the standalone CLPrompter API for external extensions
    // This must be done after ClPromptPanel is defined
    initializePrompter(ClPromptPanel, context.extensionUri);

    console.log('CL Prompter activate [end]');

    // Return API for external extensions
    return {
        CLPrompter,
        CLPrompterCallback
    };
}


export class ClPromptPanel {
    /** Map from source-file URI string → open prompter panel (one per file). */
    public static panels = new Map<string, ClPromptPanel>();
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _panelKey: string = '';
    private _disposables: vscode.Disposable[] = [];
    private _editor: vscode.TextEditor | undefined;
    private _selection: vscode.Selection | undefined;
    private _documentUri: vscode.Uri | undefined;

    // ✅ Added method to reset webview state
    public resetWebviewState() {
        console.log('[clPrompter] Resetting webview state');

        // ✅ Check if panel exists and use try-catch for webview access
        if (this._panel) {
            try {
                this._panel.webview.postMessage({ type: 'reset' });
            } catch (error) {
                console.warn('[clPrompter] Could not send reset message - webview may be disposed:', error);
            }
        } else {
            console.warn('[clPrompter] Cannot reset webview state - panel is null');
        }
    }

    /**
     * Creates a nested prompter for CMD/CMDSTR parameters
     * Returns a promise that resolves with the completed command string (unformatted)
     */
    public static async promptNestedCommand(extensionUri: vscode.Uri, commandString: string, parentPanel: ClPromptPanel): Promise<string | null> {
        return new Promise<string | null>(async (resolve) => {
            // Use the parent panel's view column to overlay in the same location
            const column = parentPanel._panel.viewColumn ?? vscode.ViewColumn.One;

            let cmdName = extractCmdName(commandString);
            const cmdLabel = extractCmdLabel(commandString);

            // Handle label-only lines in nested context
            if (!cmdName && cmdLabel) {
                console.log(`[clPrompter] Label-only nested line: ${cmdLabel}`);
                resolve(cmdLabel + ':');
                return;
            }

            if (!cmdName) {
                cmdName = (await askUserForCMDToPrompt(commandString)).toString();
            }
            if (!cmdName || cmdName.trim() === '') {
                resolve(null);
                return;
            }

            console.log(`[clPrompter] Nested prompt for: ${cmdName}`);
            const xml = await getCMDXML(cmdName);

            // Extract command prompt from XML for panel title
            let cmdPrompt = '';
            try {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xml, 'application/xml');
                const cmdNodes = xmlDoc.getElementsByTagName('Cmd');
                if (cmdNodes.length > 0) {
                    cmdPrompt = cmdNodes[0].getAttribute('Prompt') || '';
                }
            } catch (err) {
                console.error('[clPrompter] Failed to parse XML for command prompt:', err);
            }

            const panel = vscode.window.createWebviewPanel(
                'clPrompterNested',
                `${cmdName} Prompt (nested)`,
                column,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
                }
            );

            console.log('[promptNestedCommand] Creating nested panel instance');
            const nestedPanel = new ClPromptPanel(
                panel, extensionUri, cmdName, cmdLabel, xml, undefined, undefined, commandString, undefined, true, resolve);

            // Ensure promise resolves if panel is disposed without submitting
            panel.onDidDispose(() => {
                console.log('[promptNestedCommand] Panel disposed, checking if already resolved');
                // If not already resolved, resolve with null
                try {
                    resolve(null);
                } catch (e) {
                    // Promise already resolved, ignore
                    console.log('[promptNestedCommand] Promise already resolved');
                }

                // Reveal and restore the parent panel when nested panel closes
                console.log('[promptNestedCommand] Revealing parent panel');
                parentPanel._panel.reveal(column, false);
            });
        });
    }

    // ✅ Update createOrShow method around line 85
    public static async createOrShow(extensionUri: vscode.Uri): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        let fullCmd = '';
        let commandRange: { startLine: number; endLine: number } | undefined;
        let cmdComment: string | undefined;

        const editor = vscode.window.activeTextEditor;
        if (editor) {
            // ✅ Use extractFullCLCmd for the command string
            const cmdResult = collectCLCmd(editor);
            fullCmd = cmdResult.command;
            commandRange = { startLine: cmdResult.startLine, endLine: cmdResult.endLine };
            cmdComment = cmdResult.comment;

            // ✅ Optional: Verify both methods agree on the range
            console.log(`[clPrompter] Command range: ${commandRange.startLine}-${commandRange.endLine}`);
            console.log(`[clPrompter] Extract result: ${cmdResult.startLine}-${cmdResult.endLine}`);
            if (cmdComment) {
                console.log(`[clPrompter] Extracted comment: ${cmdComment}`);
            }
        }

        let cmdName = extractCmdName(fullCmd);
        const cmdLabel = extractCmdLabel(fullCmd);

        // ✅ Create selection that spans the entire command range (needed for all code paths)
        const selection = editor && commandRange
            ? new vscode.Selection(
                commandRange.startLine, 0,
                commandRange.endLine, editor.document.lineAt(commandRange.endLine).text.length
            )
            : undefined;

        // Key each panel by source-file URI so each file gets its own distinct panel.
        const panelKey = editor?.document.uri.toString() ?? 'no-file';

        // Handle label-only lines (e.g., "ENDPGM:")
        if (!cmdName && cmdLabel) {
            // Label-only line - create a minimal prompter with just Label and Comment fields
            console.log(`[clPrompter] Label-only line detected: ${cmdLabel}`);
            const existingPanel = ClPromptPanel.panels.get(panelKey);
            if (existingPanel) {
                existingPanel._panel.reveal(column);
                await existingPanel.setXML('', '', editor, selection, '', fullCmd, cmdLabel, cmdComment);
                return;
            }
            const panel = vscode.window.createWebviewPanel(
                'clPrompter',
                `Label: ${cmdLabel}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
                }
            );
            const instance = new ClPromptPanel(
                panel, extensionUri, '', cmdLabel, '', editor, selection, fullCmd, cmdComment);
            instance._panelKey = panelKey;
            ClPromptPanel.panels.set(panelKey, instance);
            return;
        }

        if (!cmdName) {
            cmdName = (await askUserForCMDToPrompt(fullCmd)).toString();
        }
        if (!cmdName || cmdName.trim() == '') {
            return;
        }

        console.log(`[clPrompter] About to call getCMDXML for: ${cmdName}`);
        const xml = await getCMDXML(cmdName);
        console.log(`[clPrompter] XML length: ${xml.length} characters`);
        console.log(`[clPrompter] XML starts with: ${xml.substring(0, 100)}`);
        console.log(`[clPrompter] XML ends with: ${xml.substring(xml.length - 100)}`);

        console.log("[clPrompter] <XML> ", xml);
        console.log("[clPrompter] </XML>");

// Write XML to cmdDefn.xml file for debugging (if enabled)
        const config = vscode.workspace.getConfiguration('clPrompter');
        const saveCmdXMLtoFile = config.get<boolean>('saveCmdXMLtoFile', false);

        if (saveCmdXMLtoFile && editor && editor.document.uri.fsPath) {
            const os = require('os');
            let xmlDir = config.get<string>('savedCmdXMLFileLocation') || '${tmpdir}';

            // Expand variables
            xmlDir = xmlDir
                .replace('${tmpdir}', os.tmpdir())
                .replace('${userHome}', os.homedir())
                .replace('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir());

            const xmlFilePath = path.join(xmlDir, 'cmdDefn.xml');
            console.log(`[clPrompter] Writing XML to: ${xmlFilePath}`);

            try {
                fs.writeFileSync(xmlFilePath, xml, { encoding: 'utf8' });
                console.log(`[clPrompter] ✓ XML successfully written to: ${xmlFilePath}`);
            } catch (err) {
                console.error(`[clPrompter] ✗ Failed to write XML file: ${err}`);
            }
        } else if (!saveCmdXMLtoFile) {
            console.log(`[clPrompter] Debug XML writing is disabled (saveCmdXMLtoFile=false)`);
        } else {
            const scheme = editor?.document.uri.scheme || 'unknown';
            console.log(`[clPrompter] No file path available (scheme: ${scheme}), skipping XML file write`);
        }

        // Extract command prompt from XML for panel title
        let cmdPrompt = '';
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xml, 'application/xml');
            const cmdNodes = xmlDoc.getElementsByTagName('Cmd');
            if (cmdNodes.length > 0) {
                cmdPrompt = cmdNodes[0].getAttribute('Prompt') || '';
            }
        } catch (err) {
            console.error('[clPrompter] Failed to parse XML for command prompt:', err);
        }

        // If cmdPrompt is empty the Cmd element has no Prompt attribute —
        // QCDRCMDD returned a placeholder because the command doesn't exist.
        // getCMDXML already showed the warning; just abort without opening a panel.
        if (!cmdPrompt) {
            console.log(`[clPrompter] '${cmdName}' returned no command definition — aborting prompter.`);
            // Touch the source line so the IBM-CLLE syntax checker fires and surfaces
            // the IBM i diagnostic alongside our popup warning.
            if (editor && commandRange) {
                const line = editor.document.lineAt(commandRange.startLine);
                await editor.edit(editBuilder => {
                    editBuilder.replace(line.range, line.text);
                });
            }
            return;
        }

        if (ClPromptPanel.panels.has(panelKey)) {
            const existingPanel = ClPromptPanel.panels.get(panelKey)!;
            existingPanel._panel.reveal(column);
            await existingPanel.setXML(cmdName, xml, editor, selection, cmdPrompt, fullCmd, cmdLabel, cmdComment);
        } else {
            const panel = vscode.window.createWebviewPanel(
                'clPrompter',
                cmdName ? `${cmdName} Prompt` : 'CL Prompt',
                column,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
                }
            );
            const instance = new ClPromptPanel(
                panel, extensionUri, cmdName, cmdLabel, xml, editor, selection, fullCmd, cmdComment);
            instance._panelKey = panelKey;
            ClPromptPanel.panels.set(panelKey, instance);
        }
    }

    private _cmdName: string;
    private _cmdLabel: string;
    private _cmdComment: string | undefined;
    private _xml: string;
    private _parmMetas: ParmMeta[] = [];
    private _parmMap: any = [];
    private _presentParms: Set<string> = new Set();
    private _sentFormData = false;
    private _isNested: boolean = false;
    private _nestedResolver?: (value: string | null) => void;

    constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        cmdName: string,
        cmdLabel: string,
        xml: string,
        editor?: vscode.TextEditor,
        selection?: vscode.Selection,
        fullCmd?: string,
        cmdComment?: string,
        isNested?: boolean,
        nestedResolver?: (value: string | null) => void
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._cmdName = cmdName;
        this._cmdLabel = cmdLabel;
        this._cmdComment = cmdComment;
        this._xml = xml;
        this._editor = editor;
        this._selection = selection;
        this._isNested = isNested || false;
        this._nestedResolver = nestedResolver;

        // In constructor and setXML:
        this._documentUri = editor?.document.uri;
        this._selection = selection;

        // For label-only lines (no command), skip parameter extraction from XML
        if (fullCmd && cmdName && cmdName.trim() !== '') {
            // 1) Extract metas then filter/sort by XML (skip Constant/NULL)
            this._parmMetas = extractParmMetas(xml);

            const throwawayKwds = getThrowawayKwdsFromXML(xml);
            // posOrder: sorted by PosNbr — used for prompter display ordering of _parmMetas
            const posOrder = getPositionalKwdsFromXML(xml);
            // posOrderByArrival: XML arrival order — used for binding positional values
            // IBM i matches unnamed (positional) parameters by the order PARM statements
            // appear in the command source, NOT by PosNbr.  PosNbr is display-only.
            const posOrderByArrival = getPositionalKwdsFromXMLByArrival(xml);
            const posIndex = new Map<string, number>();
            posOrder.forEach((k, i) => posIndex.set(k, i));

            // Filter metas by throwaways from XML
            this._parmMetas = this._parmMetas.filter(m => !throwawayKwds.has(String((m as any).Kwd || '').toUpperCase()));

            // Stable sort metas: positional first (by PosNbr/posOrder), then keep original order
            this._parmMetas = this._parmMetas
                .map((m, idx) => ({ m, idx, p: posIndex.get(String((m as any).Kwd || '').toUpperCase()) }))
                .sort((a, b) => {
                    const aHas = Number.isFinite(a.p as number);
                    const bHas = Number.isFinite(b.p as number);
                    if (aHas && bHas) return (a.p as number) - (b.p as number);
                    if (aHas && !bHas) return -1;
                    if (!aHas && bHas) return 1;
                    return a.idx - b.idx;
                })
                .map(x => x.m);

            // 2) MaxPos
            const maxPos = getMaxPos(xml);

            // 3) Rewrite leading positionals by XML arrival order, then parse
            console.log('[clPrompter] Full command before rewrite:', fullCmd);
            const cmdWithKeywords =
                (maxPos ?? 0) > 0 && posOrderByArrival.length > 0
                    ? rewriteLeadingPositionalsByList(fullCmd, posOrderByArrival, maxPos)
                    : fullCmd;
            console.log('[clPrompter] Full command after rewrite:', cmdWithKeywords);

            try {
                this._parmMap = parseCLParms(cmdWithKeywords, this._parmMetas);
                console.log('[clPrompter] parseCLParms keys:', Object.keys(this._parmMap));
                // Debug PARM specifically for CALL command
                if (this._parmMap['PARM']) {
                    console.log('[clPrompter] PARM immediately after parseCLParms:', JSON.stringify(this._parmMap['PARM']));
                    console.log('[clPrompter] PARM length:', this._parmMap['PARM'].length);
                }
                // Debug RMTFILE specifically
                if (this._parmMap['RMTFILE']) {
                    console.log('[clPrompter] RMTFILE immediately after parseCLParms:', JSON.stringify(this._parmMap['RMTFILE']));
                }
            } catch (e) {
                console.warn('[clPrompter] parseCLParms failed on rewritten:', e);
                this._parmMap = {};
            }

            // 4) Drop Constant/NULL keys from the parsed map (safety), then order by metas
            if (Object.keys(this._parmMap).length) {
                const filtered: Record<string, any> = {};
                for (const [k, v] of Object.entries(this._parmMap)) {
                    if (!throwawayKwds.has(k.toUpperCase())) filtered[k] = v;
                }
                this._parmMap = orderParmMapByMetas(this._parmMetas, filtered);
                // Debug RMTFILE after ordering
                if (this._parmMap['RMTFILE']) {
                    console.log('[clPrompter] RMTFILE after orderParmMapByMetas:', JSON.stringify(this._parmMap['RMTFILE']));
                }
            }

            // 5) Present parms
            this._presentParms = new Set(Object.keys(this._parmMap));
        }

        console.log('[clPrompter] Parameter Map:', this._parmMap);
        if (this._parmMap['EXTRA']) {
            console.log('[clPrompter] EXTRA parameter parsed value:', JSON.stringify(this._parmMap['EXTRA'], null, 2));
        }

        this._disposables.push(
            panel.webview.onDidReceiveMessage(message => {
                if (message.type === 'webviewReady') {
                // Prevent duplicate formData sends
                if (this._sentFormData) {
                    console.log('[clPrompter] webviewReady ignored; formData already sent');
                    return;
                }
                console.log('[clPrompter] Sending processed data to webview');

                // For label-only lines (no command), skip XML processing and just send label/comment
                if (!this._cmdName || this._cmdName.trim() === '') {
                    console.log('[clPrompter] Label-only prompter (webviewReady), skipping XML processing');
                    panel.webview.postMessage({ type: "setLabel", label: this._cmdLabel, comment: this._cmdComment });
                    this._sentFormData = true;
                    return;
                }

                // Extract command prompt from XML
                let cmdPrompt = '';
                try {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(this._xml, 'application/xml');
                    const cmdNodes = xmlDoc.getElementsByTagName('Cmd');
                    console.log('[clPrompter] webviewReady: Found', cmdNodes.length, 'Cmd nodes');
                    if (cmdNodes.length > 0) {
                        const cmdNode = cmdNodes[0];
                        console.log('[clPrompter] webviewReady: Cmd attributes:', {
                            CmdName: cmdNode.getAttribute('CmdName'),
                            Prompt: cmdNode.getAttribute('Prompt'),
                            prompt: cmdNode.getAttribute('prompt')
                        });
                        cmdPrompt = cmdNode.getAttribute('Prompt') || '';
                    }
                } catch (err) {
                    console.error('[clPrompter] webviewReady: Failed to parse XML for command prompt:', err);
                }

                console.log('[clPrompter] webviewReady: Extracted cmdPrompt:', cmdPrompt);

                const t0 = Date.now();
                const { allowedValsMap, depConstraints, valToMapToMap, defaultValMap, pmtCtlMap } = buildAllMaps(this._xml);
                console.log(`[clPrompter] buildAllMaps took ${Date.now() - t0}ms`);
                const config = vscode.workspace.getConfiguration('clPrompter');
                const keywordColor = config.get('kwdColor');
                const valueColor = config.get('kwdValueColor');
                const autoAdjust = config.get('kwdColorAutoAdjust');
                const convertParmValueToUpperCase = config.get('convertParmValueToUpperCase', true);
                const parmExpansionMax = config.get('parmExpansionMax', 5000);
                const parmExpansionSize = config.get('parmExpansionSize', 16);

                panel.webview.postMessage({
                    type: 'formData',
                    xml: this._xml,
                    allowedValsMap,
                    depConstraints,
                    valToMapToMap,
                    defaultValMap,
                    pmtCtlMap,
                    cmdName: this._cmdName,
                    cmdPrompt: cmdPrompt,
                    paramMap: this._parmMap,
                    parmMap: this._parmMap,
                    parmMetas: this._parmMetas,
                    config: { keywordColor, valueColor, autoAdjust, convertParmValueToUpperCase, parmExpansionMax, parmExpansionSize }
                });
                panel.webview.postMessage({ type: "setLabel", label: this._cmdLabel, comment: this._cmdComment });
                this._sentFormData = true;
            }
        })
        );

        this.getHtmlForPrompter(this._panel.webview, this._cmdName, this._xml)
            .then(html => {
                this._panel.webview.html = html;
            })
            .catch(err => {
                console.error('[clPrompter] Error generating HTML:', err);
            });

        // Listen for when the panel becomes visible again (e.g., after nested prompt closes)
        this._panel.onDidChangeViewState(
            e => {
                if (e.webviewPanel.visible && !this._isNested) {
                    console.log('[clPrompter] Panel became visible, ensuring webview is ready');
                    // The webview might have lost its state, so we trigger a refresh
                    // by checking if it needs reinitialization
                    this._panel.webview.postMessage({ type: 'ping' });
                }
            },
            null,
            this._disposables
        );

        // ✅ Fix around line 245 in constructor
        this._panel.onDidDispose(() => {
            console.log('[clPrompter] Panel disposed');

            // ✅ DON'T call this.dispose() here - it creates recursion
            // ✅ Just clean up the static reference and disposables
            if (this._panelKey) { ClPromptPanel.panels.delete(this._panelKey); }

            while (this._disposables.length) {
                const disposable = this._disposables.pop();
                if (disposable) {
                    disposable.dispose();
                }
            }
        }, null, this._disposables);

        // ...inside the ClPromptPanel class constructor...
        this._panel.webview.onDidReceiveMessage(
            async message => {
                switch (message.type) {
                    case 'submit': {

                        console.log('[submit] this._cmdName:', this._cmdName);
                        console.log('[submit] Received cmdName:', message.cmdName);
                        console.log('[submit] message.values:', message.values);

                        // Handle label-only lines (no command)
                        if (!this._cmdName || this._cmdName.trim() === '') {
                            console.log('[submit] Label-only line, skipping XML processing');

                            // Extract comment from values if present (normalize newlines to spaces)
                            const submittedComment = message.values['comment'] as string | undefined;
                            const normalizedComment = submittedComment ? submittedComment.replace(/\r\n|\n|\r/g, ' ') : submittedComment;
                            const finalComment = normalizedComment || (this._cmdComment ? this._cmdComment.replace(/\r\n|\n|\r/g, ' ') : this._cmdComment);

                            // Format label-only line directly (bypass tokenizer/parser)
                            const config = vscode.workspace.getConfiguration('clPrompter');
                            const labelPosition = config.get<number>('formatLabelPosition', 2);
                            const labelPad = ' '.repeat(Math.max(0, labelPosition - 1));

                            let formatted = `${labelPad}${this._cmdLabel}:`;
                            if (finalComment && finalComment.trim()) {
                                formatted += ' ' + finalComment.trim();
                            }

                            console.log('[submit] Label-only formatted output:', formatted);

                            // If this is a nested prompter, resolve with formatted label
                            if (this._isNested && this._nestedResolver) {
                                console.log('[submit] Nested prompter resolving with label:', formatted);
                                this._nestedResolver(formatted);
                                this._panel.dispose();
                                break;
                            }

                            // Insert the formatted label back into the document
                            if (this._documentUri && this._selection) {
                                vscode.workspace.openTextDocument(this._documentUri).then(doc => {
                                    vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true }).then(editor => {
                                        const eol = doc.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
                                        const formattedWithEOL = formatted.split(/\r?\n/).join(eol);
                                        editor.edit(editBuilder => {
                                            editBuilder.replace(this._selection!, formattedWithEOL);
                                        }).then(success => {
                                            if (!success) {
                                                vscode.window.showWarningMessage('Failed to insert label. Try again.');
                                            }
                                            // Transfer focus back to editor before disposing
                                            vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false }).then(() => {
                                                this._panel.dispose();
                                            });
                                        });
                                    });
                                });
                            } else {
                                vscode.window.showWarningMessage(
                                    'Could not insert label: original editor is no longer open.'
                                );
                                vscode.env.clipboard.writeText(formatted);
                                vscode.window.showInformationMessage('Label copied to clipboard.');
                                this._panel.dispose();
                            }
                            break;
                        }

                        console.log('[submit] Raw message.values:');
                        Object.keys(message.values).forEach(key => {
                            console.log(`  ${key}: "${message.values[key]}"`);
                        });
                        // Check specifically for TOPGMQ patterns
                        const topgmqKeys = Object.keys(message.values).filter(k => k.startsWith('TOPGMQ'));
                        console.log('[submit] TOPGMQ keys found:', topgmqKeys);

                        // ✅ Add debugging for nested ELEM detection
                        const { allowedValsMap, parmTypeMap } = extractAllowedValsAndTypes(this._xml);
                        console.log('[submit] allowedValsMap keys:', Object.keys(allowedValsMap));
                        console.log('[submit] parmTypeMap:', parmTypeMap);

                        // ✅ Check for ELEM parameters specifically
                        Object.keys(message.values).forEach(key => {
                            if (key.includes('_ELEM')) {
                                console.log(`[submit] ELEM parameter ${key}:`, message.values[key]);
                                console.log(`[submit] Type for ${key}:`, parmTypeMap[key]);
                            }
                        });

                        const defaults = extractDefaultsFromXML(this._xml);
                        console.log('[submit] Extracted defaults:', JSON.stringify(defaults, null, 2));

                        // Debug specific parameters
                        if (defaults['SRCSEQ']) {
                            console.log('[submit] SRCSEQ default:', defaults['SRCSEQ']);
                        }
                        if (defaults['INCREL']) {
                            console.log('[submit] INCREL default:', defaults['INCREL']);
                        }
                        if (message.values['SRCSEQ']) {
                            console.log('[submit] SRCSEQ value from form:', message.values['SRCSEQ']);
                        }
                        if (message.values['INCREL']) {
                            console.log('[submit] INCREL value from form:', message.values['INCREL']);
                        }

                        // Extract comment from values if present (normalize newlines to spaces)
                        const submittedComment = message.values['comment'] as string | undefined;
                        const normalizedComment = submittedComment ? submittedComment.replace(/\r\n|\n|\r/g, ' ') : submittedComment;

                        // Get the case conversion setting for parameter values
                        const config = vscode.workspace.getConfiguration('clPrompter');
                        const convertParmValueToUpperCase = config.get('convertParmValueToUpperCase', true);

                        let cmd = buildCLCommand(
                            this._cmdName,
                            message.values,
                            defaults,
                            allowedValsMap,
                            parmTypeMap,
                            this._parmMetas,
                            this._presentParms,
                            undefined,
                            convertParmValueToUpperCase
                        );

                        // Append comment if present (use normalized comment)
                        const finalComment = normalizedComment || (this._cmdComment ? this._cmdComment.replace(/\r\n|\n|\r/g, ' ') : this._cmdComment);
                        if (finalComment && finalComment.trim()) {
                            cmd += ' ' + finalComment.trim();
                        }
                        console.log(`Post Prompter CL Cmd: ${cmd}`);
                        const parts = extractParms(cmd);
                        for (const p of parts) {
                            console.log(`PARM: ${p.kwd} VALUE: ${p.value}`); // p.value preserves inner (1 64)
                        }

                        // Extract trailing comment from cmd if present
                        let trailingComment: string | undefined;
                        const commentMatch = cmd.match(/\s*(\/\*.*?\*\/)\s*$/);
                        if (commentMatch) {
                            trailingComment = commentMatch[1];
                            // Remove comment from cmd for parameter extraction
                            cmd = cmd.substring(0, cmd.lastIndexOf(trailingComment)).trim();
                        }

                        // Extract label and param string for formatting
                        const label = extractCmdLabel(cmd);
                        const cmdName = extractCmdName(cmd);
                        // Remove label and command name from the start to get the parm string
                        let parmStr = cmd;
                        if (label && label.length > 0) {
                            parmStr = parmStr.substring(label.length + 1).trim();
                        }
                        if (cmdName && parmStr.startsWith(cmdName)) {
                            parmStr = parmStr.substring(cmdName.length).trim();
                        }

                        // If this is a nested prompter, resolve with unformatted command and close
                        if (this._isNested && this._nestedResolver) {
                            console.log('[submit] Nested prompter resolving with:', cmd);
                            this._nestedResolver(cmd);
                            this._panel.dispose();
                            break;
                        }

                        // Format the command - the formatter now preserves CMD/CMDSTR parameter spacing
                        // eslint-disable-next-line @typescript-eslint/no-var-requires
                        const { formatCLCmd } = require('./tokenizeCL');
                        const formatted = formatCLCmd(label, cmdName, parmStr, trailingComment);

                        // Use the active document's EOL
                        if (this._documentUri && this._selection) {
                            vscode.workspace.openTextDocument(this._documentUri).then(doc => {
                                vscode.window.showTextDocument(doc, { preview: false, preserveFocus: true }).then(editor => {
                                    const eol = doc.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
                                    const formattedWithEOL = formatted.split(/\r?\n/).join(eol);
                                    editor.edit(editBuilder => {
                                        editBuilder.replace(this._selection!, formattedWithEOL);
                                    }).then(success => {
                                        if (!success) {
                                            vscode.window.showWarningMessage('Failed to insert CL command. Try again.');
                                        }
                                        // Transfer focus back to editor before disposing
                                        vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false }).then(() => {
                                            this._panel.dispose();
                                        });
                                    });
                                });
                            });
                        } else {
                            vscode.window.showWarningMessage(
                                'Could not insert command: original editor is no longer open.'
                            );
                            vscode.env.clipboard.writeText(formatted);
                            vscode.window.showInformationMessage('CL command copied to clipboard.');
                            this._panel.dispose();
                        }
                        break;
                    }
                    case 'cancel': {
                        // If this is a nested prompter, resolve with null
                        if (this._isNested && this._nestedResolver) {
                            this._nestedResolver(null);
                        }
                        // Return focus to editor before disposing
                        if (this._documentUri) {
                            vscode.workspace.openTextDocument(this._documentUri).then(doc => {
                                vscode.window.showTextDocument(doc, { preview: false, preserveFocus: false }).then(() => {
                                    this._panel.dispose();
                                });
                            });
                        } else {
                            this._panel.dispose();
                        }
                        break;
                    }
                    case 'promptNested': {
                        console.log('[promptNested] Request to prompt nested command:', message.commandString);
                        console.log('[promptNested] Field ID:', message.fieldId);
                        const result = await ClPromptPanel.promptNestedCommand(
                            this._extensionUri,
                            message.commandString,
                            this
                        );
                        console.log('[promptNested] Result from nested prompt:', result);
                        if (result) {
                            console.log('[promptNested] Sending result back to parent webview for field:', message.fieldId);
                            // Send result back to webview
                            this._panel.webview.postMessage({
                                type: 'nestedResult',
                                fieldId: message.fieldId,
                                commandString: result
                            });
                        } else {
                            console.log('[promptNested] No result (cancelled or empty)');
                        }
                        break;
                    }
                    case 'loadForm': {
                        // Ignore if already sent
                        if (this._sentFormData) {
                            console.log('[clPrompter] loadForm ignored; formData already sent');
                            break;
                        }

                        // For label-only lines (no command), skip XML processing and just send label/comment
                        if (!this._cmdName || this._cmdName.trim() === '') {
                            console.log('[clPrompter] Label-only prompter, skipping XML processing');
                            this._panel.webview.postMessage({ type: 'setLabel', label: this._cmdLabel, comment: this._cmdComment });
                            this._sentFormData = true;
                            break;
                        }

                        // Extract command prompt from XML BEFORE sending messages
                        let cmdPrompt = '';
                        try {
                            const parser = new DOMParser();
                            const xmlDoc = parser.parseFromString(this._xml, 'application/xml');
                            const cmdNodes = xmlDoc.getElementsByTagName('Cmd');
                            console.log('[clPrompter] Found', cmdNodes.length, 'Cmd nodes');
                            if (cmdNodes.length > 0) {
                                const cmdNode = cmdNodes[0];
                                console.log('[clPrompter] Cmd attributes:', {
                                    CmdName: cmdNode.getAttribute('CmdName'),
                                    Prompt: cmdNode.getAttribute('Prompt'),
                                    prompt: cmdNode.getAttribute('prompt')
                                });
                                cmdPrompt = cmdNode.getAttribute('Prompt') || '';
                            }
                        } catch (err) {
                            console.error('[clPrompter] Failed to parse XML for command prompt:', err);
                        }

                        console.log('[clPrompter] Extracted cmdPrompt:', cmdPrompt);
                        console.log('[clPrompter] About to send formData with cmdName:', this._cmdName, 'cmdPrompt:', cmdPrompt);

                        this._panel.webview.postMessage({ type: 'formXml', xml: this._xml, cmdName: this._cmdName, cmdPrompt: cmdPrompt });
                        this._panel.webview.postMessage({ type: 'setLabel', label: this._cmdLabel, comment: this._cmdComment });

                        const { allowedValsMap, depConstraints, valToMapToMap, defaultValMap } = buildAllMaps(this._xml);
                        const config = vscode.workspace.getConfiguration('clPrompter');
                        const keywordColor = config.get('kwdColor');
                        const valueColor = config.get('kwdValueColor');
                        const autoAdjust = config.get('kwdColorAutoAdjust');
                        const parmExpansionMax = config.get('parmExpansionMax', 5000);
                        const parmExpansionSize = config.get('parmExpansionSize', 16);

                        console.log('[clPrompter] loadForm → sending formData with keys:', Object.keys(this._parmMap || {}));

                        this._panel.webview.postMessage({
                            type: 'formData',
                            xml: this._xml,
                            allowedValsMap,
                            depConstraints,
                            valToMapToMap,
                            defaultValMap,
                            cmdName: this._cmdName,
                            cmdPrompt: cmdPrompt,
                            parmMap: this._parmMap,
                            paramMap: this._parmMap,
                            parmMetas: this._parmMetas,
                            config: { keywordColor, valueColor, autoAdjust, parmExpansionMax, parmExpansionSize }
                        });
                        this._sentFormData = true;
                        break;
                    }
                    case 'pong': {
                        // Webview responded to ping - check if it needs reinitialization
                        console.log('[clPrompter] Received pong, hasProcessedFormData:', message.hasProcessedFormData);
                        if (!message.hasProcessedFormData && !this._sentFormData) {
                            console.log('[clPrompter] Webview needs reinitialization, resending formData');

                            // For label-only lines (no command), skip XML processing and just send label/comment
                            if (!this._cmdName || this._cmdName.trim() === '') {
                                console.log('[clPrompter] Label-only prompter (pong), skipping XML processing');
                                this._panel.webview.postMessage({ type: 'setLabel', label: this._cmdLabel, comment: this._cmdComment });
                                this._sentFormData = true;
                                break;
                            }

                            // Resend the form data to reinitialize the webview
                            const { allowedValsMap, depConstraints, valToMapToMap, defaultValMap } = buildAllMaps(this._xml);
                            const config = vscode.workspace.getConfiguration('clPrompter');
                            const keywordColor = config.get('kwdColor');
                            const valueColor = config.get('kwdValueColor');
                            const autoAdjust = config.get('kwdColorAutoAdjust');
                            const parmExpansionMax = config.get('parmExpansionMax', 5000);
                            const parmExpansionSize = config.get('parmExpansionSize', 16);

                            let cmdPrompt = '';
                            try {
                                const parser = new DOMParser();
                                const xmlDoc = parser.parseFromString(this._xml, 'application/xml');
                                const cmdNodes = xmlDoc.getElementsByTagName('Cmd');
                                if (cmdNodes.length > 0) {
                                    cmdPrompt = cmdNodes[0].getAttribute('Prompt') || '';
                                }
                            } catch (err) {
                                console.error('[clPrompter] Failed to parse XML for command prompt:', err);
                            }

                            this._panel.webview.postMessage({
                                type: 'formData',
                                xml: this._xml,
                                allowedValsMap,
                                depConstraints,
                                valToMapToMap,
                                defaultValMap,
                                cmdName: this._cmdName,
                                cmdPrompt: cmdPrompt,
                                parmMap: this._parmMap,
                                paramMap: this._parmMap,
                                parmMetas: this._parmMetas,
                                config: { keywordColor, valueColor, autoAdjust, parmExpansionMax, parmExpansionSize }
                            });
                            this._panel.webview.postMessage({ type: 'setLabel', label: this._cmdLabel, comment: this._cmdComment });
                            this._sentFormData = true;
                        }
                        break;
                    }
                    case 'getParamHelp': {
                        const kwd: string = message.kwd || '';
                        const cmdName: string = message.cmdName || this._cmdName || '';
                        console.log(`[clPrompter] getParamHelp: kwd=${kwd}, cmdName=${cmdName}`);
                        try {
                            // Tier 0: per-keyword UDTF cache (populated by Tier 1 on first call)
                            const helpCacheKey = `${cmdName.toUpperCase()}.${kwd.toUpperCase()}`;
                            const cachedUdtfHtml = clpHelpCache.get(helpCacheKey);
                            if (cachedUdtfHtml) {
                                this._panel.webview.postMessage({ type: 'paramHelp', kwd, title: kwd, helpHtml: cachedUdtfHtml });
                                break;
                            }
                            // Tier 1: CMD_HELP UDTF (fast path — Mapepire, no PASE, no JVM)
                            {
                                const slashIdx = cmdName.indexOf('/');
                                const cmdLib = slashIdx >= 0 ? cmdName.substring(0, slashIdx).toUpperCase() : '*LIBL';
                                const cmdObj = slashIdx >= 0 ? cmdName.substring(slashIdx + 1).toUpperCase() : cmdName.toUpperCase();
                                const udtfHtml = await getCmdHelpViaUDTF(cmdLib, cmdObj, kwd);
                                if (udtfHtml) {
                                    clpHelpCache.set(helpCacheKey, udtfHtml);
                                    this._panel.webview.postMessage({ type: 'paramHelp', kwd, title: kwd, helpHtml: udtfHtml });
                                    break;
                                }
                            }

                            // Tier 2 + Tier 3: GENCMDDOC path — only when parmHelpText=GENCMDDOC
                            const useGencmddoc = vscode.workspace.getConfiguration('clPrompter').get<string>('parmHelpText', 'CMD_HELP UDTF') === 'GENCMDDOC';
                            if (!useGencmddoc) {
                                this._panel.webview.postMessage({
                                    type: 'paramHelpError', kwd,
                                    error: `No CMD_HELP data found for PARM ${kwd} in ${cmdName}.`
                                });
                                break;
                            }

                            // Check our own PASE-populated cache first.
                            // If the command was pre-fetched via PASE, serve it directly
                            // without touching vscode-clle or the Mapepire connection.
                            const cachedHtml = clpDocCache.get(cmdName.toUpperCase());
                            if (cachedHtml) {
                                const rawHtml = extractParamHtml(cachedHtml, cmdName, kwd);
                                if (rawHtml) {
                                    this._panel.webview.postMessage({ type: 'paramHelp', kwd, title: kwd, helpHtml: rawHtml });
                                    break;
                                }
                                // extractParamHtml returned null — param section not found in cached HTML;
                                // fall through to vscode-clle which may have a different/newer version
                            }

                            const clleExt = vscode.extensions.getExtension<any>('IBM.vscode-clle');
                            if (!clleExt) {
                                this._panel.webview.postMessage({
                                    type: 'paramHelpError', kwd,
                                    error: 'IBM.vscode-clle extension is not installed.'
                                });
                                break;
                            }
                            const api = clleExt.isActive ? clleExt.exports : await clleExt.activate();
                            const result = await api.genCmdDoc.getCLDoc(cmdName);
                            if (!result?.doc) {
                                this._panel.webview.postMessage({
                                    type: 'paramHelpError', kwd,
                                    error: `No documentation found for command ${cmdName}. Check your IBM i connection.`
                                });
                                break;
                            }
                            const detail = result.doc.parameters.details.find(
                                (p: { name: string }) => p.name.toUpperCase() === kwd.toUpperCase()
                            );
                            if (!detail) {
                                this._panel.webview.postMessage({
                                    type: 'paramHelpError', kwd,
                                    error: `No help found for PARM ${kwd} in ${cmdName}.`
                                });
                                break;
                            }
                            // Extract the raw parameter HTML from the GENCMDDOC document
                            // (same source vscode-clle uses for its panel display).
                            // Fall back to the Markdown description if extraction fails.
                            const rawHtml = extractParamHtml(result.html, cmdName, kwd);
                            this._panel.webview.postMessage({
                                type: 'paramHelp',
                                kwd,
                                title: detail.name,
                                helpHtml: rawHtml ?? `<p>${detail.description.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`
                            });
                        } catch (err) {
                            console.error('[clPrompter] getParamHelp error:', err);
                            this._panel.webview.postMessage({
                                type: 'paramHelpError', kwd,
                                error: `Error retrieving help: ${err instanceof Error ? err.message : String(err)}`
                            });
                        }
                        break;
                    }
                }
            },
            undefined,
            this._disposables
        );
    }

    // ✅ Update setXML to handle multi-line commands
    public async setXML(cmdName: string, xml: string, editor?: vscode.TextEditor, selection?: vscode.Selection, cmdPrompt?: string, fullCmd?: string, cmdLabel?: string, cmdComment?: string) {
        console.log('[clPrompter] setXML called - resetting state');
        this.resetWebviewState();
        this._sentFormData = false; // allow new formData send
        console.log('[clPrompter] setXML finished resetting state');

        this._cmdName = cmdName;
        this._xml = xml;
        this._editor = editor;
        this._selection = selection;
        if (cmdLabel !== undefined) { this._cmdLabel = cmdLabel; }
        if (cmdComment !== undefined) { this._cmdComment = cmdComment; }

        // ✅ Update document URI to current editor
        this._documentUri = editor?.document.uri;

        // Update panel title
        if (cmdName) {
            this._panel.title = `${cmdName} Prompt`;
        }

        // Rebuild parm maps for the new command so pre-populated values are correct
        this._parmMetas = [];
        this._parmMap = {};
        this._presentParms = new Set();
        if (fullCmd && cmdName && cmdName.trim() !== '') {
            this._parmMetas = extractParmMetas(xml);
            const throwawayKwds = getThrowawayKwdsFromXML(xml);
            const posOrder = getPositionalKwdsFromXML(xml);
            const posOrderByArrival = getPositionalKwdsFromXMLByArrival(xml);
            const posIndex = new Map<string, number>();
            posOrder.forEach((k, i) => posIndex.set(k, i));
            this._parmMetas = this._parmMetas.filter(m => !throwawayKwds.has(String((m as any).Kwd || '').toUpperCase()));
            this._parmMetas = this._parmMetas
                .map((m, idx) => ({ m, idx, p: posIndex.get(String((m as any).Kwd || '').toUpperCase()) }))
                .sort((a, b) => {
                    const aHas = Number.isFinite(a.p as number);
                    const bHas = Number.isFinite(b.p as number);
                    if (aHas && bHas) return (a.p as number) - (b.p as number);
                    if (aHas && !bHas) return -1;
                    if (!aHas && bHas) return 1;
                    return a.idx - b.idx;
                })
                .map(x => x.m);
            const maxPos = getMaxPos(xml);
            const cmdWithKeywords =
                (maxPos ?? 0) > 0 && posOrderByArrival.length > 0
                    ? rewriteLeadingPositionalsByList(fullCmd, posOrderByArrival, maxPos)
                    : fullCmd;
            try {
                this._parmMap = parseCLParms(cmdWithKeywords, this._parmMetas);
            } catch (e) {
                console.warn('[clPrompter] setXML: parseCLParms failed:', e);
                this._parmMap = {};
            }
            if (Object.keys(this._parmMap).length) {
                const filtered: Record<string, any> = {};
                for (const [k, v] of Object.entries(this._parmMap)) {
                    if (!throwawayKwds.has(k.toUpperCase())) { filtered[k] = v; }
                }
                this._parmMap = orderParmMapByMetas(this._parmMetas, filtered);
            }
            this._presentParms = new Set(Object.keys(this._parmMap));
        }

        const html = await this.getHtmlForPrompter(this._panel.webview, this._cmdName, this._xml);
        this._panel.webview.html = html;
        // Fire-and-forget after the panel is rendered so it appears instantly.
        // GENCMDDOC runs concurrently; by the time the user clicks ?, it's cached.
        this._prefetchCLDoc(cmdName);
    }


    // ✅ Fix the dispose method around line 290
    public dispose() {
        console.log('[clPrompter] Disposing ClPromptPanel');

        // ✅ Clear the panel map entry BEFORE disposing
        if (this._panelKey) { ClPromptPanel.panels.delete(this._panelKey); }

        // ✅ Dispose of the panel LAST
        this._panel.dispose();

        // ✅ Clean up disposables after panel is disposed
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    /**
     * Fire-and-forget pre-fetch of vscode-clle's GENCMDDOC cache for `cmdName`.
     * Only runs if IBM.vscode-clle is already active (avoids blocking panel open).
     * On the second call for the same command the result returns instantly from
     * vscode-clle's own static cache.
     */
    private _prefetchCLDoc(cmdName: string): void {
        if (!cmdName) { return; }
        // Already in our own PASE cache — getParamHelp will serve it from there,
        // no need to also warm vscode-clle's ileQueue-backed cache.
        if (clpDocCache.has(cmdName.toUpperCase())) { return; }
        const clleExt = vscode.extensions.getExtension<any>('IBM.vscode-clle');
        if (!clleExt) { return; }
        const t0 = Date.now();
        console.log(`[clPrompter] Pre-fetching GENCMDDOC for ${cmdName}…`);
        // Activate vscode-clle if needed — this is fire-and-forget so it never
        // blocks the prompter panel, but means the cache is warm by first ? click
        // even on the very first prompt of a session when vscode-clle isn't active yet.
        (clleExt.isActive ? Promise.resolve(clleExt.exports) : Promise.resolve(clleExt.activate()))
            .then((api: any) => {
                if (!api?.genCmdDoc?.getCLDoc) { return; }
                return api.genCmdDoc.getCLDoc(cmdName);
            })
            .then(() => console.log(`[clPrompter] GENCMDDOC pre-fetch for ${cmdName} done in ${Date.now() - t0}ms`))
            .catch((e: any) => console.log(`[clPrompter] GENCMDDOC pre-fetch for ${cmdName} failed (non-critical): ${e?.message ?? e}`));
    }

    private async getHtmlForPrompter(webview: vscode.Webview, cmdString: string, xml: string): Promise<string> {
        const nonce = getNonce();
        const cmdName = buildAPI2PartName(cmdString);

        const prompter = await getHtmlForPrompter(webview, this._extensionUri, cmdString, xml, nonce);
        // console.log("[clPrompter] HTML generated for Prompter: ", prompter);
        return prompter;
    }
}

// Export the CLPrompter function for use by external extensions
// Note: The function is initialized in activate() after the extension context is available
export { CLPrompter, CLPrompterCallback };

// Build ordered positional KWDs from ParmMetaMap.posNbr
function getPositionalKwdsFromMetaMap(meta: ParmMetaMap | undefined): string[] {
  if (!meta) return [];
  return Object.entries(meta)
    .filter(([, m]) => typeof m.posNbr === 'number' && (m.posNbr as number) > 0)
    .sort((a, b) => (a[1].posNbr as number) - (b[1].posNbr as number))
    .map(([kwd]) => kwd);
}

// Quote/paren-aware extraction for each KWD
function buildOriginalParmMapFromLine(cmdLine: string, meta: ParmMetaMap | undefined, cmdMaxPos?: number): Record<string, any> {
  const map: Record<string, any> = {};
  const positionalKwds = getPositionalKwdsFromMetaMap(meta);

  const normalized = positionalKwds.length
    ? rewriteLeadingPositionalsByList(cmdLine, positionalKwds, cmdMaxPos)
    : cmdLine;

  const kwds = meta ? Object.keys(meta) : [];
  for (const kwd of kwds) {
    const arg = safeExtractKwdArg(normalized, kwd);
    if (arg != null) map[kwd] = arg.trim();
  }
  return map;
}

// ...existing helpers...
function getPosNbr(m: any): number {
    const raw = m?.PosNbr ?? m?.Pos ?? m?.Position ?? m?.PosNum ?? m?.PosNumber;
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

function sortParmMetasAndMap(parmMetas: ParmMeta[], parmMap: Record<string, any>) {
    // Stable sort: positional before non-positional; equal → keep original order
    const metasWithIdx = (parmMetas ?? []).map((m, idx) => ({ m, idx, pos: getPosNbr(m) }));
    metasWithIdx.sort((a, b) => {
        const aPos = a.pos, bPos = b.pos;
        if (aPos === bPos) return a.idx - b.idx;
        if (aPos === Number.POSITIVE_INFINITY) return 1;
        if (bPos === Number.POSITIVE_INFINITY) return -1;
        return aPos - bPos;
    });
    const metas = metasWithIdx.map((x) => x.m);

    // Case-insensitive rebuild of the parm map in that order
    const upperMap = new Map<string, { key: string; val: any }>();
    for (const k of Object.keys(parmMap)) {
        upperMap.set(k.toUpperCase(), { key: k, val: parmMap[k] });
    }

    const ordered: Record<string, any> = {};
    for (const x of metasWithIdx) {
        const kwd = String((x.m as any).Kwd || '');
        if (!kwd) continue;
        const hit = upperMap.get(kwd.toUpperCase());
        if (hit) {
            ordered[kwd] = hit.val; // preserve original value; key uses meta’s Kwd
            upperMap.delete(kwd.toUpperCase());
        }
    }
    // Append any leftover keys (unexpected but safe)
    for (const { key, val } of upperMap.values()) {
        ordered[key] = val;
    }

    return { metas, ordered };
}


// Utility: Extract CL command name from editor or prompt user
async function askUserForCMDToPrompt(cmdString: string): Promise<Buffer> {

    let libName = '';
    let cmdName = '';
    // If input contains spaces, treat as full CL command string
    if (cmdString && cmdString.trim() !== '') {
        return Buffer.from(buildAPI2PartName(cmdString));
    }

    // Prompt if not found
    const input = await vscode.window.showInputBox({
        prompt: 'Type Command Name to Prompt:  <library/>cmdName',
        placeHolder: 'e.g. SNDPGMMSG or COZTOOLS/RTVJOBDA',
        validateInput: v => {
            const m = v.match(/^([A-Z0-9_$#@]+)(?:\/([A-Z0-9_$#@]+))?$/i);
            return m ? undefined : 'Enter CMD or LIB/CMD';
        }
    });
    return input ? Buffer.from(buildAPI2PartName(input)) : Buffer.from('');
}


function extractCmdName(cmdString: string): string {
    // Remove leading/trailing whitespace
    let str = cmdString.trim();
    // Split into tokens
    let tokens = str.split(/\s+/);
    // If first token ends with a colon, it's a label
    if (tokens[0].endsWith(':')) {
        tokens.shift();
    }
    // The next token is the command (possibly qualified)
    if (tokens.length > 0) {
        // Return the command name (qualified or not)
        return tokens[0];
    }
    return '';
}

function extractCmdLabel(cmdString: string): string {
    let str = cmdString.trim();
    let tokens = str.split(/\s+/);
    if (tokens[0].endsWith(':')) {
        // Remove the colon and return the label
        return tokens[0].slice(0, -1);
    }
    return '';
}


function skipQuoted(str: string, i: number): number {
    const quote = str[i];
    i++; // move past opening quote
    while (i < str.length) {
        if (str[i] === quote) {
            if (str[i + 1] === quote) { // escaped ''
                i += 2;
                continue
            }
            return i + 1; // position after closing quote
        }
        i++;
    }
    return i;
}

function findMatchingParen(str: string, openIdx: number): number {
    let i = openIdx;
    let depth = 0;
    while (i < str.length) {
        const ch = str[i];
        if (ch === "'" || ch === '"') {
            i = skipQuoted(str, i);
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i; // match for the opening at openIdx
        }
        i++;
    }
    return -1;
}

// Extracts KW(value) pairs, preserving nested parens inside value
function extractParms(cmd: string): Array<{ kwd: string; value: string; start: number; end: number }> {
    const out: Array<{ kwd: string; value: string; start: number; end: number }> = [];
    const re = /\b([A-Z0-9$#@_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmd))) {
        const kwd = m[1].toUpperCase();
        const openIdx = m.index + m[0].lastIndexOf('(');
        const closeIdx = findMatchingParen(cmd, openIdx);
        if (closeIdx > openIdx) {
            const value = cmd.slice(openIdx + 1, closeIdx);
            out.push({ kwd, value, start: m.index, end: closeIdx + 1 });
            // Move regex index forward to avoid re-matching inside this value
            re.lastIndex = closeIdx + 1;
        } else {
            break; // unmatched paren; bail out
        }
    }
    return out;
}




// Utility: Nonce for CSP
function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

// Helper: Download a streamfile from IBM i as Buffer (raw) or string (text)
export async function downloadStreamfile(
    connection: any, // Use the correct type for your connection if available
    ifsPath: string,
    raw: boolean = false,
    encoding: BufferEncoding = 'utf8'
): Promise<Buffer | string | undefined> {
    try {
        const fileInfo = await connection.stat(ifsPath);  // Get the file attributes (fileInfo.ccsid)
        if (raw) {
            // Raw binary (Buffer)
            if (typeof connection.downloadStreamfileRaw === 'function') {
                return await connection.downloadStreamfileRaw(ifsPath);
            } else {
                throw new Error('downloadStreamfileRaw is not available on this connection.');
            }
        } else {
            // Text (string)
            if (typeof connection.downloadStreamfile === 'function') {
                return await connection.downloadStreamfile(ifsPath, encoding);
            } else {
                // Fallback: download as raw and convert to string
                const buf = await connection.downloadStreamfileRaw(ifsPath);
                return buf.toString(encoding);
            }
        }
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to download streamfile: ${err}`);
        return undefined;
    }
}


function extractDefaultsFromXML(xml: string): Record<string, any> {
    const defaults: Record<string, any> = {};
    const parser = new DOMParser();
    const doc = parser.parseFromString(xml, "application/xml");
    const parms = doc.getElementsByTagName("Parm");
    for (let i = 0; i < parms.length; i++) {
        const parm = parms[i];
        const kwd = parm.getAttribute("Kwd");
        const dft = parm.getAttribute("Dft");
        if (kwd && dft) {
            // Check if parameter has ELEM children
            const elemChildren = parm.getElementsByTagName('Elem');
            if (elemChildren && elemChildren.length > 0) {
                // Parse ELEM defaults like "SRCSEQ(1.00)" into structured format
                defaults[kwd] = parseElemDefault(dft);
            } else {
                defaults[kwd] = dft;
            }
        }
    }
    return defaults;
}

// Helper function to parse ELEM parameter defaults
function parseElemDefault(dft: string): any {
    // Handle defaults like "SRCSEQ(1.00 1.00)" or "(1.00 1.00)" or "LIB/OBJ"
    let trimmed = dft.trim();

    // If it starts with a keyword followed by '(', strip the keyword
    // e.g., "SRCSEQ(1.00 1.00)" -> "(1.00 1.00)"
    const keywordMatch = trimmed.match(/^[A-Z][A-Z0-9]*\(/i);
    if (keywordMatch) {
        trimmed = trimmed.substring(keywordMatch[0].length - 1); // Keep the opening paren
    }

    // Strip outer parentheses
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        trimmed = trimmed.slice(1, -1);
    }

    // Check if this is a QUAL type (contains '/')
    if (trimmed.includes('/')) {
        return trimmed.split('/').map(s => s.trim());
    }

    // Check if this is space-separated ELEM parts
    if (trimmed.includes(' ')) {
        const parts = [];
        let current = '';
        let parenDepth = 0;

        for (let i = 0; i < trimmed.length; i++) {
            const char = trimmed[i];
            if (char === '(') parenDepth++;
            if (char === ')') parenDepth--;

            if (char === ' ' && parenDepth === 0) {
                if (current) parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current) parts.push(current.trim());

        return parts;
    }

    // Single value
    return trimmed;
}

// Formerly in prompter.ts now here since ths is where they are used.

function logMessage(...args: any[]): void {
    const message = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg)).join(' ');

    // Use a fallback for development mode detection
    const isDevelopmentMode = vscode.env.appName.includes('Code - OSS') || vscode.env.appName.includes('Insiders');

    if (isDevelopmentMode) {
        console.log(message);
    } else {
        vscode.window.showWarningMessage(message);
    }
}

export function getHtmlForPrompter(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    TwoPartCmdName: string,
    xml: string,
    nonce: string
): Promise<string> {

    const htmlPath = path.join(__dirname, '..', 'media', 'prompter.html');

    let mainJs = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'main.js')
    ).toString();

    let styleUri = webview.asWebviewUri(
        vscode.Uri.joinPath(extensionUri, 'media', 'style.css')
    ).toString();

    // Read vscode-elements bundle to inject inline (bypasses CSP issues)
    const vscodeElementsPath = path.join(__dirname, '..', 'node_modules', '@vscode-elements', 'elements', 'dist', 'bundled.js');
    let vscodeElementsBundle = '';
    try {
        vscodeElementsBundle = fs.readFileSync(vscodeElementsPath, 'utf8');
        console.log('[clPrompter] Loaded vscode-elements bundle:', vscodeElementsBundle.length, 'bytes');
    } catch (err) {
        console.error('[clPrompter] Failed to read vscode-elements bundle:', err);
    }

    // styleUri = styleUri.replace('file%2B.', 'file+.');
    // mainJs = mainJs.replace('file%2B.', 'file+.');

    console.log(`[clPrompter] extensionUri: ${htmlPath}`);
    console.log(`[clPrompter] htmlPath: ${htmlPath}`);
    console.log(`[clPrompter] main.js: ${mainJs}`);
    console.log(`[clPrompter] styleUri: ${styleUri}`);
    console.log('[clPrompter] extensionUri:', extensionUri.toString());
    console.log('[clPrompter] mediaUri:', vscode.Uri.joinPath(extensionUri, 'media').toString());


    return new Promise((resolve, reject) => {
        fs.readFile(htmlPath, { encoding: 'utf8' }, (err, html) => {
            if (err) {
                reject(new Error(`[clPrompter] Failed to read HTML file: ${err.message}`));
                return;
            }
            const qualCmdName = buildQualName(TwoPartCmdName);

            // Replace placeholders with escaped or safe values (VS Code webview version)
            const replacedHtml = html
                .replace(/{{nonce}}/g, nonce)
                .replace(/{{cspSource}}/g, webview.cspSource)
                .replace(/{{mainJs}}/g, mainJs)
                .replace(/{{styleUri}}/g, styleUri)
                .replace(/{{vscodeElementsBundle}}/g, vscodeElementsBundle)
                .replace(/{{cmdName}}/g, qualCmdName)
                .replace(/{{xml}}/g, xml.replace(/"/g, '&quot;')); // Escape double quotes for safety

            // Save HTML for diagnostic purposes if enabled
            const config = vscode.workspace.getConfiguration('clPrompter');
            const savePrompterHTMLtoFile = config.get<boolean>('savePrompterHTMLtoFile', false);

            if (savePrompterHTMLtoFile) {
                try {
                    const os = require('os');
                    let htmlDir = config.get<string>('savedPrompterHTMLFileLocation') || '${tmpdir}';

                    // Expand variables
                    htmlDir = htmlDir
                        .replace('${tmpdir}', os.tmpdir())
                        .replace('${userHome}', os.homedir())
                        .replace('${workspaceFolder}', vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir());

                    // Clean command name for filename (remove special chars)
                    const cleanCmdName = qualCmdName.replace(/[^a-zA-Z0-9_-]/g, '_');
                    const htmlFilePath = path.join(htmlDir, `clPrompter-${cleanCmdName}.html`);

                    fs.writeFileSync(htmlFilePath, replacedHtml, { encoding: 'utf8' });
                    console.log(`[clPrompter] ✓ Diagnostic HTML written to: ${htmlFilePath}`);
                } catch (err) {
                    console.error('[clPrompter] ✗ Failed to write diagnostic HTML file:', err);
                }
            } else {
                console.log('[clPrompter] Diagnostic HTML writing is disabled (savePrompterHTMLtoFile=false)');
            }

            resolve(replacedHtml);
        });
    });
}



// XML helpers (skip Constant, NULL; stable positional order)
function getMaxPos(xml: string): number | undefined {
    const m = xml.match(/\bMaxPos="(\d+)"/i);
    return m ? parseInt(m[1], 10) : undefined;
}

function getThrowawayKwdsFromXML(xml: string): Set<string> {
    const throwaways = new Set<string>();
    const re = /<Parm\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
        const attrs = m[1];
        const kwdM = attrs.match(/\bKwd="([^"]+)"/i);
        if (!kwdM) continue;
        const kwd = kwdM[1].toUpperCase();

        const hasConst = /\bConstant\s*=/i.test(attrs);
        const typeM = attrs.match(/\bType="([^"]+)"/i);
        const isNull = typeM && typeM[1].toUpperCase() === 'NULL';
        if (hasConst || isNull) throwaways.add(kwd);
    }
    return throwaways;
}

function getPositionalKwdsFromXML(xml: string): string[] {
    const items: Array<{ kwd: string; pos?: number; idx: number }> = [];
    const re = /<Parm\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    let idx = 0;

    while ((m = re.exec(xml))) {
        const attrs = m[1];

        const kwdM = attrs.match(/\bKwd="([^"]+)"/i);
        if (!kwdM) { idx++; continue; }
        const kwd = kwdM[1].toUpperCase();

        // Skip Constant and NULL
        if (/\bConstant\s*=/i.test(attrs)) { idx++; continue; }
        const typeM = attrs.match(/\bType="([^"]+)"/i);
        if (typeM && typeM[1].toUpperCase() === 'NULL') { idx++; continue; }

        // Optional PosNbr/Pos/Position
        const posM = attrs.match(/\b(PosNbr|Pos|Position)="(\d+)"/i);
        const pos = posM ? parseInt(posM[2], 10) : undefined;

        items.push({ kwd, pos, idx });
        idx++;
    }

    items.sort((a, b) => {
        const aHas = Number.isFinite(a.pos as number);
        const bHas = Number.isFinite(b.pos as number);
        if (aHas && bHas) return (a.pos as number) - (b.pos as number);
        if (aHas && !bHas) return -1;
        if (!aHas && bHas) return 1;
        return a.idx - b.idx; // stable among no-pos
    });

    return items.map(x => x.kwd);
}

/**
 * Returns positional-eligible keywords in XML ARRIVAL ORDER (source definition order).
 * IBM i binds positional (unnamed) parameters by the sequence in which PARM statements
 * appear in the command source — not by the PosNbr display sequence. PosNbr controls
 * only the prompt display order. For example, DCL's STG was added after LEN/VALUE but
 * given PosNbr=3 to appear between TYPE and LEN in the prompter; however a bare positional
 * value typed as the 3rd argument still maps to LEN (3rd in arrival order), not STG.
 */
function getPositionalKwdsFromXMLByArrival(xml: string): string[] {
    const items: Array<{ kwd: string; idx: number }> = [];
    const re = /<Parm\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    let idx = 0;

    while ((m = re.exec(xml))) {
        const attrs = m[1];

        const kwdM = attrs.match(/\bKwd="([^"]+)"/i);
        if (!kwdM) { idx++; continue; }
        const kwd = kwdM[1].toUpperCase();

        // Skip Constant and NULL (same as getPositionalKwdsFromXML)
        if (/\bConstant\s*=/i.test(attrs)) { idx++; continue; }
        const typeM = attrs.match(/\bType="([^"]+)"/i);
        if (typeM && typeM[1].toUpperCase() === 'NULL') { idx++; continue; }

        items.push({ kwd, idx });
        idx++;
    }

    // Return in XML arrival order — no sort by PosNbr
    return items.map(x => x.kwd);
}

function orderParmMapByMetas(parmMetas: ParmMeta[], parmMap: Record<string, any>) {
    // Case-insensitive lookup
    const upper = new Map<string, { key: string; val: any }>();
    for (const k of Object.keys(parmMap)) {
        upper.set(k.toUpperCase(), { key: k, val: parmMap[k] });
    }
    const ordered: Record<string, any> = {};
    for (const m of parmMetas) {
        const kwd = String((m as any).Kwd || '');
        if (!kwd) continue;
        const hit = upper.get(kwd.toUpperCase());
        if (hit) {
            ordered[kwd] = hit.val;
            upper.delete(kwd.toUpperCase());
        }
    }
    // Append leftovers (if any)
    for (const { key, val } of upper.values()) {
        ordered[key] = val;
    }
    return ordered;
}

function isQualifiedName(value: string): boolean {
  const s = String(value ?? '').trim();
  if (!s || s.startsWith("'") || s.startsWith('"')) return false; // already quoted
  if (s.startsWith('(') && s.endsWith(')')) return false; // ELEM group, already handled
  if (/\s|,/.test(s)) return false; // spaces/commas → not a simple qual
  const parts = s.split('/');
  if (parts.length < 1 || parts.length > 3) return false;
  const partOk = (p: string) =>
    p.length > 0 &&
    (/^\*[A-Z0-9_]+$/i.test(p) || /^[A-Z0-9_$#@][A-Z0-9_$#@]*$/i.test(p));
  return parts.every(partOk);
}

// Build the list of positional keywords in order of PosNbr (1..MaxPos)
function getPositionalKwdsFromMetas(parmMetas: ParmMeta[]): string[] {
  return parmMetas
    .filter(m => Number(m.PosNbr) > 0)
    .sort((a, b) => Number(a.PosNbr) - Number(b.PosNbr))
    .map(m => m.Kwd);
}