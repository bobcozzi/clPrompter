import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { CommandExecution, CommandExecutionMode, determineOutcome, mapCommandMessages } from './commandEntryModel';
import { getUDTFLibrary } from './components/hostFunctions';

export const CMD_RUN_SQL = `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(sqltools.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;

function buildCmdRunSql(library: string): string {
    return `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(${library}.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;
}

/** Validates the qualified-job format accepted by QSYS2.CANCEL_SQL. */
export function normalizeSqlJobId(jobId: string | undefined): string | undefined {
    const normalized = jobId?.trim().toUpperCase();
    return normalized && /^\d{6}\/[A-Z0-9#$@]{1,10}\/[A-Z0-9#$@]{1,10}$/.test(normalized)
        ? normalized
        : undefined;
}

/** CL sent through the connection's existing SSH/ILE command facility. */
export function buildCancelSqlJobCommand(jobId: string): string {
    const sqlCall = `CALL QSYS2.CANCEL_SQL(''${jobId}'')`;
    const runSql = `RUNSQL SQL('${sqlCall}') COMMIT(*NONE) NAMING(*SYS)`;
    const submitJobCmd = [
        `SBMJOB CMD(${runSql}) `,
        'JOB(C4I_ENDRQS) JOBQ(QUSRNOMAX)',
        'LOG(4 0 *SECLVL) LOGCLPGM(*YES) LOGOUTPUT(*JOBEND)'
    ].join(' ');
    console.log(`Cancel Request: ${submitJobCmd}\n`);
    return submitJobCmd;
}

/** Executes CMD_RUN on Code for IBM i's existing shared SQL job. */
export class CommandEntryService {
    async execute(connection: IBMi, command: string, mode: CommandExecutionMode, id?: string): Promise<CommandExecution> {
        const started = Date.now();
        const startedAt = new Date(started).toISOString();
        try {
            // `bindings` is Code for IBM i 3.x's public Mapepire parameter API.
            // It keeps CL command text out of the SQL source and prevents SQL injection.
            const udtfLibrary = getUDTFLibrary(connection);
            const rows = await connection.runSQL(buildCmdRunSql(udtfLibrary), { bindings: [command, mode] });
            const messages = mapCommandMessages(rows as Record<string, unknown>[]);
            return {
                id: id ?? `${started}-${Math.random().toString(36).slice(2, 8)}`,
                command,
                mode,
                startedAt,
                elapsedMs: Date.now() - started,
                outcome: determineOutcome(messages),
                messages
            };
        } catch (error) {
            return {
                id: id ?? `${started}-${Math.random().toString(36).slice(2, 8)}`,
                command,
                mode,
                startedAt,
                elapsedMs: Date.now() - started,
                outcome: 'error',
                messages: [],
                failure: error instanceof Error ? error.message : String(error)
            };
        }
    }
}
