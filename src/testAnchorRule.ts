import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

/**
 * Test for the Anchor Rule:
 *
 * According to IBM i SEU spec:
 * - For Quoted values, anchor is KEYWORD('
 * - For Expressions, anchor is KEYWORD(
 * - If the anchor fits on current line, keep it there
 * - Only backtrack if the anchor itself doesn't fit
 * - Let the value wrap naturally on continuation lines
 *
 * Current problem: The formatter backtracks the entire KEYWORD( even when
 * the anchor + some value could fit on the same line.
 */

const config = {
    labelpos: 2,
    bgncol: 14,
    kwdPosition: 25,
    contIndent: 27,
    rightMargin: 70,
    AVG_PARAM_NAME: 6
};

// TEST 1: Quoted string - anchor should stay on same line
const node1: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        {
            name: 'VAR',
            value: '&VAR'
        },
        {
            name: 'VALUE',
            value: "'This is a long string that will need to wrap across multiple lines'"
        }
    ]
};
const result1 = formatCLCommand_v2(node1, undefined, config);

console.log('\n=== TEST 1: Quoted String with Anchor Rule ===');
console.log('Input: CHGVAR VAR(&VAR) VALUE(\'This is a long string that will need to wrap across multiple lines\')');
console.log('\nCurrent Output:');
console.log(result1);
console.log('\nExpected Behavior:');
console.log('              CHGVAR VAR(&VAR) VALUE(\'This is a long string +');
console.log('                         that will need to wrap across +');
console.log('                         multiple lines\')');
console.log('\nNote: VALUE(\' should stay on same line as VAR(&VAR), not backtrack');

// TEST 2: Multiple parameters where second has long string
const node2: CLNode = {
    type: 'command_call',
    name: 'SBMJOB',
    parameters: [
        {
            name: 'JOB',
            value: 'TESTJOB'
        },
        {
            name: 'MSGQ',
            value: "'This is a very long message queue specification that needs wrapping'"
        }
    ]
};
const result2 = formatCLCommand_v2(node2, undefined, config);

console.log('\n=== TEST 2: Multiple Parameters ===');
console.log('Input: SBMJOB JOB(TESTJOB) MSGQ(\'This is a very long message queue specification that needs wrapping\')');
console.log('\nCurrent Output:');
console.log(result2);
console.log('\nExpected Behavior:');
console.log('              SBMJOB JOB(TESTJOB) MSGQ(\'This is a very +');
console.log('                         long message queue +');
console.log('                         specification that needs +');
console.log('                         wrapping\')');
console.log('\nNote: MSGQ(\' should stay on same line after JOB(TESTJOB)');

// TEST 3: Expression parameter
const node3: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        {
            name: 'VAR',
            value: '&RESULT'
        },
        {
            name: 'VALUE',
            value: {
                type: 'expression',
                tokens: [
                    { type: 'keyword', value: '&VERYLONGVARIABLENAME' },
                    { type: 'space', value: ' ' },
                    { type: 'operator', value: '+' },
                    { type: 'space', value: ' ' },
                    { type: 'keyword', value: '&ANOTHERLONGVARIABLENAME' }
                ],
                wrapped: false
            }
        }
    ]
};
const result3 = formatCLCommand_v2(node3, undefined, config);

console.log('\n=== TEST 3: Expression Parameter ===');
console.log('Input: CHGVAR VAR(&RESULT) VALUE(&VERYLONGVARIABLENAME + &ANOTHERLONGVARIABLENAME)');
console.log('\nCurrent Output:');
console.log(result3);
console.log('\nExpected Behavior:');
console.log('              CHGVAR VAR(&RESULT) VALUE(&VERYLONGVARIABLENAME +');
console.log('                         + &ANOTHERLONGVARIABLENAME)');
console.log('\nNote: VALUE( should stay with &RESULT, not backtrack');

// TEST 4: Short value that fits - should not backtrack
const node4: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        {
            name: 'VAR',
            value: '&X'
        },
        {
            name: 'VALUE',
            value: "'SHORT'"
        }
    ]
};
const result4 = formatCLCommand_v2(node4, undefined, config);

console.log('\n=== TEST 4: Short Value (Control Test) ===');
console.log('Input: CHGVAR VAR(&X) VALUE(\'SHORT\')');
console.log('\nCurrent Output:');
console.log(result4);
console.log('\nExpected: Single line, no wrapping needed');

