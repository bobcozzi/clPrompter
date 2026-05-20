import * as vscode from 'vscode';
import { ComponentIdentification, ComponentState, IBMiComponent } from '@halcyontech/vscode-ibmi-types/api/components/component';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { getCmdHelpCPPSrc } from './cppSource';
import { getCmdHelpSQLSrc } from './sqlSource';

/**
 * IBMiComponent that manages the CMD_HELP UDTF on IBM i.
 *
 * On first connection (or when a version mismatch is detected) this component:
 *   1. Uploads CMDHELP.CPP to a temp IFS directory
 *   2. Compiles it with CRTCPPMOD + CRTPGM into the configured udtfSupportLibrary
 *   3. Uploads the parameterized SQL DDL and runs RUNSQLSTM to create/replace
 *      the CMD_HELP UDTF
 *
 * Subsequent connections simply verify the version via qsys2.sysroutines and
 * skip the install when the UDTF is already current.
 *
 * The target library is driven by the `clPrompter.udtfSupportLibrary` setting.
 * *TEMPLIB (default) uses Code for IBM i's configured temp library.
 */
export class CmdHelpChecker implements IBMiComponent {
    static readonly ID = 'CmdHelpChecker';
    static readonly PGM_NAME = 'CMDHELP';
    static readonly UDTF_SPECIFIC = 'cmd_help';

    private readonly currentVersion = 1;

    getIdentification(): ComponentIdentification {
        return { name: CmdHelpChecker.ID, version: this.currentVersion };
    }

    async getRemoteState(connection: IBMi, _installDirectory: string): Promise<ComponentState> {
        const library = getUDTFLibrary(connection);
        console.log(`[clPrompter] CmdHelpChecker.getRemoteState() — library=${library}`);
        try {
            const version = await getUDTFVersion(connection, library, CmdHelpChecker.UDTF_SPECIFIC);
            const state: ComponentState = version >= this.currentVersion ? 'Installed' : 'NeedsUpdate';
            console.log(`[clPrompter] CmdHelpChecker.getRemoteState() — version=${version}, state=${state}`);
            return state;
        } catch (e) {
            console.log(`[clPrompter] CmdHelpChecker.getRemoteState() — query threw: ${e}, returning NeedsUpdate`);
            return 'NeedsUpdate';
        }
    }

    async update(connection: IBMi, _installDirectory: string): Promise<ComponentState> {
        console.log(`[clPrompter] CmdHelpChecker.update() — starting install`);
        return connection.withTempDirectory(async (tempDir: string) => {
            const content = connection.getContent();
            const encoder = new TextEncoder();
            const library = getUDTFLibrary(connection);
            console.log(`[clPrompter] CmdHelpChecker.update() — tempDir=${tempDir}, library=${library}`);

            // ── Step 1: upload C++ source ──────────────────────────────────────
            // tempDir is a unique path prefix, not a subdirectory — append with '_'
            const cppPath = `${tempDir}_${CmdHelpChecker.PGM_NAME}.cpp`;
            const cppSrc = getCmdHelpCPPSrc();
            const cppBytes = encoder.encode(cppSrc);
            console.log(`[clPrompter] CmdHelpChecker.update() — uploading C++ source to ${cppPath} (${cppBytes.length} bytes)`);
            let cppUploadErr: string | void;
            try {
                cppUploadErr = await content.writeStreamfileRaw(cppPath, cppBytes);
            } catch (e) {
                console.error(`[clPrompter] writeStreamfileRaw(cpp) threw: ${e}`);
                return 'Error';
            }
            if (cppUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(cpp) failed: ${cppUploadErr}`);
                return 'Error';
            }
            // Verify the file actually landed on the IFS
            const cppVerify = await connection.runCommand({ command: `ls -la '${cppPath}'`, environment: 'pase' });
            console.log(`[clPrompter] CmdHelpChecker.update() — cpp upload verify (code=${cppVerify.code}): ${cppVerify.stdout || cppVerify.stderr}`);

            // ── Step 1b: ensure target library exists ──────────────────────
            const crtlibResult = await connection.runCommand({ command: `CRTLIB LIB(${library})`, noLibList: true });
            console.log(`[clPrompter] CmdHelpChecker.update() — CRTLIB(${library}) code=${crtlibResult.code}: ${crtlibResult.stderr}`);
            // Non-zero just means library already existed — that's fine.

            // ── Step 2: CRTCPPMOD ─────────────────────────────────────────────
            const crtcppmodCmd = `CRTCPPMOD MODULE(${library}/${CmdHelpChecker.PGM_NAME}) SRCSTMF('${cppPath}') LANGLVL(*EXTENDED0X) SYSIFCOPT(*IFS64IO) OUTPUT(*PRINT)`;
            console.log(`[clPrompter] CmdHelpChecker.update() — running: ${crtcppmodCmd}`);
            const moduleResult = await connection.runCommand({ command: crtcppmodCmd, noLibList: true });
            if (moduleResult.code !== 0) {
                console.error(`[clPrompter] CRTCPPMOD failed (code=${moduleResult.code})`);
                console.error(`[clPrompter] CRTCPPMOD stdout: ${moduleResult.stdout}`);
                console.error(`[clPrompter] CRTCPPMOD stderr: ${moduleResult.stderr}`);
                return 'Error';
            }

            // ── Step 3: CRTPGM ────────────────────────────────────────────────
            const pgmResult = await connection.runCommand({
                command: `CRTPGM PGM(${library}/${CmdHelpChecker.PGM_NAME}) MODULE(${library}/${CmdHelpChecker.PGM_NAME}) ACTGRP(*CALLER)`,
                noLibList: true
            });
            if (pgmResult.code !== 0) {
                console.error(`[clPrompter] CRTPGM failed for CMD_HELP: ${pgmResult.stderr}`);
                return 'Error';
            }

            // ── Step 4: upload SQL DDL ────────────────────────────────────────
            const sqlPath = `${tempDir}_${CmdHelpChecker.UDTF_SPECIFIC}.sql`;
            const sqlUploadErr = await content.writeStreamfileRaw(
                sqlPath,
                encoder.encode(getCmdHelpSQLSrc(library, this.currentVersion))
            );
            if (sqlUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(sql) failed: ${sqlUploadErr}`);
                return 'Error';
            }

            // ── Step 5: drop existing specific function (ignore error) ────────
            try {
                await connection.runSQL(`DROP SPECIFIC FUNCTION ${library}.${CmdHelpChecker.UDTF_SPECIFIC}`);
            } catch {
                // UDTF may not exist yet — that's fine
            }

            // ── Step 6: RUNSQLSTM to create the UDTF ─────────────────────────
            const sqlResult = await connection.runCommand({
                command: `RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SYS)`,
                noLibList: true
            });
            if (sqlResult.code !== 0) {
                console.error(`[clPrompter] RUNSQLSTM failed for CMD_HELP UDTF: ${sqlResult.stderr}`);
                return 'Error';
            }

            console.log(`[clPrompter] CMD_HELP UDTF installed in ${library} (version ${this.currentVersion})`);
            return 'Installed';
        });
    }

    reset(): void {
        // No per-connection state to clear — library is re-read from settings each time
    }
}

/**
 * Resolves the target library for clPrompter UDTFs.
 * *TEMPLIB (default) → use Code for IBM i's configured temp library.
 * Any other value is used as-is (e.g. SQLTOOLS, SYSTOOLS, or a custom library name).
 */
function getUDTFLibrary(connection: IBMi): string {
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
 * Version is stored as the leading integer in the LONG_COMMENT, e.g. '1 - description'.
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
