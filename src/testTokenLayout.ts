/**
 * Simple standalone test for the new token layout formatter
 * This creates mock CLNode objects directly without parsing
 */

import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

// Create test nodes manually
const testNodes: CLNode[] = [
    // Test 1: Simple RUNIQRY with ELEM
    {
        type: 'command_call',
        name: 'RUNIQRY',
        parameters: [
            {
                name: 'SQL',
                value: "'select * from qiws.qcustcdt'"
            },
            {
                name: 'OUTPUT',
                value: '*PRINT'
            },
            {
                name: 'EXTRA',
                value: [
                    {
                        type: 'expression',
                        tokens: [
                            { type: 'symbolic_value', value: '*BEFORE' },
                            { type: 'space', value: ' ' },
                            { type: 'string', value: "'Something something something, dark side.'" }
                        ],
                        wrapped: true
                    },
                    {
                        type: 'expression',
                        tokens: [
                            { type: 'symbolic_value', value: '*AFTER' },
                            { type: 'space', value: ' ' },
                            { type: 'string', value: "'The force awakens in this one.'" }
                        ],
                        wrapped: true
                    }
                ]
            },
            {
                name: 'EMAIL',
                value: {
                    type: 'expression',
                    tokens: [
                        { type: 'string', value: "'cozzi@rpgiv.com'" },
                        { type: 'space', value: ' ' },
                        { type: 'string', value: "'jason@aidltd.com'" }
                    ],
                    wrapped: false
                }
            }
        ]
    },

    // Test 2: Simple CHGVAR
    {
        type: 'command_call',
        name: 'CHGVAR',
        parameters: [
            {
                name: 'VAR',
                value: '&COUNT'
            },
            {
                name: 'VALUE',
                value: {
                    type: 'expression',
                    tokens: [
                        { type: 'variable', value: '&COUNT' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '+' },
                        { type: 'space', value: ' ' },
                        { type: 'value', value: '1' }
                    ],
                    wrapped: false
                }
            }
        ]
    }
];

console.log('='.repeat(100));
console.log('TOKEN LAYOUT FORMATTER TEST');
console.log('='.repeat(100));

for (let i = 0; i < testNodes.length; i++) {
    const node = testNodes[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`TEST ${i + 1}: ${node.name}`);
    console.log('='.repeat(100));

    try {
        const result = formatCLCommand_v2(node);
        console.log(result);
    } catch (error) {
        console.log('ERROR:', error);
    }
}

console.log('\n' + '='.repeat(100));
console.log('TEST COMPLETE');
console.log('='.repeat(100));
