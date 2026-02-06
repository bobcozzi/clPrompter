// Test cases for issues with string continuation, closing parens, and nested commands
import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode, CLToken } from './types';

// Test configuration matching user's settings
const config = {
    labelPosition: 1,    // Position 2 (1-based)
    leftMargin: 13,      // Position 14 (1-based)
    kwdPosition: 24,     // Position 25 (1-based)
    rightMargin: 70,
    contIndent: 27,      // Position 27 (1-based) for parameter continuations
    continuationChar: '+'
};

console.log('Issue 1: Nested command continuation indent');
const node1: CLNode = {
    type: 'command_call',
    name: 'SBMJOB',
    parameters: [
        {
            name: 'CMD',
            value: {
                type: 'command_call',
                name: 'DSPJOB',
                parameters: [
                    { name: 'JOB', value: '063459/COZZI/THREADS' },
                    { name: 'DUPJOBOPT', value: '*MSG' }
                ]
            }
        },
        { name: 'JOB', value: 'IBMIRD' },
        { name: 'PRTDEV', value: '*USRPRF' }
    ],
    comment: '/* what the fuck? Over. */'
};
const formatted1 = formatCLCommand_v2(node1, undefined, config);
console.log(formatted1);
console.log('');

console.log('Issue 2: Orphaned closing paren - SCDTIME(*CURRENT)');
const node2: CLNode = {
    type: 'command_call',
    name: 'CHGJOB',
    parameters: [
        { name: 'JOB', value: '400400/COZZI/DSP01' },
        { name: 'JOBPTY', value: '3' },
        { name: 'OUTQ', value: '*USRPRF' },
        { name: 'LOG', value: ['4', '0', '*SECLVL'] },
        { name: 'DDMCNV', value: '*KEEP' },
        { name: 'SCDDATE', value: '*MONTHSTR' },
        { name: 'SCDTIME', value: '*CURRENT' },
        { name: 'DATFMT', value: '*YMD' },
        { name: 'DFTWAIT', value: '*NOMAX' }
    ],
    comment: '/* Something, something, something, dark side! */'
};
const formatted2 = formatCLCommand_v2(node2, 'CHANGJOB', config);
console.log(formatted2);
console.log('');

console.log('Issue 3: String breaking after opening paren - PRTTXT');
const node3: CLNode = {
    type: 'command_call',
    name: 'CHGJOB',
    parameters: [
        { name: 'JOB', value: '*' },
        { name: 'JOBPTY', value: '3' },
        { name: 'OUTPTY', value: '3' },
        { name: 'PRTDEV', value: '*USRPRF' },
        { name: 'OUTQ', value: '*USRPRF' },
        { name: 'RUNPTY', value: '14' },
        { name: 'PRTTXT', value: "'This is some print text'" },
        { name: 'LOG', value: ['4', '0', '*MSG'] },
        { name: 'LOGCLPGM', value: '*YES' },
        { name: 'LOGOUTPUT', value: '*JOBEND' }
    ],
    comment: '/* Print override */'
};
const formatted3 = formatCLCommand_v2(node3, undefined, config);
console.log(formatted3);
console.log('');

console.log('Issue 4: String continuation indent - should be at position 14 (leftMargin)');
const node4: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&FROMFILE' },
        { name: 'VALUE', value: "'These are the times toremember, cause they will not lastforever.'" }
    ]
};
const formatted4 = formatCLCommand_v2(node4, undefined, config);
console.log(formatted4);
console.log('');
console.log('Expected IBM formatter output for comparison:');
console.log(`              CHGVAR     VAR(&FROMFILE) VALUE('These are the times +`);
console.log(`                         toremember, cause they will not +`);
console.log(`                         lastforever.')`);
