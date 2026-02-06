// Test MONMSG with comment that should start on same line
import { tokenizeCL, parseCL, extractCommentFromCommand } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

const testCmdShort = "MONMSG MSGID(MSG1000 MSG2000) /* hello people what the heck are you doing here? */";
const testCmdLong = "MONMSG MSGID(MSG1000 MSG2000) /* hello people what the heck are you doing here? Come on Beatles are cool, too */";

console.log('=== Test 1: Short Comment ===\n');
console.log('Input:', testCmdShort);

let result = extractCommentFromCommand(testCmdShort);
let tokens = tokenizeCL(result.command);
let node = parseCL(tokens, result.comment);
let formatted = formatCLCommand_v2(node, 'TRYCATCH', {
    leftMargin: 14,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25
});

console.log('\nFormatted output:');
formatted.split('\n').forEach((line, idx) => {
    console.log(`${idx + 1}. [${line.length.toString().padStart(2)}] ${line}`);
});

console.log('\n=== Test 2: Long Comment (needs wrapping) ===\n');
console.log('Input:', testCmdLong);

result = extractCommentFromCommand(testCmdLong);
tokens = tokenizeCL(result.command);
node = parseCL(tokens, result.comment);
formatted = formatCLCommand_v2(node, 'TRYCATCH', {
    leftMargin: 14,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25
});

console.log('\nFormatted output:');
formatted.split('\n').forEach((line, idx) => {
    console.log(`${idx + 1}. [${line.length.toString().padStart(2)}] ${line}`);
});

console.log('\n--- Verification ---');
const lines = formatted.split('\n');
const allWithinMargin = lines.every(line => line.length <= 70);
console.log(allWithinMargin ? '✓ All lines within margin' : '❌ Some lines exceed margin');
