import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { ComponentIdentification, ComponentState, IBMiComponent, SecureComponentState } from '@halcyontech/vscode-ibmi-types/api/components/component';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

import { getCmdHelpCPPSrc } from './cmdHelp/cmdHelpCppSource';
import { getCmdHelpSQLSrc } from './cmdHelp/cmdHelpSqlSource';
import { getCmdRunCPPSrc } from './cmdRun/cmdRunCppSource';
import { getCmdRunSQLSrc } from './cmdRun/cmdRunSqlSource';
import { getCmdXmlCPPSrc } from './cmdXml/cmdXmlCppSource';
import { getCmdXmlSQLSrc } from './cmdXml/cmdXmlSqlSource';

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Resolves the target library for clPrompter UDTFs.
 * *TEMPLIB (default) → Code for IBM i's configured temp library.
 * Any other value is used as-is (e.g. SQLTOOLS or a custom library name).
 *
 * Exported so getcmdxml.ts can reuse it without duplication.
 */
export function getUDTFLibrary(connection: IBMi): string {
    const configured = vscode.workspace
        .getConfiguration('clPrompter')
        .get<string>('udtfSupportLibrary', '*TEMPLIB')
        .trim()
        .toUpperCase();
    if (!configured || configured === '*TEMPLIB') {
        const tempLib = (connection.getConfig().tempLibrary as string | undefined)?.trim().toUpperCase();
        return tempLib || 'ILEDITOR';
    }
    return configured;
}

/**
 * Returns the installed version number of a specific function, or -1 if not found.
 * Version is stored as the leading integer in LONG_COMMENT, e.g. '1 - description'.
 */
async function getUDTFVersion(connection: IBMi, schema: string, specificName: string): Promise<number> {
    const sql = `SELECT CAST(LONG_COMMENT AS VARCHAR(200)) AS LONG_COMMENT \
FROM qsys2.sysroutines \
WHERE ROUTINE_SCHEMA = '${schema.toUpperCase()}' \
  AND SPECIFIC_NAME  = '${specificName.toUpperCase()}'`;
    const [result] = await connection.runSQL(sql);
    if (result?.LONG_COMMENT) {
        const comment = String(result.LONG_COMMENT);
        const dash = comment.indexOf('-');
        if (dash > -1) {
            const v = Number(comment.substring(0, dash).trim());
            if (!isNaN(v)) { return v; }
        }
    }
    return -1;
}

// ---------------------------------------------------------------------------
// Abstract base — shared compile/install flow for all C++ UDTFs
// ---------------------------------------------------------------------------

/**
 * Base class for clPrompter host-side UDTFs.
 *
 * Subclasses declare the UDTF-specific constants and source generators;
 * this class implements the shared 6-step install pipeline:
 *   1. Upload C++ source to a temp IFS path
 *   2. Ensure the target library exists (CRTLIB)
 *   3. Compile the module (CRTCPPMOD)
 *   4. Link the program (CRTPGM)
 *   5. Upload the SQL DDL
 *   6. Create/replace the UDTF (RUNSQLSTM)
 */
abstract class UDTFChecker implements IBMiComponent {
    /** Unique component name — must match the static ID of each subclass. */
    abstract readonly id: string;
    /** IBM i program name for CRTCPPMOD/CRTPGM, e.g. 'CMDHELP' or 'CMDXML'. */
    abstract readonly PGM_NAME: string;
    /** SQL specific-routine name, e.g. 'cmd_help' or 'cmd_xml'. */
    abstract readonly UDTF_SPECIFIC: string;
    abstract readonly currentVersion: number;

    abstract getCPPSrc(): string;
    abstract getSQLSrc(library: string, version: number): string;

    getIdentification(): ComponentIdentification {
        // Code for IBM i 3.x identifies managed components by a stable content
        // signature in addition to their human-readable version. Include both
        // generated artifacts so a changed UDTF is distinguishable even before
        // its version is bumped.
        const signature = createHash('sha256')
            .update(this.getCPPSrc())
            .update(this.getSQLSrc('__CLPROMPTER_SIGNATURE__', this.currentVersion))
            .digest('hex');
        return { name: this.id, version: this.currentVersion, signature };
    }

    async getRemoteState(connection: IBMi, _installDirectory: string): Promise<SecureComponentState> {
        const library = getUDTFLibrary(connection);
        const localSignature = this.getIdentification().signature;
        console.log(`[clPrompter] ${this.id}.getRemoteState() — library=${library}`);
        try {
            const version = await getUDTFVersion(connection, library, this.UDTF_SPECIFIC);
            const status: ComponentState = version >= this.currentVersion ? 'Installed' : 'NeedsUpdate';
            console.log(`[clPrompter] ${this.id}.getRemoteState() — version=${version}, status=${status}`);
            return {
                status,
                remoteSignature: localSignature
            };
        } catch (e) {
            console.log(`[clPrompter] ${this.id}.getRemoteState() — query threw: ${e}, returning NeedsUpdate`);
            return {
                status: 'NeedsUpdate',
                remoteSignature: localSignature
            };
        }
    }

    async update(connection: IBMi, _installDirectory: string): Promise<SecureComponentState> {
        console.log(`[clPrompter] ${this.id}.update() — starting install`);
        return connection.withTempDirectory(async (tempDir: string) => {
            const content = connection.getContent();
            const encoder = new TextEncoder();
            const library = getUDTFLibrary(connection);
            console.log(`[clPrompter] ${this.id}.update() — tempDir=${tempDir}, library=${library}`);

            // ── Step 1: upload C++ source ──────────────────────────────────
            // tempDir is a unique path prefix, not a subdirectory — append with '_'
            const cppPath = `${tempDir}_${this.PGM_NAME}.cpp`;
            const cppBytes = encoder.encode(this.getCPPSrc());
            console.log(`[clPrompter] ${this.id}.update() — uploading C++ to ${cppPath} (${cppBytes.length} bytes)`);
            let cppUploadErr: string | void;
            try {
                cppUploadErr = await content.writeStreamfileRaw(cppPath, cppBytes);
            } catch (e) {
                console.error(`[clPrompter] writeStreamfileRaw(cpp) threw: ${e}`);
                return {
                    status: 'Error',
                    remoteSignature: this.getIdentification().signature
                };
            }
            if (cppUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(cpp) failed: ${cppUploadErr}`);
                return {
                    status: 'Error',
                    remoteSignature: this.getIdentification().signature
                };
            }
            const cppVerify = await connection.runCommand({ command: `ls -la '${cppPath}'`, environment: 'pase' });
            console.log(`[clPrompter] ${this.id}.update() — cpp verify (code=${cppVerify.code}): ${cppVerify.stdout || cppVerify.stderr}`);

            // ── Step 1b: ensure target library exists ──────────────────────
            const crtlibResult = await connection.runCommand({ command: `CRTLIB LIB(${library})`, noLibList: true });
            console.log(`[clPrompter] ${this.id}.update() — CRTLIB(${library}) code=${crtlibResult.code}: ${crtlibResult.stderr}`);
            // Non-zero just means library already existed — that's fine.

            // ── Step 2: CRTCPPMOD ─────────────────────────────────────────
            const crtcppmodCmd = `CRTCPPMOD MODULE(${library}/${this.PGM_NAME}) SRCSTMF('${cppPath}') LANGLVL(*EXTENDED0X) SYSIFCOPT(*IFS64IO) OUTPUT(*PRINT)`;
            console.log(`[clPrompter] ${this.id}.update() — running: ${crtcppmodCmd}`);
            const moduleResult = await connection.runCommand({ command: crtcppmodCmd, noLibList: true });
            if (moduleResult.code !== 0) {
                console.error(`[clPrompter] CRTCPPMOD failed (code=${moduleResult.code})`);
                console.error(`[clPrompter] CRTCPPMOD stdout: ${moduleResult.stdout}`);
                console.error(`[clPrompter] CRTCPPMOD stderr: ${moduleResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: this.getIdentification().signature
                };
            }

            // ── Step 3: CRTPGM ────────────────────────────────────────────
            const pgmResult = await connection.runCommand({
                command: `CRTPGM PGM(${library}/${this.PGM_NAME}) MODULE(${library}/${this.PGM_NAME}) ACTGRP(*CALLER)`,
                noLibList: true
            });
            if (pgmResult.code !== 0) {
                console.error(`[clPrompter] CRTPGM failed for ${this.PGM_NAME}: ${pgmResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: this.getIdentification().signature
                };
            }

            // ── Step 4: upload SQL DDL ─────────────────────────────────────
            const sqlPath = `${tempDir}_${this.UDTF_SPECIFIC}.sql`;
            const sqlUploadErr = await content.writeStreamfileRaw(
                sqlPath,
                encoder.encode(this.getSQLSrc(library, this.currentVersion))
            );
            if (sqlUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(sql) failed: ${sqlUploadErr}`);
                return {
                    status: 'Error',
                    remoteSignature: this.getIdentification().signature
                };
            }

            // ── Step 5: drop existing specific function (ignore error) ─────
            try {
                await connection.runSQL(`DROP SPECIFIC FUNCTION ${library}.${this.UDTF_SPECIFIC}`);
            } catch {
                // UDTF may not exist yet — that's fine
            }

            // ── Step 6: RUNSQLSTM to create/replace the UDTF ──────────────
            const sqlResult = await connection.runCommand({
                command: `RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SYS)`,
                noLibList: true
            });
            if (sqlResult.code !== 0) {
                console.error(`[clPrompter] RUNSQLSTM failed for ${this.UDTF_SPECIFIC}: ${sqlResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: this.getIdentification().signature
                };
            }

            console.log(`[clPrompter] ${this.UDTF_SPECIFIC} UDTF installed in ${library} (version ${this.currentVersion})`);
            return {
                status: 'Installed',
                remoteSignature: this.getIdentification().signature
            };
        });
    }

    reset(): void {
        // No per-connection state to clear — library is re-read from settings each time
    }
}

// ---------------------------------------------------------------------------
// Concrete UDTF checkers
// ---------------------------------------------------------------------------

/**
 * Manages the CMD_HELP UDTF — retrieves CL parameter helptext via QUHRHLPT.
 */
export class CmdHelpChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.CmdHelpChecker';
    readonly id = CmdHelpChecker.ID;
    readonly PGM_NAME = 'CMDHELP';
    readonly UDTF_SPECIFIC = 'cmd_help';
    readonly currentVersion = 3;

    getCPPSrc(): string { return getCmdHelpCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdHelpSQLSrc(library, version); }
}

/**
 * Manages the CMD_XML UDTF — returns full command definition XML via QCDRCMDD.
 * Replaces the previous approach of calling QCDRCMDD via runSQL('@...') and
 * reading the result from a temp IFS file.
 */
export class CmdXmlChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.CmdXmlChecker';
    readonly id = CmdXmlChecker.ID;
    readonly PGM_NAME = 'CMDXML';
    readonly UDTF_SPECIFIC = 'cmd_xml';
    readonly currentVersion = 1;

    getCPPSrc(): string { return getCmdXmlCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdXmlSQLSrc(library, version); }
}

/**
 * Manages the CMD_RUN UDTF — runs or checks CL commands via QCAPCMD.
 */
export class CmdRunChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.CmdRunChecker';
    readonly id = CmdRunChecker.ID;
    readonly PGM_NAME = 'CMDRUN';
    readonly UDTF_SPECIFIC = 'cmd_run';
    readonly currentVersion = 1;

    getCPPSrc(): string { return getCmdRunCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdRunSQLSrc(library, version); }
}
