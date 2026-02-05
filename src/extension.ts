import * as vscode from 'vscode';
import { DOMParser } from '@xmldom/xmldom';


import { CodeForIBMi } from "@halcyontech/vscode-ibmi-types";
export let code4i: CodeForIBMi;
import { Extension, extensions } from "vscode";

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
import { collectCLCmd, buildAllowedValsMap } from './extractor';
import { getCMDXML } from './getcmdxml';

import {
    tokenizeCL,
    rewriteLeadingPositionals,
    safeExtractKwdArg,
    rewriteLeadingPositionalsByList
} from './tokenizeCL';

let baseExtension: Extension<CodeForIBMi> | undefined;

export async function activate(context: vscode.ExtensionContext) {

    baseExtension = extensions.getExtension<CodeForIBMi>("halcyontechltd.code-for-ibmi");
    if (baseExtension) {
        if (!baseExtension.isActive) {
            await baseExtension.activate();
        }
        code4i = baseExtension.exports;
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
                    cvtcase: config.get('formatCase', '*UPPER') as '*UPPER' | '*LOWER' | '*NONE',
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
                    cvtcase: config.get('formatCase', '*UPPER') as '*UPPER' | '*LOWER' | '*NONE',
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
    console.log('CL Prompter activate [end]');
}


export class ClPromptPanel {
    public static currentPanel: ClPromptPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
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
            if (!cmdName) {
                cmdName = (await askUserForCMDToPrompt(commandString)).toString();
            }
            if (!cmdName || cmdName.trim() === '') {
                resolve(null);
                return;
            }

            console.log(`[clPrompter] Nested prompt for: ${cmdName}`);
            const xml = await getCMDXML(cmdName);
            const cmdLabel = extractCmdLabel(commandString);

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
        if (!cmdName) {
            cmdName = (await askUserForCMDToPrompt(fullCmd)).toString();
        }
        if (!cmdName || cmdName.trim() == '') {
            return;
        }
        const cmdLabel = extractCmdLabel(fullCmd);

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

        // ✅ Create selection that spans the entire command range
        const selection = editor && commandRange
            ? new vscode.Selection(
                commandRange.startLine, 0,
                commandRange.endLine, editor.document.lineAt(commandRange.endLine).text.length
            )
            : undefined;

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

        if (ClPromptPanel.currentPanel) {
            ClPromptPanel.currentPanel._panel.reveal(column);
            await ClPromptPanel.currentPanel.setXML(cmdName, xml, editor, selection, cmdPrompt);
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
            ClPromptPanel.currentPanel = new ClPromptPanel(
                panel, extensionUri, cmdName, cmdLabel, xml, editor, selection, fullCmd, cmdComment);
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

        if (fullCmd) {
            // 1) Extract metas then filter/sort by XML (skip Constant/NULL)
            this._parmMetas = extractParmMetas(xml);

            const throwawayKwds = getThrowawayKwdsFromXML(xml);
            const posOrder = getPositionalKwdsFromXML(xml); // already excludes throwaways
            const posIndex = new Map<string, number>();
            posOrder.forEach((k, i) => posIndex.set(k, i));

            // Filter metas by throwaways from XML
            this._parmMetas = this._parmMetas.filter(m => !throwawayKwds.has(String((m as any).Kwd || '').toUpperCase()));

            // Stable sort metas: positional first (by posOrder), then keep original order
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

            // 3) Rewrite leading positionals by XML list, then parse
            console.log('[clPrompter] Full command before rewrite:', fullCmd);
            const cmdWithKeywords =
                (maxPos ?? 0) > 0 && posOrder.length > 0
                    ? rewriteLeadingPositionalsByList(fullCmd, posOrder, maxPos)
                    : fullCmd;
            console.log('[clPrompter] Full command after rewrite:', cmdWithKeywords);

            try {
                this._parmMap = parseCLParms(cmdWithKeywords, this._parmMetas);
                console.log('[clPrompter] parseCLParms keys:', Object.keys(this._parmMap));
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

                // Extract command prompt from XML
                let cmdPrompt = '';
                try {
                    const parser = new DOMParser();
                    const xmlDoc = parser.parseFromString(xml, 'application/xml');
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

                const allowedValsMap = buildAllowedValsMap(xml);
                const config = vscode.workspace.getConfiguration('clPrompter');
                const keywordColor = config.get('kwdColor');
                const valueColor = config.get('kwdValueColor');
                const autoAdjust = config.get('kwdColorAutoAdjust');
                const convertToUpperCase = config.get('convertToUpperCase', true);

                panel.webview.postMessage({
                    type: 'formData',
                    xml,
                    allowedValsMap,
                    cmdName,
                    cmdPrompt: cmdPrompt,
                    paramMap: this._parmMap,
                    parmMap: this._parmMap,
                    parmMetas: this._parmMetas,
                    config: { keywordColor, valueColor, autoAdjust, convertToUpperCase }
                });
                panel.webview.postMessage({ type: "setLabel", label: cmdLabel, comment: cmdComment });
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
            ClPromptPanel.currentPanel = undefined;

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

                        // Extract comment from values if present
                        const submittedComment = message.values['comment'] as string | undefined;

                        // Get the convertToUpperCase setting
                        const config = vscode.workspace.getConfiguration('clPrompter');
                        const convertToUpperCase = config.get('convertToUpperCase', true);

                        let cmd = buildCLCommand(
                            this._cmdName,
                            message.values,
                            defaults,
                            allowedValsMap,
                            parmTypeMap,
                            this._parmMetas,
                            this._presentParms,
                            undefined,
                            convertToUpperCase
                        );

                        // Append comment if present
                        const finalComment = submittedComment || this._cmdComment;
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
                                vscode.window.showTextDocument(doc, { preview: false }).then(editor => {
                                    const eol = doc.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';
                                    const formattedWithEOL = formatted.split(/\r?\n/).join(eol);
                                    editor.edit(editBuilder => {
                                        editBuilder.replace(this._selection!, formattedWithEOL);
                                    }).then(success => {
                                        if (!success) {
                                            vscode.window.showWarningMessage('Failed to insert CL command. Try again.');
                                        }
                                        this._panel.dispose();
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
                        this._panel.dispose();
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

                        const allowedValsMap = buildAllowedValsMap(this._xml);
                        const config = vscode.workspace.getConfiguration('clPrompter');
                        const keywordColor = config.get('kwdColor');
                        const valueColor = config.get('kwdValueColor');
                        const autoAdjust = config.get('kwdColorAutoAdjust');

                        console.log('[clPrompter] loadForm → sending formData with keys:', Object.keys(this._parmMap || {}));

                        this._panel.webview.postMessage({
                            type: 'formData',
                            xml: this._xml,
                            allowedValsMap,
                            cmdName: this._cmdName,
                            cmdPrompt: cmdPrompt,
                            parmMap: this._parmMap,
                            paramMap: this._parmMap,
                            parmMetas: this._parmMetas,
                            config: { keywordColor, valueColor, autoAdjust }
                        });
                        this._sentFormData = true;
                        break;
                    }
                    case 'pong': {
                        // Webview responded to ping - check if it needs reinitialization
                        console.log('[clPrompter] Received pong, hasProcessedFormData:', message.hasProcessedFormData);
                        if (!message.hasProcessedFormData && !this._sentFormData) {
                            console.log('[clPrompter] Webview needs reinitialization, resending formData');
                            // Resend the form data to reinitialize the webview
                            const allowedValsMap = buildAllowedValsMap(this._xml);
                            const config = vscode.workspace.getConfiguration('clPrompter');
                            const keywordColor = config.get('kwdColor');
                            const valueColor = config.get('kwdValueColor');
                            const autoAdjust = config.get('kwdColorAutoAdjust');

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
                                cmdName: this._cmdName,
                                cmdPrompt: cmdPrompt,
                                parmMap: this._parmMap,
                                paramMap: this._parmMap,
                                parmMetas: this._parmMetas,
                                config: { keywordColor, valueColor, autoAdjust }
                            });
                            this._panel.webview.postMessage({ type: 'setLabel', label: this._cmdLabel, comment: this._cmdComment });
                            this._sentFormData = true;
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
    public async setXML(cmdName: string, xml: string, editor?: vscode.TextEditor, selection?: vscode.Selection, cmdPrompt?: string) {
        console.log('[clPrompter] setXML called - resetting state');
        this.resetWebviewState();
        this._sentFormData = false; // allow new formData send
        console.log('[clPrompter] setXML finished resetting state');

        this._cmdName = cmdName;
        this._xml = xml;
        this._editor = editor;
        this._selection = selection;

        // ✅ Update document URI to current editor
        this._documentUri = editor?.document.uri;

        // Update panel title
        if (cmdName) {
            this._panel.title = `${cmdName} Prompt`;
        }

        const html = await this.getHtmlForPrompter(this._panel.webview, this._cmdName, this._xml);
        this._panel.webview.html = html;
    }


    // ✅ Fix the dispose method around line 290
    public dispose() {
        console.log('[clPrompter] Disposing ClPromptPanel');

        // ✅ Clear the current panel reference BEFORE disposing
        ClPromptPanel.currentPanel = undefined;

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

    private async getHtmlForPrompter(webview: vscode.Webview, cmdString: string, xml: string): Promise<string> {
        const nonce = getNonce();
        const cmdName = buildAPI2PartName(cmdString);

        const prompter = await getHtmlForPrompter(webview, this._extensionUri, cmdString, xml, nonce);
        // console.log("[clPrompter] HTML generated for Prompter: ", prompter);
        return prompter;
    }
}


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
    if (tokens.length > 1 && tokens[0].endsWith(':')) {
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
    if (tokens.length > 1 && tokens[0].endsWith(':')) {
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
    console.log('[clPrompter] vscodeELementsBundle:', vscodeElementsBundle);


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