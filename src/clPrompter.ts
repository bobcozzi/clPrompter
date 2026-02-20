/**
 * Standalone CL Prompter API for use by external extensions
 *
 * This module provides a simple function that can be called by other VS Code extensions
 * to prompt a CL command and receive the updated command string.
 */

import * as vscode from 'vscode';
import { DOMParser } from '@xmldom/xmldom';
import { getCMDXML } from './getcmdxml';

// Import types and helper functions from extension
// These will be needed when the ClPromptPanel is imported
let ClPromptPanelClass: any;
let extensionUriCache: vscode.Uri | undefined;

/**
 * Initialize the prompter with the ClPromptPanel class and extension URI
 * This is called from extension.ts after the class is defined
 */
export function initializePrompter(ClPromptPanel: any, extensionUri?: vscode.Uri) {
    ClPromptPanelClass = ClPromptPanel;
    if (extensionUri) {
        extensionUriCache = extensionUri;
    }
}

/**
 * Get the clPrompter extension URI
 * This is used internally to find the extension's resources
 */
function getExtensionUri(): vscode.Uri | undefined {
    if (extensionUriCache) {
        return extensionUriCache;
    }
    // Try to find the extension
    const extension = vscode.extensions.getExtension('CozziResearch.clprompter');
    if (extension) {
        extensionUriCache = extension.extensionUri;
        return extensionUriCache;
    }
    return undefined;
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

/**
 * Prompt a CL command and return the updated command string
 *
 * This function can be called by external extensions to invoke the CL prompter
 * on any CL command string. It returns a Promise that resolves with:
 * - The updated command string if the user submits the prompt
 * - The original command string if the user cancels the prompt
 * - null if an error occurs
 *
 * @param extensionUri - The URI of the extension (for loading webview resources)
 * @param commandString - The CL command string to prompt
 * @returns Promise that resolves with the updated command string or original on cancel
 *
 * @example
 * ```typescript
 * const result = await CLPrompter(context.extensionUri, 'CRTPF FILE(MYLIB/MYFILE)');
 * if (result) {
 *     console.log('Updated command:', result);
 * }
 * ```
 */
export async function CLPrompter(
    extensionUri: vscode.Uri,
    commandString: string
): Promise<string | null>;

/**
 * Prompt a CL command and return the updated command string (simplified version)
 *
 * This overload automatically finds the clPrompter extension URI, so you only
 * need to pass the command string.
 *
 * @param commandString - The CL command string to prompt
 * @returns Promise that resolves with the updated command string or original on cancel
 *
 * @example
 * ```typescript
 * const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');
 * if (result) {
 *     console.log('Updated command:', result);
 * }
 * ```
 */
export async function CLPrompter(
    commandString: string
): Promise<string | null>;

// Implementation
export async function CLPrompter(
    extensionUriOrCommand: vscode.Uri | string,
    commandString?: string
): Promise<string | null> {
    // Determine which overload was called
    let extensionUri: vscode.Uri;
    let command: string;

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
        command = commandString!;
    }

    if (!ClPromptPanelClass) {
        throw new Error('CLPrompter not initialized. Make sure the clPrompter extension is activated.');
    }

    return new Promise<string | null>(async (resolve) => {
        try {
            // Extract command name and label from the input string
            const cmdName = extractCmdName(command);
            const cmdLabel = extractCmdLabel(command);

            if (!cmdName || cmdName.trim() === '') {
                console.error('[CLPrompter] No command name found in command string:', command);
                resolve(command); // Return original command on error
                return;
            }

            console.log(`[CLPrompter] Prompting command: ${cmdName}`);
            console.log(`[CLPrompter] Full command string: ${command}`);

            // Get the command XML definition from IBM i
            let xml: string;
            try {
                xml = await getCMDXML(cmdName);
            } catch (error) {
                console.error('[CLPrompter] Failed to get command XML:', error);
                vscode.window.showErrorMessage(`Failed to get command definition for ${cmdName}`);
                resolve(command); // Return original command on error
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

            console.log('[CLPrompter] Creating prompter panel');

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
                        console.log('[CLPrompter] User cancelled, returning original command');
                        resolve(command);
                    } else {
                        // User submitted - return the updated command
                        console.log('[CLPrompter] User submitted, returning updated command:', result);
                        resolve(result);
                    }
                }
            );

            // Ensure promise resolves if panel is disposed without submitting/cancelling
            panel.onDidDispose(() => {
                console.log('[CLPrompter] Panel disposed');
                // If the promise hasn't been resolved yet, resolve with original command
                try {
                    resolve(command);
                } catch (e) {
                    // Promise already resolved, ignore
                    console.log('[CLPrompter] Promise already resolved');
                }
            });

        } catch (error) {
            console.error('[CLPrompter] Unexpected error:', error);
            vscode.window.showErrorMessage(`CL Prompter error: ${error}`);
            resolve(command); // Return original command on error
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
        .then(result => callback(result))
        .catch(error => {
            console.error('[CLPrompter] Error:', error);
            callback(commandString); // Return original on error
        });
}
