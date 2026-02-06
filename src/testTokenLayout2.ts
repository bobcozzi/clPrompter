import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

// More comprehensive tests
const testNodes: CLNode[] = [
    // Test 1: SBMJOB with CMD parameter (the original problem case)
    {
        type: 'command_call',
        name: 'SBMJOB',
        parameters: [
            {
                name: 'CMD',
                value: {
                    type: 'expression',
                    tokens: [
                        { type: 'keyword', value: 'CALL' },
                        { type: 'space', value: ' ' },
                        { type: 'keyword', value: 'PGM' },
                        { type: 'paren_open', value: '(' },
                        { type: 'keyword', value: 'MYLIB' },
                        { type: 'operator', value: '/' },
                        { type: 'keyword', value: 'MYPGM' },
                        { type: 'paren_close', value: ')' }
                    ],
                    wrapped: false
                }
            },
            {
                name: 'JOB',
                value: '063459'
            }
        ]
    },

    // Test 2: Simple command with string
    {
        type: 'command_call',
        name: 'DSPLIBL',
        parameters: [
            {
                name: 'OUTPUT',
                value: '*PRINT'
            }
        ]
    },

    // Test 3: Command with long strings that should wrap
    {
        type: 'command_call',
        name: 'ADDLIBLE',
        parameters: [
            {
                name: 'LIB',
                value: 'VERYLONGLIBRARYNAMETHATSHOULDCAUSEWRAPPING'
            },
            {
                name: 'POSITION',
                value: '*FIRST'
            }
        ]
    },

    // Test 4: Expression with spaces
    {
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
                        { type: 'keyword', value: '&VALUE1' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '+' },
                        { type: 'space', value: ' ' },
                        { type: 'keyword', value: '&VALUE2' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '*' },
                        { type: 'space', value: ' ' },
                        { type: 'value', value: '100' }
                    ],
                    wrapped: false
                }
            }
        ]
    }
];

console.log('='.repeat(100));
console.log('TOKEN LAYOUT FORMATTER - COMPREHENSIVE TESTS');
console.log('='.repeat(100));

for (let i = 0; i < testNodes.length; i++) {
    const node = testNodes[i];
    console.log('\n' + '='.repeat(100));
    console.log(`TEST ${i + 1}: ${node.name}`);
    console.log('='.repeat(100));

    const formatted = formatCLCommand_v2(node);
    console.log(formatted);
}

console.log('\n' + '='.repeat(100));
console.log('TEST COMPLETE');
console.log('='.repeat(100));
