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

/**
 * Standalone CL Prompter API for use by external extensions
 *
 * This module provides a simple function that can be called by other VS Code extensions
 * to prompt a CL command and receive the updated command string.
 */

import * as vscode from 'vscode';
import { DOMParser } from '@xmldom/xmldom';
import { getCMDXML, GetCmdXmlOptions } from './getcmdxml';

export interface CLPrompterResult {
    command: string;
    action: 'submit' | 'cancel' | 'error';
}

export interface CLPrompterOptions {
    cmdXmlOptions?: GetCmdXmlOptions;
}

const API_DEBUG_LOGS = false;
function debugLog(...args: unknown[]): void {
    if (API_DEBUG_LOGS) {
        console.log(...args);
    }
}

// Import types and helper functions from extension
// These will be needed when the ClPromptPanel is imported
let ClPromptPanelClass: any;
let extensionUriCache: vscode.Uri | undefined;
let registeredPromptHandler: ((command: string, options?: CLPrompterOptions) => Promise<CLPrompterResult> | CLPrompterResult) | undefined;

/**
 * Initialize the prompter with the ClPromptPanel class and extension URI.
 * This is called from extension.ts after the class is defined.
 */
export function initializePrompter(ClPromptPanel: any, extensionUri?: vscode.Uri) {
    ClPromptPanelClass = ClPromptPanel;
    if (extensionUri) {
        extensionUriCache = extensionUri;
    }
}

/**
 * Register a custom prompter implementation without hard-coding the extension ID.
 * This is intentionally additive: existing callers can keep using CLPrompter(), while
 * integrations that need a generic fallback can supply their own callback.
 */
export function registerCLPrompterHandler(
    handler: ((command: string, options?: CLPrompterOptions) => Promise<CLPrompterResult> | CLPrompterResult) | undefined,
    extensionUri?: vscode.Uri
): void {
    registeredPromptHandler = handler;
    if (extensionUri) {
        extensionUriCache = extensionUri;
    }
}

export function unregisterCLPrompterHandler(): void {
    registeredPromptHandler = undefined;
}

export function getRegisteredCLPrompterHandler(): ((command: string, options?: CLPrompterOptions) => Promise<CLPrompterResult> | CLPrompterResult) | undefined {
    return registeredPromptHandler;
}

/**
 * Get the clPrompter extension URI.
 * Prefer the explicitly supplied URI; do not resolve by hard-coded extension ID.
 */
function getExtensionUri(): vscode.Uri | undefined {
    return extensionUriCache;
}

export async function promptWithRegisteredCLPrompter(
    command: string,
    options?: CLPrompterOptions
): Promise<CLPrompterResult> {
    const handler = registeredPromptHandler;
    if (handler) {
        return await handler(command, options);
    }

    const fallback = await vscode.window.showInputBox({
        prompt: 'Enter a CL command to prompt',
        value: command,
        ignoreFocusOut: true,
        placeHolder: 'CMD(...)'
    });

    if (fallback === undefined) {
        return { command, action: 'cancel' };
    }

    return { command: fallback.trim() || command, action: 'submit' };
}

/**
 * Extract command name from a CL command string
 */
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

/**
 * Extract label from a CL command string
 */
function extractCmdLabel(cmdString: string): string {
    let str = cmdString.trim();
    let tokens = str.split(/\s+/);
    if (tokens[0].endsWith(':')) {
        // Remove the colon and return the label
        return tokens[0].slice(0, -1);
    }
    return '';
}

export async function CLPrompter(
    extensionUriOrCommand: vscode.Uri | string,
    commandStringOrOptions?: string | CLPrompterOptions,
    options?: CLPrompterOptions
): Promise<CLPrompterResult> {
    // Determine which overload was called
    let extensionUri: vscode.Uri;
    let command: string;
    let promptOptions = options;

    if (typeof extensionUriOrCommand === 'string') {
        // Simple overload: CLPrompter(commandString)
        command = extensionUriOrCommand;
        const uri = getExtensionUri();
        if (!uri) {
            throw new Error('CLPrompter extension not found. Make sure it is installed and activated.');
        }
        extensionUri = uri;
    } else {
        // Full overload: CLPrompter(extensionUri, commandString)
        extensionUri = extensionUriOrCommand;
        command = typeof commandStringOrOptions === 'string' ? commandStringOrOptions : '';
    }

    if (typeof extensionUriOrCommand === 'string' && commandStringOrOptions && typeof commandStringOrOptions === 'object' && !Array.isArray(commandStringOrOptions)) {
        promptOptions = commandStringOrOptions as CLPrompterOptions;
    }

    if (!ClPromptPanelClass) {
        throw new Error('CLPrompter not initialized. Make sure the clPrompter extension is activated.');
    }

    return new Promise<CLPrompterResult>(async (resolve) => {
        try {
            // Extract command name and label from the input string
            const cmdName = extractCmdName(command);
            const cmdLabel = extractCmdLabel(command);

            if (!cmdName || cmdName.trim() === '') {
                console.error('[CLPrompter] No command name found in command string:', command);
                resolve({ command, action: 'error' }); // Return original command on error
                return;
            }

            debugLog(`[CLPrompter] Prompting command: ${cmdName}`);
            debugLog(`[CLPrompter] Full command string: ${command}`);

            // Get the command XML definition from IBM i
            let xml: string;
            try {
                xml = await getCMDXML(cmdName, promptOptions?.cmdXmlOptions);
            } catch (error) {
                console.error('[CLPrompter] Failed to get command XML:', error);
                vscode.window.showErrorMessage(vscode.l10n.t('Failed to get command definition for {cmdName}', { cmdName }));
                resolve({ command, action: 'error' }); // Return original command on error
                return;
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
                console.error('[CLPrompter] Failed to parse XML for command prompt:', err);
            }

            // If the XML has no Prompt attribute, QCDRCMDD returned a placeholder
            // (command not found / invalid). getCMDXML already showed the warning.
            if (!cmdPrompt) {
                debugLog(`[clPrompter] '${cmdName}' returned no command definition — aborting prompter.`);
                resolve({ command, action: 'error' });
                return;
            }

            // Determine which column to show the panel in
            const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

            // Create the webview panel
            const panel = vscode.window.createWebviewPanel(
                'clPrompterStandalone',
                cmdPrompt ? `${cmdPrompt}` : `${cmdName} Prompt`,
                column,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
                }
            );

            debugLog('[CLPrompter] Creating prompter panel');

            // Create the prompter panel with isNested=true so it returns the result via resolver
            // Pass undefined for editor and selection since this is standalone
            const prompterPanel = new ClPromptPanelClass(
                panel,
                extensionUri,
                cmdName,
                cmdLabel,
                xml,
                undefined,      // editor - not tied to a specific editor
                undefined,      // selection - no selection to replace
                command,        // fullCmd - the original command for parsing
                undefined,      // cmdComment - will be extracted from command if present
                true,           // isNested - use nested mode to return result via resolver
                (result: string | null) => {
                    // This resolver is called when the user submits or cancels
                    if (result === null) {
                        // User cancelled - return original command
                        debugLog('[CLPrompter] User cancelled, returning original command');
                        resolve({ command, action: 'cancel' });
                    } else {
                        // User submitted - return the updated command
                        debugLog('[CLPrompter] User submitted, returning updated command:', result);
                        resolve({ command: result, action: 'submit' });
                    }
                },
                false
            );

            // Ensure promise resolves if panel is disposed without submitting/cancelling
            panel.onDidDispose(() => {
                debugLog('[CLPrompter] Panel disposed');
                // If the promise hasn't been resolved yet, resolve with original command
                try {
                    resolve({ command, action: 'cancel' });
                } catch (e) {
                    // Promise already resolved, ignore
                    debugLog('[CLPrompter] Promise already resolved');
                }
            });

        } catch (error) {
            console.error('[CLPrompter] Unexpected error:', error);
            vscode.window.showErrorMessage(vscode.l10n.t('CL Prompter error: {error}', { error: String(error) }));
            resolve({ command, action: 'error' });
        }
    });
}

/**
 * Prompt a CL command with callback pattern (alternative API)
 *
 * This is an alternative API that uses a callback instead of a Promise.
 * The callback receives the updated command string, or the original if cancelled.
 *
 * @param extensionUri - The URI of the extension
 * @param commandString - The CL command string to prompt
 * @param callback - Function called with the result (updated or original command)
 */
export function CLPrompterCallback(
    extensionUri: vscode.Uri,
    commandString: string,
    callback: (result: string | null) => void
): void {
    CLPrompter(extensionUri, commandString)
        .then(result => callback(result.command))
        .catch(error => {
            console.error('[CLPrompter] Error:', error);
            callback(commandString); // Return original on error
        });
}
