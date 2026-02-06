import { CLNode } from './types';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

const config = {
    leftMargin: 14,
    kwdPosition: 24,
    contIndent: 27,
    rightMargin: 70,
    continuationChar: '+'
};

console.log('=== Testing Qualified Name with Operator Tokens ===\n');

// Test 1: Simple qualified name as string (how it currently works)
const test1: CLNode = {
    type: 'command_call',
    name: 'CRTDDMF',
    parameters: [
        {
            name: 'FILE',
            value: 'QTEMP/*FILE'
        }
    ]
};

console.log('Test 1: String value "QTEMP/*FILE"');
const formatted1 = formatCLCommand_v2(test1, undefined, config);
console.log(formatted1);
const hasSpaces1 = formatted1.includes(' / ');
console.log(`Result: ${hasSpaces1 ? '❌ HAS SPACES' : '✓ No spaces'}\n`);

// Test 2: Expression with operator tokens (what tokenizer creates)
const test2: CLNode = {
    type: 'command_call',
    name: 'CRTDDMF',
    parameters: [
        {
            name: 'FILE',
            value: {
                type: 'expression',
                tokens: [
                    { type: 'value', value: 'QTEMP' },
                    { type: 'operator', value: '/' },
                    { type: 'symbolic_value', value: '*FILE' }
                ],
                wrapped: false
            } as any
        }
    ]
};

console.log('Test 2: Expression with operator tokens [QTEMP] [/] [*FILE]');
const formatted2 = formatCLCommand_v2(test2, undefined, config);
console.log(formatted2);
const hasSpaces2 = formatted2.includes(' / ');
console.log(`Result: ${hasSpaces2 ? '❌ HAS SPACES' : '✓ No spaces'}\n`);

// Test 3: Variable qualified name
const test3: CLNode = {
    type: 'command_call',
    name: 'CRTDDMF',
    parameters: [
        {
            name: 'RMTFILE',
            value: {
                type: 'expression',
                tokens: [
                    { type: 'variable', value: '&LIB' },
                    { type: 'operator', value: '/' },
                    { type: 'variable', value: '&FILE' }
                ],
                wrapped: false
            } as any
        }
    ]
};

console.log('Test 3: Variable qualified name [&LIB] [/] [&FILE]');
const formatted3 = formatCLCommand_v2(test3, undefined, config);
console.log(formatted3);
const hasSpaces3 = formatted3.includes(' / ');
console.log(`Result: ${hasSpaces3 ? '❌ HAS SPACES' : '✓ No spaces'}\n`);

console.log('=== Summary ===');
console.log(`Test 1 (string): ${hasSpaces1 ? 'FAIL' : 'PASS'}`);
console.log(`Test 2 (operator): ${hasSpaces2 ? 'FAIL' : 'PASS'}`);
console.log(`Test 3 (variables): ${hasSpaces3 ? 'FAIL' : 'PASS'}`);
