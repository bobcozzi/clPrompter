import * as assert from 'assert';

// Mock vscode before requiring modules that import it.
const Module = require('module');
const originalLoad = Module._load;
const vscodeMock = {
    workspace: {
        getConfiguration() {
            return {
                get(_key: string, defaultValue?: unknown): unknown {
                    return defaultValue;
                }
            };
        }
    }
};

Module._load = function (request: string) {
    if (request === 'vscode') {
        return vscodeMock;
    }
    return originalLoad.apply(this, arguments as any);
};

function requireFromOut(moduleName: string): any {
    try {
        return require(`../${moduleName}`);
    } catch {
        return require(`./${moduleName}`);
    }
}

const { classifyMessage, determineOutcome, mapCommandMessages } = requireFromOut('commandEntryModel');
const { detectCommandEntryPrefix } = requireFromOut('commandEntryPrefixes');
const { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId } = requireFromOut('commandEntrySqlHelpers');
const { collectRunAfterSqlJobInit, resolveSqlNamingMode } = requireFromOut('commandEntryJobManager');
const { buildImmediateSessionContextSql, expandStartupScriptPlaceholders, normalizeSchemaSessionContextValue, normalizeSessionContextValue } = requireFromOut('commandEntrySqlSettings');
const { checkSQLForExecution } = requireFromOut('sqlSyntaxChecker');

const messages = mapCommandMessages([
    { ORDINAL_POSITION: 2, MSGID: 'CPF0001', MSGSEV: 40, MSGTYPE: 'ESCAPE', MSGTEXT: 'Failed', SECLVLMSG: 'Details' },
    { ORDINAL_POSITION: 1, MSGID: 'CPC0000', MSGSEV: 0, MSGTYPE: 'COMPLETION', MSGTEXT: 'Done', SECLVLMSG: '' },
]);
assert.deepStrictEqual(messages.map(message => message.ordinalPosition), [1, 2]);
assert.strictEqual(messages[1].kind, 'error');
assert.strictEqual(classifyMessage(10, 'STATUS'), 'info');
assert.strictEqual(classifyMessage(0, 'INQUIRY'), 'info');
assert.strictEqual(determineOutcome(messages), 'error');
assert.match(CMD_RUN_SQL, /CMD_RUN\(\?, \?\)/);
assert.strictEqual(normalizeSqlJobId('123456/myuser/qzdasoinit'), '123456/MYUSER/QZDASOINIT');
assert.strictEqual(normalizeSqlJobId('123456/USER/NOT VALID'), undefined);
const cancelCommand = buildCancelSqlJobCommand('123456/MYUSER/QZDASOINIT');
assert.match(cancelCommand, /^CALL\s+QSYS2\.CANCEL_SQL\('123456\/MYUSER\/QZDASOINIT'\)$/i);
assert.strictEqual(detectCommandEntryPrefix('CL: CPYF FROMFILE(A) TOFILE(B)'), 'CL');
assert.strictEqual(detectCommandEntryPrefix('   SQL: SELECT * FROM QIWS.QCUSTCDT'), 'SQL');
assert.strictEqual(detectCommandEntryPrefix('SELECT * FROM QIWS.QCUSTCDT'), undefined);
assert.strictEqual(resolveSqlNamingMode('sql'), 'sql');
assert.strictEqual(resolveSqlNamingMode('system'), 'system');
assert.strictEqual(resolveSqlNamingMode('SQL'), 'sql');
assert.deepStrictEqual(collectRunAfterSqlJobInit({ cmdEntry: { runAfterSqlJobInit: ['SET OPTION NAMING = *SQL', 'VALUES 1'] } }), ['SET OPTION NAMING = *SQL', 'VALUES 1']);
assert.deepStrictEqual(collectRunAfterSqlJobInit({ clPrompter: { cmdEntry: { runAfterSqlJobInit: ['SET SYSIBMADM.SELFCODES = 1'] } } }), ['SET SYSIBMADM.SELFCODES = 1']);
assert.strictEqual(normalizeSchemaSessionContextValue('SET SCHEMA = MYLIB'), 'MYLIB');
assert.strictEqual(normalizeSchemaSessionContextValue('SET CURRENT SCHEMA MYLIB'), 'MYLIB');
assert.strictEqual(normalizeSessionContextValue('SET PATH = *LIBL, QTEMP'), '*LIBL, QTEMP');
assert.strictEqual(normalizeSessionContextValue('SET SCHEMA = SHOULD_NOT_CHANGE_FOR_PATH_NORMALIZER'), 'SET SCHEMA = SHOULD_NOT_CHANGE_FOR_PATH_NORMALIZER');
assert.deepStrictEqual(
    buildImmediateSessionContextSql({ initialSchema: '*LIBL', initialPath: 'SET PATH = *LIBL, QTEMP' }),
    ['SET SCHEMA DEFAULT', 'SET PATH *LIBL, QTEMP']
);
assert.deepStrictEqual(
    buildImmediateSessionContextSql({ initialSchema: 'SET SCHEMA = APPDATA', initialPath: 'QGPL, QTEMP' }),
    ['SET SCHEMA APPDATA', 'SET PATH QGPL, QTEMP']
);
assert.deepStrictEqual(
    buildRunAfterSqlJobInitDefaults({ setCurrentLibraryAfterConnect: true, currentLibrary: '*CURLIB' as any }),
    ['SET PATH *LIBL', 'SET SCHEMA DEFAULT']
);
assert.deepStrictEqual(
    buildRunAfterSqlJobInitDefaults({ setCurrentLibraryAfterConnect: true, currentLibrary: 'QGPL' }),
    ['SET PATH *LIBL', 'SET SCHEMA DEFAULT', 'CHGCURLIB CURLIB(QGPL)']
);
assert.strictEqual(expandStartupScriptPlaceholders('CHGCURLIB CURLIB(&CURLIB)', 'COZTEST', ['QGPL', 'QTEMP']), 'CHGCURLIB CURLIB(COZTEST)');
assert.strictEqual(expandStartupScriptPlaceholders('CHGLIBL LIBL(&LIBL)', 'COZTEST', ['QGPL', 'QTEMP']), 'CHGLIBL LIBL(QGPL QTEMP)');
assert.strictEqual(expandStartupScriptPlaceholders('CHGCURLIB CURLIB(&CURLIB)', '', ['QGPL']), 'CHGCURLIB CURLIB(*CRTDFT)');
assert.strictEqual(expandStartupScriptPlaceholders('CHGCURLIB PICKLES', 'COZTEST', ['QGPL']), 'CHGCURLIB PICKLES');

(async () => {
    const connection = {
        runSQL: async () => {
            throw new Error('unexpected prepare validation call');
        }
    } as any;
    await checkSQLForExecution(connection, 'SELECT * FROM MYTABLE');
    console.log('SQL syntax validation avoids runtime PREPARE checks');
})();

console.log('Command Entry model tests passed');
