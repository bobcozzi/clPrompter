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
import { getFieldListCPPSrc } from './fieldList/fieldListCppSource';
import { getFieldListSQLSrc } from './fieldList/fieldListSqlSource';
import { getJobInfoRPGLESrc } from './jobInfo/jobInfoRpgleSource';
import { getJobInfoSQLSrc } from './jobInfo/jobInfoSqlSource';
import { appendClPrompterOutputLine } from '../clPrompterOutput';

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
    const configured = getConfiguredUDTFSupportLibrary();
    if (!configured || configured === '*TEMPLIB') {
        const tempLib = (connection.getConfig().tempLibrary as string | undefined)?.trim().toUpperCase();
        return tempLib || 'ILEDITOR';
    }
    return configured;
}

function getConfiguredUDTFSupportLibrary(): string {
    return vscode.workspace
        .getConfiguration('clPrompter')
        .get<string>('udtfSupportLibrary', '*TEMPLIB')
        .trim()
        .toUpperCase();
}

function getSignatureLibraryForIdentification(): string {
    const configured = getConfiguredUDTFSupportLibrary();
    // Signature identification must be stable even before a connection exists.
    // Keep the configured token as-is (*TEMPLIB or explicit library) so Code for
    // IBM i compares deterministic local/remote values during startup checks.
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
        const leadingVersion = /^\s*(\d+)/.exec(comment);
        if (leadingVersion?.[1]) {
            const parsed = Number(leadingVersion[1]);
            if (!isNaN(parsed)) { return parsed; }
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
 *   3. Compile the module (CRTSQLCPPI)
 *   4. Link the program (CRTPGM)
 *   5. Upload the SQL DDL
 *   6. Create/replace the UDTF (RUNSQLSTM)
 */
abstract class UDTFChecker implements IBMiComponent {
    /** Unique component name — must match the static ID of each subclass. */
    abstract readonly id: string;
    /** IBM i program name for CRTSQLCPPI/CRTPGM, e.g. 'CMDHELP' or 'CMDXML'. */
    abstract readonly PGM_NAME: string;
    /** SQL specific-routine name, e.g. 'cmd_help' or 'cmd_xml'. */
    abstract readonly UDTF_SPECIFIC: string;
    abstract readonly currentVersion: number;

    abstract getCPPSrc(): string;
    abstract getSQLSrc(library: string, version: number): string;

    private getSignatureForLibrary(library: string): string {
        return createHash('sha256')
            .update(this.getCPPSrc())
            .update(this.getSQLSrc(library, this.currentVersion))
            .digest('hex');
    }

    getIdentification(): ComponentIdentification {
        // Code for IBM i 3.x identifies managed components by a stable content
        // signature in addition to their human-readable version. Include both
        // generated artifacts so a changed UDTF is distinguishable even before
        // its version is bumped.
        const signatureLibrary = getSignatureLibraryForIdentification();
        const signature = this.getSignatureForLibrary(signatureLibrary);
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
            const runtimeSignature = this.getIdentification().signature;
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
                    remoteSignature: runtimeSignature
                };
            }
            if (cppUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(cpp) failed: ${cppUploadErr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }
            const cppVerify = await connection.runCommand({ command: `ls -la '${cppPath}'`, environment: 'pase' });
            console.log(`[clPrompter] ${this.id}.update() — cpp verify (code=${cppVerify.code}): ${cppVerify.stdout || cppVerify.stderr}`);

            // ── Step 1b: ensure target library exists ──────────────────────
            const crtlibResult = await connection.runCommand({ command: `CRTLIB LIB(${library})`, noLibList: true });
            console.log(`[clPrompter] ${this.id}.update() — CRTLIB(${library}) code=${crtlibResult.code}: ${crtlibResult.stderr}`);
            // Non-zero just means library already existed — that's fine.

            // ── Step 2: CRTSQLCPPI ─────────────────────────────────────────
            const crtcppiCompileOpts = `LANGLVL(*EXTENDED0X) SYSIFCOPT(*IFS64IO)`;
            const crtcppiBaseCmd = `CRTSQLCPPI OBJ(${library}/${this.PGM_NAME}) SRCSTMF('${cppPath}')`;
            const crtcppiStaticParms = `CVTCCSID(*JOB) OUTPUT(*PRINT)`;
            const crtcppiCompileOptParm = `COMPILEOPT('${crtcppiCompileOpts}')`;
            const crtcppiCmd = `${crtcppiBaseCmd} ${crtcppiStaticParms} ${crtcppiCompileOptParm}`;
            appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — compile external program command: ${crtcppiCmd}`);
            console.log(`[clPrompter] ${this.id}.update() — running: ${crtcppiCmd}`);
            const moduleResult = await connection.runCommand({ command: crtcppiCmd, noLibList: true });
            if (moduleResult.code !== 0) {
                console.error(`[clPrompter] CRTSQLCPPI failed (code=${moduleResult.code})`);
                console.error(`[clPrompter] CRTSQLCPPI stdout: ${moduleResult.stdout}`);
                console.error(`[clPrompter] CRTSQLCPPI stderr: ${moduleResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
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
                    remoteSignature: runtimeSignature
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
                    remoteSignature: runtimeSignature
                };
            }

            // ── Step 5: drop existing specific function (ignore error) ─────
            try {
                await connection.runSQL(`DROP SPECIFIC FUNCTION ${library}.${this.UDTF_SPECIFIC}`);
            } catch {
                // UDTF may not exist yet — that's fine
            }

            // ── Step 6: RUNSQLSTM to create/replace the UDTF ──────────────
            const runsqlstmCmd = `RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SYS)`;
            appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — create/replace function command: ${runsqlstmCmd}`);
            appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — running: ${runsqlstmCmd}`);
            const sqlResult = await connection.runCommand({
                command: runsqlstmCmd,
                noLibList: true
            });
            if (sqlResult.code !== 0) {
                console.error(`[clPrompter] RUNSQLSTM failed for ${this.UDTF_SPECIFIC}: ${sqlResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }

            console.log(`[clPrompter] ${this.UDTF_SPECIFIC} UDTF installed in ${library} (version ${this.currentVersion})`);
            return {
                status: 'Installed',
                remoteSignature: runtimeSignature
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
    readonly currentVersion = 2;

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
    readonly currentVersion = 2;

    getCPPSrc(): string { return getCmdRunCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdRunSQLSrc(library, version); }
}

/**
 * Manages the FIELD_LIST UDTF — returns field metadata similar to DSPFFD.
 */
export class FieldListChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.FieldListChecker';
    readonly id = FieldListChecker.ID;
    readonly PGM_NAME = 'FIELDLIST';
    readonly UDTF_SPECIFIC = 'field_list';
    readonly currentVersion = 1;

    getCPPSrc(): string { return getFieldListCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getFieldListSQLSrc(library, version); }
}

/**
 * Manages the JOB_INFO UDTF — returns status and queue details for a target
 * job by wrapping the QUSRJOBI API in an RPGLE external program.
 */
export class JobInfoChecker implements IBMiComponent {
    static readonly ID = 'clPrompter.JobInfoChecker';
    readonly id = JobInfoChecker.ID;
    readonly PGM_NAME = 'JOB_INFO';
    readonly UDTF_SPECIFIC = 'job_info';
    readonly currentVersion = 1;

    getRPGLESrc(): string { return getJobInfoRPGLESrc(); }
    getSQLSrc(library: string, version: number): string { return getJobInfoSQLSrc(library, version); }

    private getSignatureForLibrary(library: string): string {
        return createHash('sha256')
            .update(this.getRPGLESrc())
            .update(this.getSQLSrc(library, this.currentVersion))
            .digest('hex');
    }

    getIdentification(): ComponentIdentification {
        const signatureLibrary = getSignatureLibraryForIdentification();
        const signature = this.getSignatureForLibrary(signatureLibrary);
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
            const runtimeSignature = this.getIdentification().signature;
            console.log(`[clPrompter] ${this.id}.update() — tempDir=${tempDir}, library=${library}`);

            // Step 1: upload RPGLE source.
            const rpglePath = `${tempDir}_${this.PGM_NAME}.rpgle`;
            const rpgleBytes = encoder.encode(this.getRPGLESrc());
            console.log(`[clPrompter] ${this.id}.update() — uploading RPGLE to ${rpglePath} (${rpgleBytes.length} bytes)`);
            let rpgleUploadErr: string | void;
            try {
                rpgleUploadErr = await content.writeStreamfileRaw(rpglePath, rpgleBytes);
            } catch (e) {
                console.error(`[clPrompter] writeStreamfileRaw(rpgle) threw: ${e}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }
            if (rpgleUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(rpgle) failed: ${rpgleUploadErr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }

            // Step 1b: ensure target library exists.
            const crtlibResult = await connection.runCommand({ command: `CRTLIB LIB(${library})`, noLibList: true });
            console.log(`[clPrompter] ${this.id}.update() — CRTLIB(${library}) code=${crtlibResult.code}: ${crtlibResult.stderr}`);

            // Step 2: try direct compile first; fall back to CCSID-converted copies for mixed IBM i PTF levels.
            const compileFromStream = async (sourcePath: string, useTargetCcsid: boolean): Promise<{ code: number; stderr: string; stdout: string }> => {
                const tgtCcsidParm = useTargetCcsid ? ' TGTCCSID(*JOB)' : '';
                const cmd = `CRTBNDRPG PGM(${library}/${this.PGM_NAME}) SRCSTMF('${sourcePath}')${tgtCcsidParm} OPTION(*SRCSTMT) DBGVIEW(*NONE)`;
                appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — compile external program command: ${cmd}`);
                const result = await connection.runCommand({ command: cmd });
                return {
                    code: result.code,
                    stderr: result.stderr,
                    stdout: result.stdout
                };
            };

            let compileResult = await compileFromStream(rpglePath, true);

            if (compileResult.code !== 0) {
                appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — direct compile with TGTCCSID(*JOB) failed; retrying with TOCCSID(*JOBCCSID) conversion.`);

                const rpgleJobCcsidPath = `${tempDir}_${this.PGM_NAME}_ccsid_job.rpgle`;
                const cpyToJobCcsidCmd = `CPY OBJ('${rpglePath}') TOOBJ('${rpgleJobCcsidPath}') TOCCSID(*JOBCCSID) REPLACE(*YES)`;
                appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — convert source CCSID command: ${cpyToJobCcsidCmd}`);
                const cpyToJobCcsidResult = await connection.runCommand({ command: cpyToJobCcsidCmd });

                if (cpyToJobCcsidResult.code === 0) {
                    compileResult = await compileFromStream(rpgleJobCcsidPath, false);
                } else {
                    appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — TOCCSID(*JOBCCSID) conversion failed; retrying with TOCCSID(37) for compatibility.`);

                    const rpgle37Path = `${tempDir}_${this.PGM_NAME}_ccsid37.rpgle`;
                    const cpyTo37Cmd = `CPY OBJ('${rpglePath}') TOOBJ('${rpgle37Path}') TOCCSID(37) REPLACE(*YES)`;
                    appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — convert source CCSID command: ${cpyTo37Cmd}`);
                    const cpyTo37Result = await connection.runCommand({ command: cpyTo37Cmd });

                    if (cpyTo37Result.code === 0) {
                        compileResult = await compileFromStream(rpgle37Path, false);
                    } else {
                        console.error(`[clPrompter] CPY conversion failed for ${this.PGM_NAME}. *JOBCCSID stderr: ${cpyToJobCcsidResult.stderr} | CCSID(37) stderr: ${cpyTo37Result.stderr}`);
                        return {
                            status: 'Error',
                            remoteSignature: runtimeSignature
                        };
                    }
                }
            }

            if (compileResult.code !== 0) {
                console.error(`[clPrompter] CRTBNDRPG failed for ${this.PGM_NAME}: ${compileResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }

            // Step 4: upload SQL DDL.
            const sqlPath = `${tempDir}_${this.UDTF_SPECIFIC}.sql`;
            const sqlUploadErr = await content.writeStreamfileRaw(
                sqlPath,
                encoder.encode(this.getSQLSrc(library, this.currentVersion))
            );
            if (sqlUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(sql) failed: ${sqlUploadErr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }

            // Step 5: drop existing specific function (ignore if missing).
            try {
                await connection.runSQL(`DROP SPECIFIC FUNCTION ${library}.${this.UDTF_SPECIFIC}`);
            } catch {
                // UDTF may not exist yet — that's fine
            }

            // Step 6: RUNSQLSTM to create/replace the UDTF.
            const runsqlstmCmd = `RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SYS)`;
            appendClPrompterOutputLine(`[clPrompter] ${this.id}.update() — create/replace function command: ${runsqlstmCmd}`);
            const sqlResult = await connection.runCommand({
                command: runsqlstmCmd,
                noLibList: true
            });
            if (sqlResult.code !== 0) {
                console.error(`[clPrompter] RUNSQLSTM failed for ${this.UDTF_SPECIFIC}: ${sqlResult.stderr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }

            console.log(`[clPrompter] ${this.UDTF_SPECIFIC} UDTF installed in ${library} (version ${this.currentVersion})`);
            return {
                status: 'Installed',
                remoteSignature: runtimeSignature
            };
        });
    }

    reset(): void {
        // No per-connection state to clear — library is re-read from settings each time
    }
}
