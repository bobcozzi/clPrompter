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

import { buildQlgPathNameHex, buildAPI2PartName, buildQualName } from './QlgPathName';

// In-memory cache: qualified command key -> XML string
// Survives for the lifetime of the extension host process.
const _xmlCache = new Map<string, string>();

/** Clear the XML cache (call when the user explicitly wants a fresh fetch). */
export function clearCMDXMLCache(cmdKey?: string): void {
    if (cmdKey) {
        _xmlCache.delete(cmdKey);
    } else {
        _xmlCache.clear();
    }
}

// Utility: Fetch or return XML for a command
export async function getCMDXML(cmdString: string): Promise<string> {
    if (!code4i) {
        vscode.window.showErrorMessage("Code for IBM i extension is not available.");
        return '';
    }
    const connection = code4i.instance.getConnection();
    const c4iConfig = connection.getConfig();
    console.log(`Using CodeFori: tempDir="${c4iConfig.tempDir}"`);
    // The input cmdString can be full CL Command (with or without parameters)
    // We call buildAPI2PartName that puts out the command and optional library name
    // placing it into the cmdName variable as a 20-byte API-friendly qualified object name
    const cmdName = buildAPI2PartName(cmdString);

    // Convert Uint8Array to string for logging and CL command
    const cmdNameStr = new TextDecoder().decode(cmdName);
    console.log(`[clPrompter] Getting XML for: ${cmdNameStr}`);

    // Now we need to pull out the command name from the up to first 10 characters.
    // and the library name (LIB) from positions 11 to 20 (if they exist).
    const OBJNAME = new TextDecoder().decode(cmdName.subarray(0, 10)).trim();
    let LIBNAME = cmdName.length >= 20 ? new TextDecoder().decode(cmdName.subarray(10, 20)).trim() : '';
    if (!LIBNAME) {
        LIBNAME = '*LIBL';
    }

    // Use up to the first 10 non-blank characters of cmdName for the filename
    // If the command is qualified, use the library name in the xml file name for uniqueness.
    // If the commadn is unqualied, then use just the command name.
    const trimmedCmdName = cmdNameStr.trim().substring(0, 10).replace(/\s+$/, '');
    let cmdXMLName = '';
    if (LIBNAME.length > 0 && LIBNAME !== '*LIBL') {
        cmdXMLName = `${LIBNAME}_`;
    }
    cmdXMLName += OBJNAME;
    const outFile = `${c4iConfig.tempDir.replace(/\/?$/, '/')}${cmdXMLName}.cmd`;
    const fileParm = buildQlgPathNameHex(outFile);  // Create an QlgPathName_T for this outfile

    // --- Cache check: skip the 20+ second IBM i round-trip on repeat prompts ---
    if (_xmlCache.has(cmdXMLName)) {
        console.log(`[clPrompter] getCMDXML cache HIT for ${cmdXMLName}`);
        return _xmlCache.get(cmdXMLName)!;
    }

    const QCDRCMDD = `CALL QCDRCMDD PARM('${cmdNameStr}' X'${fileParm}' 'DEST0200' ' ' 'CMDD0200' X'000000000000')`;
    console.log(`[clPrompter] Calling API: ${QCDRCMDD}`);

    // Use VSCODEforIBMi to get the Command Definition XML file from the IFS
    const t0 = Date.now();
    const result = await connection.runCommand({
        command: QCDRCMDD,
        environment: `ile`
    });
    console.log(`[clPrompter] runCommand (QCDRCMDD) took ${Date.now() - t0}ms, code=${result.code}`);
    if (result.code === 0) {
        const t1 = Date.now();
        const cmdxml = await vscode.workspace.openTextDocument(vscode.Uri.from({
            scheme: 'streamfile',
            path: outFile,
            query: 'readonly=true'
        }));
        console.log(`[clPrompter] openTextDocument (IFS read) took ${Date.now() - t1}ms, total getCMDXML=${Date.now() - t0}ms`);
        if (cmdxml) {
            const xml = cmdxml.getText();
            _xmlCache.set(cmdXMLName, xml);
            return xml;
        }

    } else {
        vscode.window.showWarningMessage(`Command completed with code ${result.code}: ${result.stderr || result.stdout}`);
    }
    // Placeholder for unknown commands
    return `<QcdCLCmd><Cmd CmdName="${cmdNameStr}"></Cmd></QcdCLCmd>`;
}
