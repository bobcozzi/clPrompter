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

// A CL variable: '&' followed by a letter, then letters/digits/underscore.
// Detected by scanning the command text (not the token stream) because the
// tokenizer only emits a 'variable' token when '&' sits at a token boundary —
// in `TOFILE(QTEMP/&testfile)` the whole `QTEMP/&testfile` is one value token,
// so tokenizing alone would miss it. Case-insensitive; CL variable names are
// case-insensitive on IBM i.
const CL_VARIABLE_IN_TEXT = /&[A-Za-z][A-Za-z0-9_]*/g;

/** Finds the distinct CL `&variable` names in a command, in order of appearance. */
function findClVariables(command: string): string[] {
    const names: string[] = [];
    for (const match of command.matchAll(CL_VARIABLE_IN_TEXT)) {
        const name = match[0];
        if (!names.some((existing) => existing.toUpperCase() === name.toUpperCase())) {
            names.push(name);
        }
    }
    return names;
}

/**
 * Prompts the user for the value of each CL `&variable` in a command, recording
 * answers into `collected` (keyed by uppercased variable name). Variables already
 * present in `collected` are not re-prompted, so a batch run gathers each
 * variable's value once up front.
 *
 * The prompt uses ignoreFocusOut so revealing the Command Entry panel (which pulls
 * focus) cannot dismiss it mid-entry.
 *
 * @returns The same `collected` map, or undefined when the user cancels a prompt
 *          (the caller should abort).
 */
export async function promptForClVariables(
    command: string,
    collected: Map<string, string> = new Map<string, string>()
): Promise<Map<string, string> | undefined> {
    for (const name of findClVariables(command)) {
        // Key by the variable name WITHOUT the leading '&' — substituteClVariables
        // re-adds '&' when building the match pattern.
        const key = name.replace(/^&/, '').toUpperCase();
        if (collected.has(key)) {
            continue;
        }
        const value = await vscode.window.showInputBox({
            title: vscode.l10n.t('CL Variable Prompt: {0}', name.toUpperCase()),
            prompt: vscode.l10n.t("Enter a value for the {0} variable. Add quotes where needed (e.g. 'Text Description').", name),
            placeHolder: name,
            ignoreFocusOut: true
        });
        if (value === undefined) {
            return undefined; // cancelled
        }
        collected.set(key, value);
    }
    return collected;
}

/**
 * Replaces each CL `&variable` in a command with its collected value (keyed by
 * uppercased name). Values are substituted as-is (the user supplies any needed
 * quoting). Replacement is case-insensitive and longest-name-first with a
 * non-identifier lookahead so &OPT never replaces inside &OPTION.
 */
export function substituteClVariables(command: string, values: Map<string, string>): string {
    const entries = Array.from(values.entries()).sort((a, b) => b[0].length - a[0].length);
    let resolved = command;
    for (const [key, value] of entries) {
        resolved = resolved.replace(new RegExp(`&${escapeRegExp(key)}(?![A-Za-z0-9_])`, 'gi'), value);
    }
    return resolved;
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
