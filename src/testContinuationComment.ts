// Test continuation lines with trailing comment
import * as vscode from 'vscode';
import { collectCLCmdFromLine } from './extractor';
import { tokenizeCL, parseCL } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

const testCmd = `             CHGVAR     VAR(&LONGVAR_FIELDNAME) VALUE('xxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxx') /* Pickles */`;

console.log('=== Testing Continuation with Comment ===\n');
console.log('Input command:');
console.log(testCmd);
console.log('\n--- Step 1: collectCLCmdFromLine ---');

// Mock document
const lines = testCmd.split('\n');
const mockDoc = {
    lineCount: lines.length,
    lineAt: (idx: number) => ({ text: lines[idx] })
} as vscode.TextDocument;

const result = collectCLCmdFromLine(mockDoc, 0);
console.log('Extracted command:', result.command);
console.log('Extracted comment:', result.comment);
console.log('Start line:', result.startLine, 'End line:', result.endLine);

console.log('\n--- Step 2: tokenizeCL ---');
const tokens = tokenizeCL(result.command);
console.log('Tokens:', JSON.stringify(tokens, null, 2));

console.log('\n--- Step 3: parseCL ---');
const node = parseCL(tokens, result.comment);
console.log('Node:', JSON.stringify(node, null, 2));
console.log('Node comment:', node.comment);

console.log('\n--- Step 4: formatCLCommand_v2 ---');
const formatted = formatCLCommand_v2(node, undefined, {
    leftMargin: 14,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25
});

console.log('Formatted output:');
console.log(formatted);

console.log('\n--- Verification ---');
if (formatted.includes('Pickles')) {
    console.log('✓ PASS: Comment preserved in output');
} else {
    console.log('✗ FAIL: Comment lost!');
}
