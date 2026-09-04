import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

export interface SqlFunctionInfo {
    specificSchema: string;
    specificName: string;
    routineName: string;
    routineType: string;
    externalName: string;
    longComment: string;
}

export interface SqlFunctionExistsResult {
    exists: boolean;
    specificSchema: string;
    specificName: string;
    rows: SqlFunctionInfo[];
}

const FIND_SQL_FUNCTION = `SELECT SPECIFIC_SCHEMA,
                                SPECIFIC_NAME,
                                ROUTINE_NAME,
                                ROUTINE_TYPE,
                                EXTERNAL_NAME,
                                LONG_COMMENT
                            FROM QSYS2.SYSROUTINES
                            WHERE SPECIFIC_SCHEMA = ?
                                AND SPECIFIC_NAME = ?
                                AND ROUTINE_TYPE = 'FUNCTION'
                            LIMIT 1`;

/**
 * Checks whether an SQL function exists on IBM i by specific schema/name.
 * Returns both an exists flag and row details for future callers.
 */
export async function checkSqlFunctionExists(
    connection: IBMi,
    specificName: string,
    specificSchema = 'SQLTOOLS'
): Promise<SqlFunctionExistsResult> {
    const schema = specificSchema.trim().toUpperCase();
    const name = specificName.trim().toUpperCase();

    if (!schema) {
        throw new Error('specificSchema is required.');
    }
    if (!name) {
        throw new Error('specificName is required.');
    }

    const result = await connection.runSQL(FIND_SQL_FUNCTION, { bindings: [schema, name] }) as Record<string, unknown>[];

    const rows: SqlFunctionInfo[] = result.map((row) => ({
        specificSchema: String(row.SPECIFIC_SCHEMA ?? ''),
        specificName: String(row.SPECIFIC_NAME ?? ''),
        routineName: String(row.ROUTINE_NAME ?? ''),
        routineType: String(row.ROUTINE_TYPE ?? ''),
        externalName: String(row.EXTERNAL_NAME ?? ''),
        longComment: String(row.LONG_COMMENT ?? '')
    }));

    return {
        exists: rows.length > 0,
        specificSchema: schema,
        specificName: name,
        rows
    };
}

