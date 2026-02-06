// Test continuation character causing margin overflow
import { tokenizeCL, parseCL, extractCommentFromCommand } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

const testCmd = "RUNIQRY SQL('select * from qiws.qcustcdt') OUTPUT(*PRINT) EXTRA((*BEFORE 'Something something something, dark side.') (*AFTER 'The force awakens in this one.')) EMAIL('cozzi@rpgiv.com' 'jason@aidltd.com') /* Hello World */";

console.log('=== Testing Margin Overflow with Continuation ===\n');
console.log('Input:', testCmd);
console.log('\n--- Formatting with rightMargin=70 ---\n');

// Extract comment first
const { command, comment } = extractCommentFromCommand(testCmd);
console.log('Command:', command);
console.log('Comment:', comment);
console.log('');

const tokens = tokenizeCL(command);
const node = parseCL(tokens, comment);

const formatted = formatCLCommand_v2(node, 'IQUERY', {
    leftMargin: 14,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25
});

console.log('Formatted output:');
const lines = formatted.split('\n');
lines.forEach((line, idx) => {
    const len = line.length;
    const marker = len > 70 ? ' ❌ EXCEEDS MARGIN!' : len === 70 ? ' ✓ at margin' : '';
    console.log(`${idx + 1}. [${len.toString().padStart(2)}] ${line}${marker}`);
});

// Check each line doesn't exceed margin
let allGood = true;
lines.forEach((line, idx) => {
    if (line.length > 70) {
        console.log(`\n❌ Line ${idx + 1} exceeds margin: ${line.length} > 70`);
        allGood = false;
    }
});

if (allGood) {
    console.log('\n✓ PASS: All lines within margin');
} else {
    console.log('\n✗ FAIL: Some lines exceed margin');
}
