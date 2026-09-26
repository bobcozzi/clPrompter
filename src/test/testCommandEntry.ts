/// <reference types="node" />
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
    const candidates = [
        `./${moduleName}`,
        `../${moduleName}`,
        `../../src/${moduleName}`,
        `../../out/${moduleName}`
    ];

    for (const candidate of candidates) {
        try {
            return require(candidate);
        } catch {
            // Try the next candidate path.
        }
    }

    throw new Error(`Unable to resolve module '${moduleName}' from the compiled test output.`);
}

const { classifyMessage, determineOutcome, mapCommandMessages } = requireFromOut('commandEntryModel');
const { detectCommandEntryPrefix } = requireFromOut('commandEntryPrefixes');
const { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId } = requireFromOut('commandEntrySqlHelpers');
const { CommandEntryJobManager, buildJoblogQueryForSqlJob, collectRunAfterSqlJobInit, resolveRunAfterSqlJobInitMode, resolveSqlNamingMode } = requireFromOut('commandEntryJobManager');
const { buildImmediateSessionContextSql, buildRunAfterSqlJobInitDefaults, expandStartupScriptPlaceholders, normalizeSchemaSessionContextValue, normalizeSessionContextValue, splitRunAfterSqlJobInitStatements } = requireFromOut('commandEntrySqlSettings');
const { buildChgCurlibCommandFromCurrentLibrary, buildChgLiblCommandFromLibraryList } = requireFromOut('commandEntryChgLibl');
const { checkSQLForExecution } = requireFromOut('sqlSyntaxChecker');

const messages = mapCommandMessages([
    { ORDINAL_POSITION: 2, MSGID: 'CPF0001', MSGSEV: 40, MSGTYPE: 'ESCAPE', MSGTEXT: 'Failed', SECLVLMSG: 'Details' },
    { ORDINAL_POSITION: 1, MSGID: 'CPC0000', MSGSEV: 0, MSGTYPE: 'COMPLETION', MSGTEXT: 'Done', SECLVLMSG: '' },
]);
assert.deepStrictEqual(messages.map((message: any) => message.ordinalPosition), [1, 2]);
assert.strictEqual(messages[1].kind, 'error');
assert.strictEqual(classifyMessage(10, 'STATUS'), 'info');
assert.strictEqual(classifyMessage(0, 'INQUIRY'), 'info');
assert.strictEqual(determineOutcome(messages), 'error');
assert.match(CMD_RUN_SQL, /CMD_RUN\(\?, \?\)/);
assert.strictEqual(normalizeSqlJobId('123456/myuser/qzdasoinit'), '123456/MYUSER/QZDASOINIT');
assert.strictEqual(normalizeSqlJobId('123456/USER/NOT VALID'), undefined);
assert.match(
    buildJoblogQueryForSqlJob('123456/MYUSER/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.JOBLOG_INFO\('123456\/MYUSER\/QZDASOINIT'\)\)\s+ORDER BY ORDINAL_POSITION DESC/i
);
assert.match(
    buildJoblogQueryForSqlJob('123456/USR$ABC/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.JOBLOG_INFO\('123456\/USR\$ABC\/QZDASOINIT'\)\)\s+ORDER BY ORDINAL_POSITION DESC/i
);
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
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements('cl: dspjoblog;\nsql: values 1;'), ['cl: dspjoblog', 'sql: values 1']);
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements(["cl: dspjoblog;", 'values 1;']), ['cl: dspjoblog', 'values 1']);
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements("values 'a; b';"), ["values 'a; b'"]);
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements("select\n 1;\nvalues 2;"), ['select 1', 'values 2']);
assert.deepStrictEqual(resolveRunAfterSqlJobInitMode('SQL: values 1'), { mode: 'sql', command: 'values 1' });
assert.deepStrictEqual(resolveRunAfterSqlJobInitMode('CL: dspjoblog'), { mode: 'cl', command: 'dspjoblog' });
assert.deepStrictEqual(resolveRunAfterSqlJobInitMode('values 1'), { mode: 'sql', command: 'values 1' });
assert.deepStrictEqual(resolveRunAfterSqlJobInitMode('set path *libl'), { mode: 'sql', command: 'set path *libl' });
assert.deepStrictEqual(resolveRunAfterSqlJobInitMode('dspjoblog'), { mode: 'cl', command: 'dspjoblog' });
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
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL', ['QGPL', 'QTEMP', 'MYLIB']), 'CHGLIBL LIBL(QGPL QTEMP MYLIB)');
assert.strictEqual(buildChgLiblCommandFromLibraryList('?CHGLIBL', ['QGPL', 'QTEMP']), 'CHGLIBL LIBL(QGPL QTEMP)');
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL LIBL(QGPL)', ['QGPL', 'QTEMP']), undefined);
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL', ['QGPL', 'QTEMP'], 'MYLIB'), 'CHGLIBL LIBL(QGPL QTEMP) CURLIB(MYLIB)');
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL', ['QGPL', 'QTEMP'], ''), 'CHGLIBL LIBL(QGPL QTEMP)');
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL LIBL(QGPL QTEMP)', ['QGPL', 'QTEMP'], 'MYLIB'), 'CHGLIBL LIBL(QGPL QTEMP) CURLIB(MYLIB)');
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL CURLIB(ACCTLIB)', ['QGPL', 'QTEMP'], ''), 'CHGLIBL CURLIB(ACCTLIB) LIBL(QGPL QTEMP)');
assert.strictEqual(buildChgLiblCommandFromLibraryList('CHGLIBL', ['CURRENT:MYLIB', 'QGPL', 'QTEMP']), 'CHGLIBL LIBL(QGPL QTEMP) CURLIB(MYLIB)');
assert.strictEqual(buildChgCurlibCommandFromCurrentLibrary('CHGCURLIB', 'MYLIB'), 'CHGCURLIB CURLIB(MYLIB)');
assert.strictEqual(buildChgCurlibCommandFromCurrentLibrary('?CHGCURLIB', 'MYLIB'), 'CHGCURLIB CURLIB(MYLIB)');
assert.strictEqual(buildChgCurlibCommandFromCurrentLibrary('CHGCURLIB CURLIB(QGPL)', 'MYLIB'), undefined);
assert.strictEqual(buildChgCurlibCommandFromCurrentLibrary('CHGCURLIB', ''), undefined);
assert.strictEqual(buildChgCurlibCommandFromCurrentLibrary('CHGCURLIB', undefined, ['CURRENT:MYLIB', 'QGPL']), 'CHGCURLIB CURLIB(MYLIB)');

(async () => {
    const connection = {
        runSQL: async () => {
            throw new Error('unexpected prepare validation call');
        }
    } as any;
    await checkSQLForExecution(connection, 'SELECT * FROM MYTABLE');
    console.log('SQL syntax validation avoids runtime PREPARE checks');

    const manager = new CommandEntryJobManager();
    const mockConnection = {
        getComponent: async () => ({
            newJob: async () => ({
                execute: async () => ({
                    data: [{ MSGID: 'CPF0000', MSGTEXT: 'ok' }, { MSGID: 'CPF0001', MSGTEXT: 'fail' }]
                })
            })
        }),
        getSqlJobJDBCOptions: () => ({}),
        getConfig: () => ({})
    } as any;

    const rows = await manager.queryJoblog(mockConnection, '123456/MYUSER/QZDASOINIT');
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].MSGID, 'CPF0000');
    console.log('Joblog helper object-result parsing works');
})();

console.log('Command Entry model tests passed');
