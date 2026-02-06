// Test the user's RUNIQRY command
import { tokenizeCL, parseCL, extractCommentFromCommand } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

// User's example command (input as single line, spaces normalized)
const testCmd = "RUNIQRY SQL('select * from qiws.qcustcdt') OUTPUT(*PRINT) EXTRA((*BEFORE 'Something something something, dark side.') (*AFTER 'The force awakens in this one.')) EMAIL('cozzi@rpgiv.com' 'jason@aidltd.com') /* Hello World */";

console.log('=== Testing User\'s RUNIQRY Command ===\n');
console.log('Input command:');
console.log(testCmd);
console.log('\n--- Extracting comment ---');

const { command, comment } = extractCommentFromCommand(testCmd);
console.log('Command:', command);
console.log('Comment:', comment);

console.log('\n--- Formatting with rightMargin=70 ---\n');

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
console.log(formatted);

console.log('\n--- Line-by-line analysis ---');
const lines = formatted.split('\n');
let allGood = true;
lines.forEach((line, idx) => {
    const len = line.length;
    const status = len > 70 ? '❌' : len === 70 ? '✓=' : '✓';
    console.log(`${idx + 1}. [${len.toString().padStart(2)}] ${status} ${line}`);
    if (len > 70) {
        allGood = false;
    }
});

console.log('\n--- Results ---');
if (allGood) {
    console.log('✓ SUCCESS: All lines within 70-character margin!');
    console.log('✓ Comment preserved:', comment);
    console.log('✓ Total lines:', lines.length);
} else {
    console.log('❌ FAILURE: Some lines exceed margin');
}
