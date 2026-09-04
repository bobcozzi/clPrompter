export const CMD_RUN_SQL = `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(sqltools.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;

/** Validates the qualified-job format accepted by QSYS2.CANCEL_SQL. */
export function normalizeSqlJobId(jobId: string | undefined): string | undefined {
    const normalized = jobId?.trim().toUpperCase();
    return normalized && /^\d{6}\/[A-Z0-9#$@]{1,10}\/[A-Z0-9#$@]{1,10}$/.test(normalized)
        ? normalized
        : undefined;
}

/** Direct SQL call text for QSYS2.CANCEL_SQL. */
export function buildCancelSqlJobCommand(jobId: string): string {
    const escapedJobId = jobId.replace(/'/g, "''");
    const sqlCall = `CALL QSYS2.CANCEL_SQL('${escapedJobId}')`;
    console.log(`Cancel SQL Request: ${sqlCall}\n`);
    return sqlCall;
}
