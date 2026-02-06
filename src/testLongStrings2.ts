/**
 * Test long strings and specific formatting issues reported by user
 * Creates mock CLNode objects directly to avoid vscode dependency
 */

import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

// Test cases from user report - created as mock CLNode objects
const testNodes: CLNode[] = [
    // Test 1: Very long string with 'x' characters (should break intelligently)
    {
        type: 'command_call',
        name: 'CHGVAR',
        parameters: [
            {
                name: 'VAR',
                value: '&LONGVAR_FIELDNAME'
            },
            {
                name: 'VALUE',
                value: "'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"
            }
        ]
    },

    // Test 2: Long string with spaces (spaces MUST be preserved!)
    {
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
    },

    // Test 3: Command with many parameters (test keyword+paren staying together)
    {
        type: 'command_call',
        name: 'CHGJOB',
        parameters: [
            {
                name: 'JOB',
                value: {
                    type: 'expression',
                    tokens: [
                        { type: 'value', value: '400400' },
                        { type: 'operator', value: '/' },
                        { type: 'keyword', value: 'COZZI' },
                        { type: 'operator', value: '/' },
                        { type: 'keyword', value: 'DSP01' }
                    ],
                    wrapped: false
                }
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
                value: {
                    type: 'expression',
                    tokens: [
                        { type: 'value', value: '4' },
                        { type: 'space', value: ' ' },
                        { type: 'value', value: '0' },
                        { type: 'space', value: ' ' },
                        { type: 'symbolic_value', value: '*SECLVL' }
                    ],
                    wrapped: false
                }
            },
            {
                name: 'DDMCNV',
                value: '*KEEP'
            },
            {
                name: 'SCDDATE',
                value: '*MONTHSTR'
            },
            {
                name: 'SCDTIME',
                value: '*CURRENT'
            },
            {
                name: 'DATFMT',
                value: '*YMD'
            },
            {
                name: 'DFTWAIT',
                value: '*NOMAX'
            }
        ],
        comment: '/* Something, something, something, dark side! */'
    }
];

console.log('='.repeat(100));
console.log('LONG STRING FORMATTING TEST');
console.log('='.repeat(100));

for (let i = 0; i < testNodes.length; i++) {
    const node = testNodes[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`TEST ${i + 1}: ${node.name}`);
    console.log('='.repeat(100));

    const labelToUse = i === 2 ? 'CHANGJOB' : undefined;
    const formatted = formatCLCommand_v2(node, labelToUse);

    console.log(formatted);

    // Check line lengths
    const lines = formatted.split('\n');
    let hasOverflow = false;
    let maxLen = 0;
    for (const line of lines) {
        if (line.length > maxLen) {
            maxLen = line.length;
        }
        if (line.length > 80) {
            hasOverflow = true;
            console.log(`\n⚠️  LINE OVERFLOW: ${line.length} chars`);
            console.log(`   "${line}"`);
        }
    }

    if (!hasOverflow) {
        console.log(`\n✅ All lines within 80 char margin (max: ${maxLen})`);
    }

    // For string tests, verify content preservation
    if (i < 2) {
        const valueParam = node.parameters.find(p => p.name === 'VALUE');
        if (valueParam && typeof valueParam.value === 'string') {
            const originalValue = valueParam.value;
            if (formatted.includes(originalValue.substring(10, 30))) {
                console.log('✅ String content appears preserved');
            } else {
                console.log('⚠️  String content may be altered - check for missing spaces');
            }
        }
    }
}

console.log('\n' + '='.repeat(100));
console.log('TEST COMPLETE');
console.log('='.repeat(100));
