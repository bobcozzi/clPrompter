// Debug test for Issue 4 - long string backtracking
import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

const config = {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+'
};

console.log('Test: CHGVAR with 85-char string');
const node: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&FROMFILE' },
        { name: 'VALUE', value: "'These are the times to remember, cause they will not last forever. won''t although''ll'" }
    ]
};

const formatted = formatCLCommand_v2(node, undefined, config);
console.log(formatted);
console.log('');

// Count line lengths
const lines = formatted.split('\n');
for (let i = 0; i < lines.length; i++) {
    console.log(`Line ${i+1} (${lines[i].length} chars): ${lines[i]}`);
}
