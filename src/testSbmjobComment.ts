// Test the SBMJOB command with short comment that should fit on same line
import * as vscode from 'vscode';
import { formatCLCmd } from './formatCL';

const testCmd = `SBMJOB CMD(DSPJOB JOB(063459/COZZI/THREADS) DUPJOBOPT(*MSG)) JOB(IBMIRD) PRTDEV(*USRPRF) /* what the heck? Over. */`;

console.log('=== Testing SBMJOB with Short Comment ===\n');
console.log('Input:', testCmd);
console.log('\nFormatting with rightMargin=70...\n');

const formatted = formatCLCmd(testCmd, {
    cvtcase: '*NONE',
    indrmks: '*YES',
    indcol: 2,
    labelpos: 2,
    bgncol: 14,
    indcont: 27
});

console.log('Formatted output:');
const lines = formatted.split('\n');
lines.forEach((line, idx) => {
    console.log(`${idx + 1}. [${line.length}] ${line}`);
});

console.log('\n--- Verification ---');

// Check if comment is on same line as PRTDEV
const lastParamLine = lines.find(l => l.includes('PRTDEV(*USRPRF)'));
if (lastParamLine && lastParamLine.includes('/* what the heck? Over. */')) {
    console.log('✓ PASS: Comment stays on same line as PRTDEV');
} else if (lastParamLine && lastParamLine.includes(' +')) {
    console.log('✗ FAIL: Unnecessary continuation added to PRTDEV line');
} else {
    console.log('✗ FAIL: Comment moved to separate line');
}

// Check all lines are within margin
const overflowLines = lines.filter(l => l.length > 70);
if (overflowLines.length === 0) {
    console.log('✓ PASS: All lines within 70-character margin');
} else {
    console.log(`✗ FAIL: ${overflowLines.length} line(s) exceed margin`);
    overflowLines.forEach(l => console.log(`  [${l.length}] ${l}`));
}
