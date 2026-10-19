import * as assert from 'assert';
import { buildDepErrorMessage } from '../depDiagnostics';

function run(): void {
    const depParms = [
        { kwd: 'TYPE', rel: 'EQ', cmpVal: '1' },
        { kwd: 'LEN', rel: 'GE', cmpVal: '1' },
        { kwd: 'VALUE', rel: 'SPCFD' },
        { kwd: 'STG', rel: 'NE', cmpVal: '4' },
        { kwd: 'BASPTR', rel: 'SPCFD' },
        { kwd: 'DEFVAR', rel: 'SPCFD' },
        { kwd: 'ADDRESS', rel: 'SPCFD' },
        { kwd: 'RTRNVAL', rel: 'SPCFD' },
    ];

    const constraint = {
        ctlKwdRel: 'ALWAYS',
        nbrTrueRel: 'GE',
        nbrTrue: 1,
        msgId: 'CPD6238',
        depParms,
    } as any;

    const message = buildDepErrorMessage(constraint, 0);

    assert.ok(!message.includes('at least 1 of 17 conditions must hold'));
    assert.ok(message.includes('At least one of'));
    assert.ok(message.includes('TYPE'));
    assert.ok(message.includes('LEN'));
    assert.ok(message.includes('VALUE'));

    console.log('testDepDiagnostic: all assertions passed');
}

run();
