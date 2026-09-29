/** Placeholder token for consumers that need a library-qualified CMD_RUN SQL template. */
export const CMD_RUN_LIBRARY_PLACEHOLDER = '${UDTF_LIBRARY}';

/**
 * Library-agnostic CMD_RUN SQL template.
 * Replace CMD_RUN_LIBRARY_PLACEHOLDER with the resolved support library.
 */
export const CMD_RUN_SQL_TEMPLATE = `SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,
SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,
SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG
FROM TABLE(${CMD_RUN_LIBRARY_PLACEHOLDER}.CMD_RUN(?, ?))
ORDER BY ORDINAL_POSITION`;

/**
 * Backward-compatible alias used by existing imports.
 * Kept to avoid API churn while removing schema hard-coding.
 */
export const CMD_RUN_SQL = CMD_RUN_SQL_TEMPLATE;

/** Builds a CMD_RUN SQL statement for the resolved function library. */
export function buildCmdRunSqlForLibrary(library: string): string {
    const normalizedLibrary = String(library || '').trim().toUpperCase();
    if (!normalizedLibrary) {
        throw new Error('A valid CMD_RUN support library is required.');
    }

    return CMD_RUN_SQL_TEMPLATE.replace(CMD_RUN_LIBRARY_PLACEHOLDER, normalizedLibrary);
}

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
