import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';

export interface SqlSyntaxCheckRunner {
    runSQL(connection: IBMi, statements: string | string[], options?: { bindings?: unknown[]; rows?: number }): Promise<Record<string, unknown>[]>;
}

function isPrepareNotAllowedError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    const normalized = message.toUpperCase();
    return normalized.includes('SQL0084')
        || normalized.includes('42612')
        || normalized.includes('SQL STATEMENT NOT ALLOWED')
        || normalized.includes('STATEMENT NOT ALLOWED');
}

function stripTrailingSemicolon(sql: string): string {
    return sql.replace(/;\s*$/, '').trim();
}

function hasBalancedTopLevelParentheses(sql: string): boolean {
    let depth = 0;
    let inSingleQuote = false;
    let inDoubleQuote = false;
    let inLineComment = false;
    let inBlockComment = false;

    for (let i = 0; i < sql.length; i += 1) {
        const ch = sql[i];
        const next = sql[i + 1];

        if (inLineComment) {
            if (ch === '\n' || ch === '\r') {
                inLineComment = false;
            }
            continue;
        }

        if (inBlockComment) {
            if (ch === '*' && next === '/') {
                inBlockComment = false;
                i += 1;
            }
            continue;
        }

        if (inSingleQuote) {
            if (ch === "'" && next === "'") {
                i += 1;
                continue;
            }
            if (ch === "'") {
                inSingleQuote = false;
            }
            continue;
        }

        if (inDoubleQuote) {
            if (ch === '"' && next === '"') {
                i += 1;
                continue;
            }
            if (ch === '"') {
                inDoubleQuote = false;
            }
            continue;
        }

        if (ch === '-' && next === '-') {
            inLineComment = true;
            i += 1;
            continue;
        }

        if (ch === '/' && next === '*') {
            inBlockComment = true;
            i += 1;
            continue;
        }

        if (ch === "'") {
            inSingleQuote = true;
            continue;
        }

        if (ch === '"') {
            inDoubleQuote = true;
            continue;
        }

        if (ch === '(') {
            depth += 1;
            continue;
        }

        if (ch === ')') {
            if (depth <= 0) {
                return false;
            }
            depth -= 1;
        }
    }

    return depth === 0;
}

export function checkSQLBeforePaging(sql: string): void {
    const normalized = stripTrailingSemicolon(sql).trim();
    if (!normalized) {
        throw new Error('No SQL statement was provided.');
    }

    if (!hasBalancedTopLevelParentheses(normalized)) {
        throw new Error('The SQL statement appears to be malformed before paging is applied. Check for unmatched parentheses or a missing closing ")".');
    }
}

export async function checkSQLForExecution(
    connection: IBMi,
    sql: string,
    sqlJobRunner?: SqlSyntaxCheckRunner
): Promise<void> {
    checkSQLBeforePaging(sql);

    const statement = stripTrailingSemicolon(sql).trim();
    if (!statement) {
        return;
    }

    const preparedName = `CLPROMPTER_SQLCHK_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
    let prepareSucceeded = false;
    const runOnThisConnection = async (sqlToCheck: string): Promise<void> => {
        try {
            await connection.runSQL(sqlToCheck, { bindings: [statement] });
            prepareSucceeded = true;
        } catch (error) {
            if (isPrepareNotAllowedError(error)) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`SQL syntax check failed before execution: ${message}`);
        }
    };

    const runOnSelectedJob = async (): Promise<void> => {
        if (!sqlJobRunner) {
            await runOnThisConnection(`PREPARE ${preparedName} FROM ?`);
            return;
        }

        try {
            await sqlJobRunner.runSQL(connection, `PREPARE ${preparedName} FROM ?`, { bindings: [statement] });
            prepareSucceeded = true;
        } catch (error) {
            if (isPrepareNotAllowedError(error)) {
                return;
            }
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`SQL syntax check failed before execution: ${message}`);
        }
    };

    try {
        await runOnSelectedJob();
    } finally {
        if (!prepareSucceeded) {
            return;
        }
        try {
            if (sqlJobRunner) {
                await sqlJobRunner.runSQL(connection, `DEALLOCATE PREPARE ${preparedName}`);
            } else {
                await connection.runSQL(`DEALLOCATE PREPARE ${preparedName}`);
            }
        } catch {
            // Ignore cleanup failures; prepared names are transient and the database will clean on disconnect.
        }
    }
}
