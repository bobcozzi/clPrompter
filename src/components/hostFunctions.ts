import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { ComponentIdentification, ComponentState, IBMiComponent, SecureComponentState } from '@halcyontech/vscode-ibmi-types/api/components/component';
import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

import { getCmdHelpCPPSrc } from './cmdHelp/cmdHelpCppSource';
import { getCmdHelpSQLSrc } from './cmdHelp/cmdHelpSqlSource';
import { getChkAuthCPPSrc } from './chkAuth/chkAuthCppSource';
import { getChkAuthSQLSrc } from './chkAuth/chkAuthSqlSource';
import { getCmdCheckCPPSrc } from './cmdCheck/cmdCheckCppSource';
import { getCmdCheckSQLSrc } from './cmdCheck/cmdCheckSqlSource';
import { getCmdRunCPPSrc } from './cmdRun/cmdRunCppSource';
import { getCmdRunSQLSrc } from './cmdRun/cmdRunSqlSource';
import { getCmdXmlCPPSrc } from './cmdXml/cmdXmlCppSource';
import { getCmdXmlSQLSrc } from './cmdXml/cmdXmlSqlSource';
import { getDltObjCPPSrc } from './dltObj/dltObjCppSource';
import { getDltObjSQLSrc } from './dltObj/dltObjSqlSource';
import { getFieldListCPPSrc } from './fieldList/fieldListCppSource';
import { getFieldListSQLSrc } from './fieldList/fieldListSqlSource';
import { getJobAttrRPGLESrc } from './jobAttr/jobAttrRpgleSource';
import { getJobAttrSQLSrc } from './jobAttr/jobAttrSqlSource';
import { getJobLiblRPGLESrc } from './joblibl/jobLiblRpgleSource';
import { getJobLiblSQLSrc } from './joblibl/jobLiblSqlSource';
import { getLastSplfCPPSrc } from './lastSplf/lastSplfCppSource';
import { getLastSplfSQLSrc } from './lastSplf/lastSplfSqlSource';
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

const MANAGED_SPECIFIC_NAMES = [
    'CHK_AUTH',
    'CMD_CHECK',
    'CMD_HELP',
    'CMD_RUN',
    'CMD_XML',
    'DELETE_OBJECT',
    'FIELD_LIST',
    'JOB_ATTR',
    'JOB_LIBL',
    'LAST_SPLF'
];

const VERSION_CACHE_TTL_MS = 10000;

type VersionCacheEntry = {
    loadedAt: number;
    versionsBySpecific: Map<string, number>;
};

const udtfVersionCache = new WeakMap<IBMi, Map<string, VersionCacheEntry>>();

function parseLeadingVersion(longComment: unknown): number {
    if (longComment === null || longComment === undefined) {
        return -1;
    }
    const comment = String(longComment);
    const leadingVersion = /^\s*(\d+)/.exec(comment);
    if (!leadingVersion?.[1]) {
        return -1;
    }
    const parsed = Number(leadingVersion[1]);
    return Number.isNaN(parsed) ? -1 : parsed;
}

async function loadManagedUDTFVersions(connection: IBMi, schema: string): Promise<Map<string, number>> {
    const schemaName = schema.toUpperCase();
    const specificNameList = MANAGED_SPECIFIC_NAMES.map(name => `'${name}'`).join(', ');
    const sql = `SELECT SPECIFIC_NAME, CAST(LONG_COMMENT AS VARCHAR(200)) AS LONG_COMMENT \
FROM qsys2.sysroutines \
WHERE ROUTINE_SCHEMA = '${schemaName}' \
    AND ROUTINE_TYPE in ('FUNCTION','PROCEDURE') \
  AND SPECIFIC_NAME IN (${specificNameList})`;

    const rows = await connection.runSQL(sql) as Record<string, unknown>[];
    const versionsBySpecific = new Map<string, number>();

    for (const row of rows) {
        const specificName = String(row.SPECIFIC_NAME ?? '').trim().toUpperCase();
        if (!specificName) {
            continue;
        }
        versionsBySpecific.set(specificName, parseLeadingVersion(row.LONG_COMMENT));
    }

    return versionsBySpecific;
}

function invalidateManagedUDTFVersionCache(connection: IBMi, schema: string): void {
    const schemaName = schema.toUpperCase();
    const perConnection = udtfVersionCache.get(connection);
    if (!perConnection) {
        return;
    }
    perConnection.delete(schemaName);
}

/**
 * Returns the installed version number of a specific function, or -1 if not found.
 * Version is stored as the leading integer in LONG_COMMENT, e.g. '1 - description'.
 */
async function getUDTFVersion(connection: IBMi, schema: string, specificName: string): Promise<number> {
    const schemaName = schema.toUpperCase();
    const specific = specificName.toUpperCase();
    const now = Date.now();

    let perConnection = udtfVersionCache.get(connection);
    if (!perConnection) {
        perConnection = new Map<string, VersionCacheEntry>();
        udtfVersionCache.set(connection, perConnection);
    }

    let cacheEntry = perConnection.get(schemaName);
    if (!cacheEntry || (now - cacheEntry.loadedAt) > VERSION_CACHE_TTL_MS) {
        const versionsBySpecific = await loadManagedUDTFVersions(connection, schemaName);
        cacheEntry = { loadedAt: now, versionsBySpecific };
        perConnection.set(schemaName, cacheEntry);
    }

    return cacheEntry.versionsBySpecific.get(specific) ?? -1;
}

type HostSourceType = 'C' | 'CPP' | 'RPGLE' | 'SQLRPGLE';

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
    abstract readonly SOURCE_TYPE: HostSourceType;

    abstract getSourceSrc(): string;
    abstract getSQLSrc(library: string, version: number): string;

    private getSourceFileExtension(): string {
        switch (this.SOURCE_TYPE) {
            case 'C': return 'c';
            case 'CPP': return 'cpp';
            case 'RPGLE':
            case 'SQLRPGLE':
                return 'rpgle';
            default:
                return 'txt';
        }
    }

    private async compileAndCreateProgram(
        connection: IBMi,
        library: string,
        sourcePath: string,
        id: string
    ): Promise<{ ok: boolean; detail?: string }> {
        if (this.SOURCE_TYPE === 'C' || this.SOURCE_TYPE === 'CPP') {
            const crtcppiCompileOpts = `LANGLVL(*EXTENDED0X) SYSIFCOPT(*IFS64IO)`;
            const crtcppiBaseCmd = `CRTSQLCPPI OBJ(${library}/${this.PGM_NAME}) SRCSTMF('${sourcePath}')`;
            const crtcppiStaticParms = `CVTCCSID(*JOB) OUTPUT(*PRINT)`;
            const crtcppiCompileOptParm = `COMPILEOPT('${crtcppiCompileOpts}')`;
            const crtcppiCmd = `${crtcppiBaseCmd} ${crtcppiStaticParms} ${crtcppiCompileOptParm} TGTRLS(*CURRENT)`;
            appendClPrompterOutputLine(`[clPrompter] ${id}.update() — compile external program command: ${crtcppiCmd}`);
            console.log(`[clPrompter] ${id}.update() — running: ${crtcppiCmd}`);
            const moduleResult = await connection.runCommand({ command: crtcppiCmd, noLibList: true });
            if (moduleResult.code !== 0) {
                console.error(`[clPrompter] CRTSQLCPPI failed (code=${moduleResult.code})`);
                console.error(`[clPrompter] CRTSQLCPPI stdout: ${moduleResult.stdout}`);
                console.error(`[clPrompter] CRTSQLCPPI stderr: ${moduleResult.stderr}`);
                return { ok: false, detail: moduleResult.stderr };
            }

            const pgmResult = await connection.runCommand({
                command: `CRTPGM PGM(${library}/${this.PGM_NAME}) MODULE(${library}/${this.PGM_NAME}) ACTGRP(*CALLER) TGTRLS(*CURRENT)`,
                noLibList: true
            });
            if (pgmResult.code !== 0) {
                console.error(`[clPrompter] CRTPGM failed for ${this.PGM_NAME}: ${pgmResult.stderr}`);
                return { ok: false, detail: pgmResult.stderr };
            }

            return { ok: true };
        }

        if (this.SOURCE_TYPE === 'RPGLE') {
            const compileFromStream = async (path: string, useTargetCcsid: boolean): Promise<{ code: number; stderr: string; stdout: string }> => {
                const tgtCcsidParm = useTargetCcsid ? ' TGTCCSID(*JOB)' : '';
                const cmd = `CRTBNDRPG PGM(${library}/${this.PGM_NAME}) SRCSTMF('${path}')${tgtCcsidParm} OPTION(*SRCSTMT) DBGVIEW(*NONE) TGTRLS(*CURRENT)`;
                appendClPrompterOutputLine(`[clPrompter] ${id}.update() — compile external program command: ${cmd}`);
                const result = await connection.runCommand({ command: cmd });
                return {
                    code: result.code,
                    stderr: result.stderr,
                    stdout: result.stdout
                };
            };

            let compileResult = await compileFromStream(sourcePath, true);

            if (compileResult.code !== 0) {
                appendClPrompterOutputLine(`[clPrompter] ${id}.update() — direct compile with TGTCCSID(*JOB) failed; retrying with TOCCSID(*JOBCCSID) conversion.`);

                const rpgleJobCcsidPath = sourcePath.replace(/\.rpgle$/i, '_ccsid_job.rpgle');
                const cpyToJobCcsidCmd = `CPY OBJ('${sourcePath}') TOOBJ('${rpgleJobCcsidPath}') TOCCSID(*JOBCCSID) REPLACE(*YES)`;
                appendClPrompterOutputLine(`[clPrompter] ${id}.update() — convert source CCSID command: ${cpyToJobCcsidCmd}`);
                const cpyToJobCcsidResult = await connection.runCommand({ command: cpyToJobCcsidCmd });

                if (cpyToJobCcsidResult.code === 0) {
                    compileResult = await compileFromStream(rpgleJobCcsidPath, false);
                } else {
                    appendClPrompterOutputLine(`[clPrompter] ${id}.update() — TOCCSID(*JOBCCSID) conversion failed; retrying with TOCCSID(37) for compatibility.`);

                    const rpgle37Path = sourcePath.replace(/\.rpgle$/i, '_ccsid37.rpgle');
                    const cpyTo37Cmd = `CPY OBJ('${sourcePath}') TOOBJ('${rpgle37Path}') TOCCSID(37) REPLACE(*YES)`;
                    appendClPrompterOutputLine(`[clPrompter] ${id}.update() — convert source CCSID command: ${cpyTo37Cmd}`);
                    const cpyTo37Result = await connection.runCommand({ command: cpyTo37Cmd });

                    if (cpyTo37Result.code === 0) {
                        compileResult = await compileFromStream(rpgle37Path, false);
                    } else {
                        console.error(`[clPrompter] CPY conversion failed for ${this.PGM_NAME}. *JOBCCSID stderr: ${cpyToJobCcsidResult.stderr} | CCSID(37) stderr: ${cpyTo37Result.stderr}`);
                        return { ok: false, detail: `${cpyToJobCcsidResult.stderr} ${cpyTo37Result.stderr}` };
                    }
                }
            }

            if (compileResult.code !== 0) {
                console.error(`[clPrompter] CRTBNDRPG failed for ${this.PGM_NAME}: ${compileResult.stderr}`);
                return { ok: false, detail: compileResult.stderr };
            }

            return { ok: true };
        }

        if (this.SOURCE_TYPE === 'SQLRPGLE') {
            const compileOpt = `TGTCCSID(*JOB)`;
            const cmd = `CRTSQLRPGI OBJ(${library}/${this.PGM_NAME}) SRCSTMF('${sourcePath}') OBJTYPE(*PGM) COMMIT(*NONE)  TGTRLS(*CURRENT) DBGVIEW(*NONE) COMPILEOPT('${compileOpt}')`;
            appendClPrompterOutputLine(`[clPrompter] ${id}.update() — compile external program command: ${cmd}`);
            const result = await connection.runCommand({ command: cmd, noLibList: true });
            if (result.code !== 0) {
                console.error(`[clPrompter] CRTSQLRPGI failed for ${this.PGM_NAME}: ${result.stderr}`);
                return { ok: false, detail: result.stderr };
            }
            return { ok: true };
        }

        return { ok: false, detail: `Unsupported SOURCE_TYPE ${this.SOURCE_TYPE}` };
    }

    private getSignatureForLibrary(library: string): string {
        return createHash('sha256')
            .update(this.getSourceSrc())
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

            // ── Step 1: upload source ───────────────────────────────────────
            // tempDir is a unique path prefix, not a subdirectory — append with '_'
            const sourceExt = this.getSourceFileExtension();
            const sourcePath = `${tempDir}_${this.PGM_NAME}.${sourceExt}`;
            const sourceBytes = encoder.encode(this.getSourceSrc());
            console.log(`[clPrompter] ${this.id}.update() — uploading ${this.SOURCE_TYPE} to ${sourcePath} (${sourceBytes.length} bytes)`);
            let sourceUploadErr: string | void;
            try {
                sourceUploadErr = await content.writeStreamfileRaw(sourcePath, sourceBytes);
            } catch (e) {
                console.error(`[clPrompter] writeStreamfileRaw(source) threw: ${e}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }
            if (sourceUploadErr) {
                console.error(`[clPrompter] writeStreamfileRaw(source) failed: ${sourceUploadErr}`);
                return {
                    status: 'Error',
                    remoteSignature: runtimeSignature
                };
            }
            const sourceVerify = await connection.runCommand({ command: `ls -la '${sourcePath}'`, environment: 'pase' });
            console.log(`[clPrompter] ${this.id}.update() — source verify (code=${sourceVerify.code}): ${sourceVerify.stdout || sourceVerify.stderr}`);

            // ── Step 1b: ensure target library exists ──────────────────────
            const crtlibResult = await connection.runCommand({ command: `CRTLIB LIB(${library})`, noLibList: true });
            console.log(`[clPrompter] ${this.id}.update() — CRTLIB(${library}) code=${crtlibResult.code}: ${crtlibResult.stderr}`);
            // Non-zero just means library already existed — that's fine.

            // ── Step 2/3: compile + create program based on source type ──
            const compileResult = await this.compileAndCreateProgram(connection, library, sourcePath, this.id);
            if (!compileResult.ok) {
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
            const runsqlstmCmd = `RUNSQLSTM SRCSTMF('${sqlPath}') COMMIT(*NONE) NAMING(*SYS) TGTRLS(*CURRENT)`;
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
            invalidateManagedUDTFVersionCache(connection, library);
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
    readonly PGM_NAME = 'CMD_HELP';
    readonly UDTF_SPECIFIC = 'cmd_help';
    readonly currentVersion = 5;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getCmdHelpCPPSrc(); }
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
    readonly PGM_NAME = 'CMD_XML';
    readonly UDTF_SPECIFIC = 'cmd_xml';
    readonly currentVersion = 4;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getCmdXmlCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdXmlSQLSrc(library, version); }
}

/**
 * Manages the CMD_RUN UDTF — runs or checks CL commands via QCAPCMD.
 */
export class CmdRunChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.CmdRunChecker';
    readonly id = CmdRunChecker.ID;
    readonly PGM_NAME = 'CMD_RUN';
    readonly UDTF_SPECIFIC = 'cmd_run';
    readonly currentVersion = 4;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getCmdRunCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdRunSQLSrc(library, version); }
}

/**
 * Manages the FIELD_LIST UDTF — returns field metadata similar to DSPFFD.
 */
export class FieldListChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.FieldListChecker';
    readonly id = FieldListChecker.ID;
    readonly PGM_NAME = 'FIELD_LIST';
    readonly UDTF_SPECIFIC = 'field_list';
    readonly currentVersion = 3;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getFieldListCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getFieldListSQLSrc(library, version); }
}

/**
 * Manages the JOB_ATTR UDTF — returns status and queue details for a target
 * job by wrapping the QUSRJOBI API in an RPGLE external program.
 */
export class JobAttrChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.JobAttrChecker';
    readonly id = JobAttrChecker.ID;
    readonly PGM_NAME = 'JOB_ATTR';
    readonly UDTF_SPECIFIC = 'job_attr';
    readonly currentVersion = 3;
    readonly SOURCE_TYPE: HostSourceType = 'RPGLE';

    getSourceSrc(): string { return getJobAttrRPGLESrc(); }
    getSQLSrc(library: string, version: number): string { return getJobAttrSQLSrc(library, version); }
}

/**
 * Manages the JOB_LIBL UDTF — returns library list entries for a target job
 * by wrapping QUSRJOBI format JOBI0750 in an RPGLE external program.
 */
export class JobLiblChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.JobLiblChecker';
    readonly id = JobLiblChecker.ID;
    readonly PGM_NAME = 'JOB_LIBL';
    readonly UDTF_SPECIFIC = 'job_libl';
    readonly currentVersion = 1;
    readonly SOURCE_TYPE: HostSourceType = 'RPGLE';

    getSourceSrc(): string { return getJobLiblRPGLESrc(); }
    getSQLSrc(library: string, version: number): string { return getJobLiblSQLSrc(library, version); }
}

/**
 * Manages the CHK_AUTH scalar function — checks user authority to an object.
 */
export class ChkAuthChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.ChkAuthChecker';
    readonly id = ChkAuthChecker.ID;
    readonly PGM_NAME = 'CHK_AUTH';
    readonly UDTF_SPECIFIC = 'chk_auth';
    readonly currentVersion = 1;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getChkAuthCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getChkAuthSQLSrc(library, version); }
}

/**
 * Manages the CMD_CHECK UDTF — syntax checks CL commands.
 */
export class CmdCheckChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.CmdCheckChecker';
    readonly id = CmdCheckChecker.ID;
    readonly PGM_NAME = 'CMD_CHECK';
    readonly UDTF_SPECIFIC = 'cmd_check';
    readonly currentVersion = 2;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getCmdCheckCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getCmdCheckSQLSrc(library, version); }
}

/**
 * Manages the DLT_OBJ scalar function — deletes IBM i objects.
 */
export class DltObjChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.DltObjChecker';
    readonly id = DltObjChecker.ID;
    readonly PGM_NAME = 'DLT_OBJ';
    readonly UDTF_SPECIFIC = 'delete_object';
    readonly currentVersion = 1;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getDltObjCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getDltObjSQLSrc(library, version); }
}

/**
 * Manages the LAST_SPLF UDTF — returns last spooled file metadata.
 */
export class LastSplfChecker extends UDTFChecker {
    static readonly ID = 'clPrompter.LastSplfChecker';
    readonly id = LastSplfChecker.ID;
    readonly PGM_NAME = 'LAST_SPLF';
    readonly UDTF_SPECIFIC = 'last_splf';
    readonly currentVersion = 2;
    readonly SOURCE_TYPE: HostSourceType = 'CPP';

    getSourceSrc(): string { return getLastSplfCPPSrc(); }
    getSQLSrc(library: string, version: number): string { return getLastSplfSQLSrc(library, version); }
}

