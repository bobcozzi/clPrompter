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
import { code4i, getPendingExternalSQL } from './extension';

import { buildQlgPathNameHex, buildAPI2PartName, buildQualName } from './QlgPathName';
import { getUDTFLibrary } from './components/hostFunctions';

// In-memory cache: qualified command key -> XML string
// Survives for the lifetime of the extension host process.
const _xmlCache = new Map<string, string>();

// Set to true after the first sqlJob property inspection so we only dump once.
let _sqlJobInspected = false;

/** Log all own + prototype property names of the sqlJob object once, to help
 *  identify any "current SQL" or "last SQL" property exposed by mapepire-js. */
function _inspectSqlJobOnce(sqlJob: any): void {
    if (_sqlJobInspected || !sqlJob) { return; }
    _sqlJobInspected = true;
    const ownKeys = Object.getOwnPropertyNames(sqlJob);
    const protoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(sqlJob) ?? {});
    console.log(`[clPrompter] sqlJob own properties: ${ownKeys.join(', ')}`);
    console.log(`[clPrompter] sqlJob prototype properties: ${protoKeys.join(', ')}`);
    // Probe candidate "current/last SQL" property names
    const candidates = ['sql', 'currentSql', 'lastSql', 'currentQuery', 'lastQuery',
        'currentStatement', 'pendingSql', 'activeSql', 'statement', 'query'];
    for (const key of candidates) {
        if (key in sqlJob) {
            console.log(`[clPrompter] sqlJob.${key} = ${JSON.stringify(sqlJob[key])}`);
        }
    }
}

// In-flight dedup: tracks promises for commands currently being fetched.
// Concurrent getCMDXML calls for the same key share one promise instead of
// each spinning up their own cold Mapepire/JVM service job.
const _inflight = new Map<string, Promise<string>>();

/** Clear the XML cache (call when the user explicitly wants a fresh fetch). */
export function clearCMDXMLCache(cmdKey?: string): void {
    if (cmdKey) {
        _xmlCache.delete(cmdKey);
    } else {
        _xmlCache.clear();
    }
}

/**
 * Silently pre-warms the XML cache for a given command name (e.g. "CPYF").
 *
 * Identical outcome to getCMDXML() but with no progress notification — safe to
 * call in parallel at connect time without flooding the VS Code toast area.
 *
 * Registers the in-flight promise in `_inflight` so that if the user triggers
 * F4 while the warm is still running, getCMDXML() will attach to the same
 * promise instead of spinning up a second QCDRCMDD call for the same command.
 */
export async function warmXmlCache(cmd: string): Promise<void> {
    if (!code4i) { return; }
    const connection = code4i.instance.getConnection();
    if (!connection) { return; }

    const c4iConfig = connection.getConfig();
    const qualName = buildAPI2PartName(cmd);
    const nameStr = new TextDecoder().decode(qualName);
    const OBJNAME = new TextDecoder().decode(qualName.subarray(0, 10)).trim();
    let LIBNAME = qualName.length >= 20 ? new TextDecoder().decode(qualName.subarray(10, 20)).trim() : '';
    if (!LIBNAME) { LIBNAME = '*LIBL'; }

    let cmdXMLName = '';
    if (LIBNAME.length > 0 && LIBNAME !== '*LIBL') { cmdXMLName = `${LIBNAME}_`; }
    cmdXMLName += OBJNAME;

    // Already cached or a fetch is already in flight (could be a user-triggered getCMDXML)
    if (_xmlCache.has(cmdXMLName) || _inflight.has(cmdXMLName)) { return; }

    const outFile = `${c4iConfig.tempDir.replace(/\/?$/, '/')}${cmdXMLName}.cmd`;
    const fileParm = buildQlgPathNameHex(outFile);
    const QCDRCMDD = `CALL QCDRCMDD PARM('${nameStr}' X'${fileParm}' 'DEST0200' ' ' 'CMDD0200' X'000000000000')`;
    const t0 = Date.now();
    const warmPath = connection.sqlRunnerAvailable() ? 'CMD_XML UDTF' : 'QCDRCMDD fallback';
    console.log(`[clPrompter] warmXmlCache Not-Cached for ${OBJNAME} — sqlRunnerAvailable=${connection.sqlRunnerAvailable()}, path=${warmPath}`);

    const fetchPromise: Promise<string> = (async () => {
        try {
            let udtfSucceeded = false;
            if (connection.sqlRunnerAvailable()) {
                try {
                    const esc = (s: string) => s.replace(/'/g, "''");
                    const library = getUDTFLibrary(connection);
                    const sql = `SELECT CMD_XML FROM TABLE(${library}.CMD_XML('${esc(LIBNAME)}', '${esc(OBJNAME)}'))`;
                    const jobStatusBefore: string | undefined = (connection as any).sqlJob?.getStatus?.();
                    const _pendingWarm = getPendingExternalSQL();
                    const _busyExtraWarm = _pendingWarm
                        ? ` — competing SQL running ${Date.now() - _pendingWarm.t0}ms: ${_pendingWarm.sql.substring(0, 200)}`
                        : '';
                    console.log(`[clPrompter] warmXmlCache: SQLJob status before UDTF for ${OBJNAME}: ${jobStatusBefore ?? 'unknown'}${_busyExtraWarm}`);
                    const results = await connection.runSQL(sql);
                    if (results.length > 0 && results[0].CMD_XML) {
                        const xml = String(results[0].CMD_XML);
                        _xmlCache.set(cmdXMLName, xml);
                        console.log(`[clPrompter] warmXmlCache: ${OBJNAME} cached in ${Date.now() - t0}ms (${xml.length} bytes)`);
                        udtfSucceeded = true;
                    }
                } catch (e: any) {
                    console.log(`[clPrompter] warmXmlCache CMD_XML UDTF failed for ${OBJNAME}, falling back to QCDRCMDD: ${e?.message ?? e}`);
                }
            }
            if (!udtfSucceeded) {
                const result = await connection.runCommand({ command: QCDRCMDD, environment: 'ile' });
                if (result.code === 0) {
                    const doc = await vscode.workspace.openTextDocument(vscode.Uri.from({
                        scheme: 'streamfile',
                        path: outFile,
                        query: 'readonly=true'
                    }));
                    if (doc) {
                        const xml = doc.getText();
                        _xmlCache.set(cmdXMLName, xml);
                        console.log(`[clPrompter] warmXmlCache: ${OBJNAME} cached via QCDRCMDD in ${Date.now() - t0}ms (${xml.length} bytes)`);
                    }
                }
            }
        } catch (e: any) {
            console.log(`[clPrompter] warmXmlCache for ${OBJNAME} failed (non-critical): ${e?.message ?? e}`);
        }
        return _xmlCache.get(cmdXMLName) ?? '';
    })();

    _inflight.set(cmdXMLName, fetchPromise);
    fetchPromise.finally(() => _inflight.delete(cmdXMLName));
    await fetchPromise;
}

// Utility: Fetch or return XML for a command
export async function getCMDXML(cmdString: string): Promise<string> {
    if (!code4i) {
        vscode.window.showErrorMessage("Code for IBM i (CodeForIBMi) extension is not found and is required.");
        return '';
    }
    // Check if connection was good, if not inform the end-user
    // that they must be connected to IBM i host or prompting is unavailable.
    const connection = code4i.instance.getConnection();
    if (!connection) {
        vscode.window.showErrorMessage("Not connected to IBM i host. CL prompting not available.");
        return '';
    }
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
        console.log(`[clPrompter] getCMDXML Cached: ${cmdXMLName}`);
        return _xmlCache.get(cmdXMLName)!;
    }

    // --- In-flight dedup: coalesce concurrent requests for the same command key ---
    // Prevents multiple simultaneous F4 presses (or any other concurrent callers)
    // from each acquiring their own cold Mapepire/JVM service job for the same command.
    const existing = _inflight.get(cmdXMLName);
    if (existing) {
        console.log(`[clPrompter] getCMDXML in-flight for ${cmdXMLName}`);
        return existing;
    }

    // Build and register the fetch promise SYNCHRONOUSLY (before the first await)
    // so any concurrent call arriving after this point will find it in _inflight.
    const sqlAvail = connection.sqlRunnerAvailable();
    console.log(`[clPrompter] getCMDXML Not-Cached for ${cmdXMLName} — sqlRunnerAvailable=${sqlAvail}, primary=${sqlAvail ? 'CMD_XML UDTF' : 'QCDRCMDD fallback'}`);

    const fetchPromise: Promise<string> = Promise.resolve(vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'CL Prompter',
        cancellable: false
    }, async (progress) => {
        progress.report({ message: `Fetching ${OBJNAME} definition from IBM i...` });
        const t0 = Date.now();

        let xml: string | undefined;

        // --- Primary path: CMD_XML UDTF (fast, ~10ms when JVM is warm) ---
        if (sqlAvail) {
            const esc = (s: string) => s.replace(/'/g, "''");
            const library = getUDTFLibrary(connection);
            const sql = `SELECT CMD_XML FROM TABLE(${library}.CMD_XML('${esc(LIBNAME)}', '${esc(OBJNAME)}'))`;
            const sqlJob = (connection as any).sqlJob;
            const jobStatusBefore: string | undefined = sqlJob?.getStatus?.();
            _inspectSqlJobOnce(sqlJob);
            const _pendingGet = getPendingExternalSQL();
            const _busyExtraGet = _pendingGet
                ? ` — competing SQL running ${Date.now() - _pendingGet.t0}ms: ${_pendingGet.sql.substring(0, 200)}`
                : '';
            console.log(`[clPrompter] getCMDXML: SQLJob status before UDTF for ${cmdXMLName}: ${jobStatusBefore ?? 'unknown'}${_busyExtraGet}`);
            if (_pendingGet) {
                progress.report({ message: `Waiting for IBM i SQL job... ${_pendingGet.sql.substring(0, 120)}` });
            }
            try {
                const results = await connection.runSQL(sql);
                console.log(`[clPrompter] CMD_XML UDTF took ${Date.now() - t0}ms`);
                if (results.length > 0 && results[0].CMD_XML) {
                    xml = String(results[0].CMD_XML);
                }
            } catch (e: any) {
                console.log(`[clPrompter] CMD_XML UDTF failed after ${Date.now() - t0}ms, falling back to QCDRCMDD: ${e.message || e}`);
            }
        }

        // --- Fallback: QCDRCMDD via runCommand (UDTF unavailable or failed) ---
        if (!xml) {
            const QCDRCMDD = `CALL QCDRCMDD PARM('${cmdNameStr}' X'${fileParm}' 'DEST0200' ' ' 'CMDD0200' X'000000000000')`;
            const result = await connection.runCommand({ command: QCDRCMDD, environment: `ile` });
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
                    xml = cmdxml.getText();
                }
            } else {
                vscode.window.showWarningMessage(`Cannot prompt '${cmdString.trim().toUpperCase()}': ${result.stderr || result.stdout}`);
            }
        }

        if (xml) {
            _xmlCache.set(cmdXMLName, xml);
            return xml;
        }
        // Placeholder for unknown commands
        return `<QcdCLCmd><Cmd CmdName="${cmdNameStr}"></Cmd></QcdCLCmd>`;
    }));

    _inflight.set(cmdXMLName, fetchPromise);
    fetchPromise.finally(() => _inflight.delete(cmdXMLName));
    return fetchPromise;
}

// ---------------------------------------------------------------------------
// CMD_HELP UDTF — fast parameter helptext via SQL table function
// ---------------------------------------------------------------------------

/**
 * Retrieve XML helptext for a single CL parameter keyword via the CMD_HELP UDTF.
 * Returns the raw HELP_XML string, or null if the UDTF is unavailable or the
 * parameter was not found.
 *
 * @param cmdLib  Library of the command, e.g. "QSYS" or "*LIBL"
 * @param cmdName Command name, e.g. "CPYF"
 * @param kwd     Parameter keyword, e.g. "FROMFILE"
 */
export async function getCmdHelpViaUDTF(cmdLib: string, cmdName: string, kwd: string): Promise<string | null> {
    if (!code4i) { return null; }
    const connection = code4i.instance.getConnection();
    if (!connection) { return null; }
    if (!connection.sqlRunnerAvailable()) { return null; }
    const esc = (s: string) => s.replace(/'/g, "''");
    const library = getUDTFLibrary(connection);
    const sql = `SELECT HELP_XML FROM TABLE(${library}.CMD_HELP('${esc(cmdLib)}', '${esc(cmdName)}', '${esc(kwd)}'))`;
    const doFetch = async (): Promise<string | null> => {
        try {
            const results = await connection.runSQL(sql);
            if (results.length > 0 && results[0].HELP_XML) {
                return String(results[0].HELP_XML);
            }
            return null;
        } catch (e: any) {
            console.log('[clPrompter] getCmdHelpViaUDTF error:', e?.message ?? e);
            return null;
        }
    };
    const pendingExt = getPendingExternalSQL();
    if (pendingExt) {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'CL Prompter',
            cancellable: false
        }, async (progress) => {
            progress.report({ message: `Waiting for IBM i SQL job... ${pendingExt.sql.substring(0, 120)}` });
            return doFetch();
        });
    }
    return doFetch();
}
