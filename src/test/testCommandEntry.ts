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
const { resolveSnippetTemplateValue } = requireFromOut('commandEntrySnippetResolution');
const { buildMsgwInquiryRowSql, buildMsgwLatestRowSql, buildMsgwJobInfoSql, buildMsgwQueueInquiryByKeySql, buildMsgwQueueInquirySql, buildMsgwReplyCommand, buildMsgwReplyCommandForQueue, buildMsgwStatusSql, findMsgwInquiryMessage, findMsgwQueueInquiryByKey, findMsgwQueueInquiryMessage } = requireFromOut('commandEntryMsgw');
const { buildImmediateSessionContextSql, buildRunAfterSqlJobInitDefaults, expandStartupScriptPlaceholders, normalizeSchemaSessionContextValue, normalizeSessionContextValue, splitRunAfterSqlJobInitStatements } = requireFromOut('commandEntrySqlSettings');
const { buildChgCurlibCommandFromCurrentLibrary, buildChgLiblCommandFromLibraryList } = requireFromOut('commandEntryChgLibl');
const { formatCLCommandText } = requireFromOut('formatCL');
const { checkSQLForExecution } = requireFromOut('sqlSyntaxChecker');
const { BUILT_IN_SQL_SNIPPETS } = requireFromOut('commandEntrySnippets');

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
assert.deepStrictEqual(resolveSnippetTemplateValue('Active Jobs sbs(${userSBSList})', { userSBSList: 'QGPL' }).resolved, 'Active Jobs sbs(QGPL)');
assert.deepStrictEqual(resolveSnippetTemplateValue('Job (${sqlJobId})', { sqlJobId: '123456/MYUSER/QZDASOINIT' }).resolved, 'Job (123456/MYUSER/QZDASOINIT)');
assert.deepStrictEqual(resolveSnippetTemplateValue('Job (${sqlJobId})', {}).missing, ['sqlJobId']);
assert.deepStrictEqual(
    resolveSnippetTemplateValue('Active Jobs sbs(${sbsId}) order ${Order}', {
        customVariables: { sbsId: 'QINTER', Order: 'desc' }
    }).resolved,
    'Active Jobs sbs(QINTER) order desc'
);
assert.deepStrictEqual(
    resolveSnippetTemplateValue('Missing ${customValue}', {
        customVariables: { customValue: '' }
    }).missing,
    ['customValue']
);
const c4iJobSnippet = BUILT_IN_SQL_SNIPPETS.find((snippet: any) => snippet.id === 'builtin.library-list-c4i');
assert.ok(c4iJobSnippet, 'expected c4i snippet to exist');
assert.ok(c4iJobSnippet.stmt.includes('${c4iJobId}'), 'expected c4i snippet to use c4iJobId token');
assert.match(
    buildJoblogQueryForSqlJob('123456/MYUSER/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.JOBLOG_INFO\('123456\/MYUSER\/QZDASOINIT'\)\)\s+ORDER BY ORDINAL_POSITION DESC/i
);
assert.match(
    buildJoblogQueryForSqlJob('123456/USR$ABC/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.JOBLOG_INFO\('123456\/USR\$ABC\/QZDASOINIT'\)\)\s+ORDER BY ORDINAL_POSITION DESC/i
);
assert.match(
    buildMsgwLatestRowSql('123456/MYUSER/QZDASOINIT'),
    /SELECT\s+MESSAGE_ID,\s+MESSAGE_TYPE,\s+MESSAGE_TEXT,\s+MESSAGE_KEY/i
);
assert.match(
    buildMsgwLatestRowSql('123456/MYUSER/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.JOBLOG_INFO\('123456\/MYUSER\/QZDASOINIT'\)\)\s+WHERE MESSAGE_TYPE IN \('INQUIRY', 'SENDER', '\*INQ'\)\s+ORDER BY ORDINAL_POSITION DESC\s+FETCH FIRST 1 ROW ONLY/i
);
assert.match(
    buildMsgwInquiryRowSql('123456/MYUSER/QZDASOINIT', []),
    /FROM TABLE\(QSYS2\.JOBLOG_INFO\('123456\/MYUSER\/QZDASOINIT'\)\)\s+ORDER BY ORDINAL_POSITION DESC\s+FETCH FIRST 1 ROW ONLY/i
);
assert.match(
    buildMsgwStatusSql('123456/MYUSER/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.ACTIVE_JOB_INFO\(DETAILED_INFO => 'NONE', CURRENT_USER_LIST_FILTER => USER, JOB_NAME_FILTER => 'QZDASOINIT'\)\) X\s+WHERE JOB_NAME = '123456\/MYUSER\/QZDASOINIT'\s+FETCH FIRST 1 ROW ONLY/i
);
assert.match(
    buildMsgwJobInfoSql('123456/MYUSER/QZDASOINIT', 'SQLTOOLS'),
    /SELECT\s+JOB,\s+ACTIVE_JOB_STATUS,\s+JOB_STATUS,\s+MSGKEY_HEX,\s+MSGKEY,\s+MSGQ_NAME,\s+MSGQ_LIB,\s+MSGQ_LIB_ASP\s+FROM TABLE\(SQLTOOLS\.JOB_ATTR\('123456\/MYUSER\/QZDASOINIT'\)\)\s+FETCH FIRST 1 ROW ONLY/i
);
assert.match(
    buildMsgwJobInfoSql('123456/MYUSER/QZDASOINIT', 'SQLTOOLS'),
    /FROM TABLE\(SQLTOOLS\.JOB_ATTR\('123456\/MYUSER\/QZDASOINIT'\)\)\s+FETCH FIRST 1 ROW ONLY/i
);
assert.strictEqual(
    findMsgwInquiryMessage([{ MSGTYPE: '*SENDER', MSGTEXT: 'Inquiry text', MSGID: 'CPA0702', MSGKEY: Buffer.from([0x12, 0x34]) }])?.messageType,
    '*SENDER'
);
assert.strictEqual(
    findMsgwInquiryMessage([{ MSGTYPE: '*SENDER', MSGTEXT: 'Inquiry text', MSGID: 'CPA0702', MSGKEY: Buffer.from([0xFE, 0xBF, 0xCE, 0xD0]) }])?.messageKeyHex,
    'FEBFCED0'
);
assert.strictEqual(
    buildMsgwReplyCommand('1234ABCD', 'C', 'QSYSOPR'),
    "SNDRPY MSGQ(QSYSOPR) MSGKEY(X'1234abcd') RPY('C')"
);
assert.strictEqual(
    buildMsgwReplyCommand('X\'1234ABCD\'', "O'K"),
    "SNDRPY MSGQ(QSYSOPR) MSGKEY(X'1234abcd') RPY('O''K')"
);
assert.strictEqual(
    buildMsgwReplyCommand('00008743', 'I', 'QSYSOPR'),
    "SNDRPY MSGQ(QSYSOPR) MSGKEY(X'00008743') RPY('I')"
);
assert.strictEqual(
    buildMsgwReplyCommandForQueue('1234ABCD', 'C', 'QSYSOPR', 'QSYS'),
    "SNDRPY MSGQ(QSYS/QSYSOPR) MSGKEY(X'1234abcd') RPY('C')"
);
assert.strictEqual(
    buildMsgwReplyCommandForQueue('1234ABCD', 'C', 'QSYSOPR', ''),
    "SNDRPY MSGQ(QSYSOPR) MSGKEY(X'1234abcd') RPY('C')"
);
assert.strictEqual(
    buildMsgwReplyCommandForQueue('1234ABCD', 'C', 'QSYSOPR'),
    "SNDRPY MSGQ(QSYSOPR) MSGKEY(X'1234abcd') RPY('C')"
);
assert.match(
    buildMsgwQueueInquirySql('CPA0702', '123456/MYUSER/QZDASOINIT'),
    /FROM TABLE\(QSYS2\.MESSAGE_QUEUE_INFO\(QUEUE_NAME => 'QSYSOPR', MESSAGE_FILTER => 'INQUIRY'\)\)\s+WHERE MESSAGE_ID = 'CPA0702'\s+AND FROM_JOB = '123456\/MYUSER\/QZDASOINIT'\s+AND MESSAGE_TYPE = 'INQUIRY'\s+AND ASSOCIATED_MESSAGE_KEY IS NULL\s+ORDER BY MESSAGE_TIMESTAMP DESC\s+FETCH FIRST 20 ROWS ONLY/i
);
assert.match(
    buildMsgwQueueInquiryByKeySql('00000cb0'),
    /FROM TABLE\(QSYS2\.MESSAGE_QUEUE_INFO\('QSYS', 'QSYSOPR', 'INQUIRY', 0\)\)\s+WHERE HEX\(MESSAGE_KEY\) = '00000CB0'\s+ORDER BY MESSAGE_TIMESTAMP DESC\s+FETCH FIRST 5 ROWS ONLY/i
);
assert.match(
    buildMsgwQueueInquiryByKeySql('00000cb0', 'QSYSOPR', 'QSYS'),
    /FROM TABLE\(QSYS2\.MESSAGE_QUEUE_INFO\('QSYS', 'QSYSOPR', 'INQUIRY', 0\)\)\s+WHERE HEX\(MESSAGE_KEY\) = '00000CB0'\s+ORDER BY MESSAGE_TIMESTAMP DESC\s+FETCH FIRST 5 ROWS ONLY/i
);
assert.strictEqual(
    findMsgwQueueInquiryMessage([
        { MESSAGE_ID: 'CPA0702', MESSAGE_TYPE: 'INQUIRY', MESSAGE_KEY: Buffer.from([0x12, 0x34]), ASSOCIATED_MESSAGE_KEY: null, FROM_JOB: '123456/MYUSER/QZDASOINIT' }
    ], 'CPA0702', '123456/MYUSER/QZDASOINIT')?.messageKeyHex,
    '1234'
);
assert.strictEqual(
    findMsgwQueueInquiryByKey([
        { MESSAGE_ID: 'CPA1702', MESSAGE_TYPE: 'INQUIRY', MESSAGE_TEXT: 'Record lock condition detected', MESSAGE_KEY_HEX: '00000CB0' }
    ], '00000cb0')?.messageText,
    'Record lock condition detected'
);
const cancelCommand = buildCancelSqlJobCommand('123456/MYUSER/QZDASOINIT');
assert.match(cancelCommand, /^CALL\s+QSYS2\.CANCEL_SQL\('123456\/MYUSER\/QZDASOINIT'\)$/i);
assert.strictEqual(detectCommandEntryPrefix('CL: CPYF FROMFILE(A) TOFILE(B)'), 'CL');
assert.strictEqual(detectCommandEntryPrefix('   SQL: SELECT * FROM QIWS.QCUSTCDT'), 'SQL');
assert.strictEqual(detectCommandEntryPrefix('SELECT * FROM QIWS.QCUSTCDT'), undefined);
assert.strictEqual(resolveSqlNamingMode('sql'), 'sql');
assert.strictEqual(resolveSqlNamingMode('system'), 'system');
assert.strictEqual(resolveSqlNamingMode('SQL'), 'sql');
assert.strictEqual(new CommandEntryJobManager().isContinuationUsable({ hasFetchMore: true, source: 'dedicated' } as any), false);
assert.strictEqual(new CommandEntryJobManager().isContinuationUsable({ hasFetchMore: true, id: 'abc', source: 'dedicated' } as any), true);
assert.deepStrictEqual(collectRunAfterSqlJobInit({ cmdEntry: { runAfterSqlJobInit: ['SET OPTION NAMING = *SQL', 'VALUES 1'] } }), ['SET OPTION NAMING = *SQL', 'VALUES 1']);
assert.deepStrictEqual(collectRunAfterSqlJobInit({ clPrompter: { cmdEntry: { runAfterSqlJobInit: ['SET SYSIBMADM.SELFCODES = 1'] } } }), ['SET SYSIBMADM.SELFCODES = 1']);
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements('cl: dspjoblog;\nsql: values 1;'), ['cl: dspjoblog', 'sql: values 1']);
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements(["cl: dspjoblog;", 'values 1;']), ['cl: dspjoblog', 'values 1']);
assert.deepStrictEqual(splitRunAfterSqlJobInitStatements('CHGLIBL LIBL(&LIBL);'), ['CHGLIBL LIBL(&LIBL)']);
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
assert.strictEqual(formatCLCommandText('chglibl libl(qgpl qtEmp) curlib(mylib)', '*UPPER'), 'CHGLIBL LIBL(qgpl qtEmp) CURLIB(mylib)');
assert.strictEqual(formatCLCommandText('CHGLIBL LIBL(QGPL QTEMP) CURLIB(MYLIB)', '*NONE'), 'CHGLIBL LIBL(QGPL QTEMP) CURLIB(MYLIB)');

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

    const poolManager = new CommandEntryJobManager();
    const poolExecutedSql: string[] = [];
    const poolConnection = {
        currentHost: 'host.example.com',
        currentUser: 'MYUSER',
        currentPort: 22,
        getSqlJobJDBCOptions: () => ({}),
        getConfig: () => ({}),
        getComponent: async () => ({
            newJob: async () => ({
                getJobId: () => '222222/MYUSER/QSQSRVR',
                execute: async (sql: string) => {
                    poolExecutedSql.push(sql);
                    return [{ MSGID: 'CPF0000', MSGTEXT: 'ok' }];
                }
            })
        })
    } as any;

    const poolRows = await poolManager.queryJoblog(poolConnection, '123456/MYUSER/QZDASOINIT');
    assert.strictEqual(poolRows.length, 1);
    assert.match(poolExecutedSql[0], /JOBLOG_INFO\('123456\/MYUSER\/QZDASOINIT'\)/i);
    console.log('Display joblog uses SQL pool helper job');

    const cancelManager = new CommandEntryJobManager();
    const cancelSql: string[] = [];
    const cancelConnection = {
        currentHost: 'host.example.com',
        currentUser: 'MYUSER',
        currentPort: 22,
        getSqlJobJDBCOptions: () => ({}),
        getConfig: () => ({}),
        getComponent: async () => ({
            newJob: async () => ({
                getJobId: () => '222222/MYUSER/QSQSRVR',
                execute: async (sql: string) => {
                    cancelSql.push(sql);
                    return [];
                }
            })
        })
    } as any;

    (cancelManager as any).isDedicatedEnabled = () => true;
    (cancelManager as any).hasPendingDedicatedRequest = () => true;
    (cancelManager as any).dedicatedJobId = '123456/MYUSER/QZDASOINIT';
    (cancelManager as any).connectionKey = 'host.example.com|myuser|22';
    await cancelManager.submitCancelRequest(cancelConnection, '123456/MYUSER/QZDASOINIT');
    assert.match(cancelSql[0], /CANCEL_SQL\('123456\/MYUSER\/QZDASOINIT'\)/i);
    console.log('Cancel request uses SQL pool helper job');

    const configuredPrivateConnection = {
        currentHost: 'host.example.com',
        currentUser: 'MYUSER',
        currentPort: 22,
        getConfig: () => ({ cmdEntry: { sharedSQLJob: false } }),
        sqlRunnerAvailable: () => true
    } as any;

    assert.strictEqual(manager.isDedicatedUsable(configuredPrivateConnection), true);
    assert.strictEqual(manager.isDedicatedEnabled(configuredPrivateConnection), true);
    assert.strictEqual(manager.getState(configuredPrivateConnection).enabled, true);
    assert.strictEqual(manager.getDisplayJobId(configuredPrivateConnection), undefined);
    console.log('Private mode stays private before dedicated job startup');
})();

console.log('Command Entry model tests passed');
