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

console.log('\n=== ISSUE 1: Qualified names with * values ===');

// Test 1: QTEMP/*FILE
const test1: CLNode = {
    type: 'command_call',
    name: 'COZTEST/BADQUAL',
    parameters: [
        {
            name: 'FILE',
            value: 'QTEMP/*FILE'
        }
    ],
    comment: '/* Hello world */'
};
console.log('Input: COZTEST/BADQUAL FILE(QTEMP/*FILE) /* Hello world */');
console.log('Output:');
console.log(formatCLCommand_v2(test1, undefined, config));
console.log('\nExpected: FILE(QTEMP/*FILE) /* Hello world */');
console.log('Problem: Should NOT have spaces around /');

// Test 2: &LIB/&FILE
const test2: CLNode = {
    type: 'command_call',
    name: 'CRTDDMF',
    parameters: [
        {
            name: 'FILE',
            value: 'QTEMP/DDMFRMFILE'
        },
        {
            name: 'RMTFILE',
            value: '&LIB/&FILE'
        },
        {
            name: 'RMTLOCNAME',
            value: {
                type: 'expression',
                tokens: [
                    { type: 'keyword', value: 'NAS' },
                    { type: 'space', value: ' ' },
                    { type: 'keyword', value: '*IP' }
                ],
                wrapped: false
            }
        },
        {
            name: 'LCLLOCNAME',
            value: '*LOC'
        },
        {
            name: 'PORT',
            value: '*DRDA'
        }
    ],
    comment: '/* create ddm file */'
};
console.log('\n=== TEST 2: Variable qualified name ===');
console.log('Input: CRTDDMF FILE(QTEMP/DDMFRMFILE) RMTFILE(&LIB/&FILE) ...');
console.log('Output:');
console.log(formatCLCommand_v2(test2, undefined, config));
console.log('\nExpected: RMTFILE(&LIB/&FILE) with NO spaces around /');

// Test 3: Working case - QTEMP/DDMTOFILE
const test3: CLNode = {
    type: 'command_call',
    name: 'DLTF',
    parameters: [
        {
            name: 'FILE',
            value: 'QTEMP/DDMTOFILE'
        },
        {
            name: 'SYSTEM',
            value: '*FILETYPE'
        }
    ]
};
console.log('\n=== TEST 3: Control test (should work) ===');
console.log('Input: DLTF FILE(QTEMP/DDMTOFILE) SYSTEM(*FILETYPE)');
console.log('Output:');
console.log(formatCLCommand_v2(test3, undefined, config));
console.log('\nExpected: Should format correctly with NO spaces');

console.log('\n=== ISSUE 2: Comment positioning ===');
const test4: CLNode = {
    type: 'command_call',
    name: 'CHGJOB',
    parameters: [
        {
            name: 'JOB',
            value: '*'
        },
        {
            name: 'JOBPTY',
            value: '3'
        }
    ],
    comment: '/* Short comment */'
};
console.log('Input: CHGJOB JOB(*) JOBPTY(3) /* Short comment */');
console.log('Output:');
console.log(formatCLCommand_v2(test4, undefined, config));
console.log('\nExpected: Comment on same line as last parameter if it fits');

console.log('\n=== ISSUE 3: Long strings extending beyond margin ===');
const test5: CLNode = {
    type: 'command_call',
    name: 'CHGJOB',
    parameters: [
        {
            name: 'JOB',
            value: '*'
        },
        {
            name: 'JOBPTY',
            value: '3'
        },
        {
            name: 'OUTPTY',
            value: '3'
        },
        {
            name: 'PRTDEV',
            value: '*USRPRF'
        },
        {
            name: 'OUTQ',
            value: '*USRPRF'
        },
        {
            name: 'RUNPTY',
            value: '14'
        },
        {
            name: 'PRTTXT',
            value: "'This is some print text'"
        }
    ],
    comment: '/* Print override */'
};
console.log('\nInput: CHGJOB JOB(*) JOBPTY(3) ... PRTTXT(\'This is some print text\') /* Print override */');
console.log('Output:');
const formatted3 = formatCLCommand_v2(test5, undefined, config);
console.log(formatted3);

// Check line lengths
const lines3 = formatted3.split('\n');
console.log('\nLine length analysis:');
lines3.forEach((line, index) => {
    console.log(`Line ${index + 1} length: ${line.length} chars${line.length > 70 ? ' *** EXCEEDS MARGIN ***' : ''}`);
    //console.log(`  "${line}"`);
});

console.log('\nProblem: PRTTXT line extends beyond right margin (70)');
console.log('Expected: PRTTXT(\' should fit within margin, rest wraps');
