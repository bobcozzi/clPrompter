/**
 * Test recent formatting issues
 * Tests keyword paren spacing, wrapped expressions, and margin respect
 */

import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode, CLToken } from './types';

const testNodes: CLNode[] = [
    // Test 1: RUNIQRY with EXTRA parameter having wrapped expressions with long strings
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
                        wrapped: true,
                        tokens: [
                            { type: 'symbolic_value', value: '*BEFORE' },
                            { type: 'space', value: ' ' },
                            { type: 'string', value: "'Something something something, dark side.'" }
                        ] as CLToken[]
                    },
                    {
                        type: 'expression',
                        wrapped: true,
                        tokens: [
                            { type: 'symbolic_value', value: '*AFTER' },
                            { type: 'space', value: ' ' },
                            { type: 'string', value: "'The force awakens in this one.'" }
                        ] as CLToken[]
                    }
                ]
            },
            {
                name: 'EMAIL',
                value: [
                    "'cozzi@rpgiv.com'",
                    "'jason@aidltd.com'"
                ]
            }
        ]
    },

    // Test 2: Expression with nested parens and operators
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
                        { type: 'variable', value: '&A' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '*' },
                        { type: 'space', value: ' ' },
                        { type: 'variable', value: '&B' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '+' },
                        { type: 'space', value: ' ' },
                        { type: 'value', value: '3' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '-' },
                        { type: 'space', value: ' ' },
                        { type: 'paren_open', value: '(' },
                        { type: 'variable', value: '&OFFSET' },
                        { type: 'space', value: ' ' },
                        { type: 'operator', value: '*' },
                        { type: 'space', value: ' ' },
                        { type: 'variable', value: '&LEN' },
                        { type: 'paren_close', value: ')' }
                    ] as CLToken[]
                }
            }
        ]
    },

    // Test 3: CHGJOB with OUTQ parameter that should wrap as a unit
    {
        type: 'command_call',
        name: 'CHGJOB',
        parameters: [
            {
                name: 'JOB',
                value: '400400/COZZI/DSP01'
            },
            {
                name: 'JOBPTY',
                value: '3'
            },
            {
                name: 'OUTQ',
                value: '*USRPRF'
            },
            {
                name: 'LOG',
                value: ['4', '0', '*SECLVL']
            }
        ]
    },

    // Test 4: SBMJOB with nested CMD parameter
    {
        type: 'command_call',
        name: 'SBMJOB',
        parameters: [
            {
                name: 'CMD',
                value: {
                    type: 'command_call',
                    name: 'DSPJOB',
                    parameters: [
                        {
                            name: 'JOB',
                            value: '063459/COZZI/THREADS'
                        },
                        {
                            name: 'DUPJOBOPT',
                            value: '*MSG'
                        }
                    ]
                }
            },
            {
                name: 'JOB',
                value: 'IBMIRD'
            },
            {
                name: 'PRTDEV',
                value: '*USRPRF'
            }
        ],
        comment: '/* what the fuck? Over. */'
    }
];

console.log('='.repeat(80));
console.log('Testing Recent Formatting Issues');
console.log('='.repeat(80));
console.log();

testNodes.forEach((node, index) => {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Test ${index + 1}: ${node.name}`);
    console.log('='.repeat(80));

    const result = formatCLCommand_v2(node, undefined, {
        labelPosition: 1,      // 0-based: column 2
        leftMargin: 13,        // 0-based: column 14
        kwdPosition: 24,       // 0-based: column 25
        contIndent: 27,        // 1-based: column 27
        rightMargin: 70,
        continuationChar: '+'
    });

    console.log(result);

    // Check line lengths
    const lines = result.split('\n');
    lines.forEach((line, lineNum) => {
        const len = line.replace(/\s+$/, '').length; // Trim trailing spaces
        if (len > 70) {
            console.log(`  ⚠️  Line ${lineNum + 1} exceeds margin: ${len} chars`);
        }
    });
});

console.log('\n' + '='.repeat(80));
console.log('Tests complete!');
console.log('='.repeat(80));
