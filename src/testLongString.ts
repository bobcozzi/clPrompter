import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

const config = {
    labelpos: 2,
    bgncol: 14,
    kwdPosition: 25,
    contIndent: 27,
    rightMargin: 70,
    AVG_PARAM_NAME: 6
};

console.log('\n=== Long String Test (from user report) ===');

// User's actual example
const test1: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        {
            name: 'VAR',
            value: '&FROMFILE'
        },
        {
            name: 'VALUE',
            value: "'These are the times to remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. won''t although we''ll want to.'"
        }
    ]
};

console.log('Input: CHGVAR VAR(&FROMFILE) VALUE(\'These are the times to remember...\')');
console.log('\nOutput:');
const result = formatCLCommand_v2(test1, undefined, config);
console.log(result);

// Count line lengths
const lines = result.split('\n');
console.log('\nLine lengths:');
lines.forEach((line, i) => {
    const len = line.trimEnd().length;
    const status = len > 70 ? ' ⚠️ EXCEEDS MARGIN' : '';
    console.log(`Line ${i + 1}: ${len} chars${status}`);
    if (len > 70) {
        console.log(`  "${line.substring(0, 72)}..."`);
    }
});

console.log('\nExpected: First line should not exceed column 70');
console.log('Expected: VALUE(\' should appear on first line with as much text as fits');
