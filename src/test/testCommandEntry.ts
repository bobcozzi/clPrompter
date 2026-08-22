import * as assert from 'assert';
import { classifyMessage, determineOutcome, mapCommandMessages } from '../commandEntryModel';
import { buildCancelSqlJobCommand, CMD_RUN_SQL, normalizeSqlJobId } from '../commandEntryService';

const messages = mapCommandMessages([
    { ORDINAL_POSITION: 2, MSGID: 'CPF0001', MSGSEV: 40, MSGTYPE: 'ESCAPE', MSGTEXT: 'Failed', SECLVLMSG: 'Details' },
    { ORDINAL_POSITION: 1, MSGID: 'CPC0000', MSGSEV: 0, MSGTYPE: 'COMPLETION', MSGTEXT: 'Done', SECLVLMSG: '' },
]);
assert.deepStrictEqual(messages.map(message => message.ordinalPosition), [1, 2]);
assert.strictEqual(messages[1].kind, 'error');
assert.strictEqual(classifyMessage(10, 'STATUS'), 'warning');
assert.strictEqual(classifyMessage(0, 'INQUIRY'), 'warning');
assert.strictEqual(determineOutcome(messages), 'error');
assert.match(CMD_RUN_SQL, /CMD_RUN\(\?, \?\)/);
assert.strictEqual(normalizeSqlJobId('123456/myuser/qzdasoinit'), '123456/MYUSER/QZDASOINIT');
assert.strictEqual(normalizeSqlJobId('123456/USER/NOT VALID'), undefined);
const cancelCommand = buildCancelSqlJobCommand('123456/MYUSER/QZDASOINIT');
assert.match(cancelCommand, /QSYS2\.CANCEL_SQL\(''123456\/MYUSER\/QZDASOINIT''\)/i);
assert.match(cancelCommand, /RUNSQL\s+SQL\('/i);
console.log('Command Entry model tests passed');
