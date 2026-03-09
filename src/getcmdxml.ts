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


    const QCDRCMDD = `CALL QCDRCMDD PARM('${cmdNameStr}' X'${fileParm}' 'DEST0200' ' ' 'CMDD0200' X'000000000000')`;
    console.log(`[clPrompter] Calling API: ${QCDRCMDD}`);

    // Use VSCODEforIBMi to get the Command Definition XML file from the IFS
    const result = await connection.runCommand({
        command: QCDRCMDD,
        environment: `ile`
    });
    if (result.code === 0) {
        const cmdxml = await vscode.workspace.openTextDocument(vscode.Uri.from({
            scheme: 'streamfile',
            path: outFile,
            query: 'readonly=true' // Optional: open in read-only mode
        }));
        if (cmdxml) {
            return cmdxml.getText();
        }

    } else {
        vscode.window.showWarningMessage(`Command completed with code ${result.code}: ${result.stderr || result.stdout}`);
    }
    // Placeholder for unknown commands
    return `<QcdCLCmd><Cmd CmdName="${cmdNameStr}"></Cmd></QcdCLCmd>`;
}
