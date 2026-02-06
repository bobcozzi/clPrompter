// Final integration test - blank lines + continuation comments
import * as vscode from 'vscode';
import { formatCLSource } from './formatCL';

// Test input with blank lines and multi-line commands with comments
const testInput = [
    'PGM',
    '',  // blank line
    '/* This is a standalone comment */',
    'DCL VAR(&NAME) TYPE(*CHAR) LEN(10)',
    '',  // blank line
    "CHGVAR VAR(&LONGVAR) VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+",
    "         xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+",
    "         xxxxxxxxxxxx') /* This comment should be preserved */",
    '',  // blank line
    'ENDPGM'
];

console.log('=== Final Integration Test ===\n');
console.log('Input:');
testInput.forEach((line, idx) => {
    console.log(`  ${idx + 1}: |${line}|`);
});

const formatted = formatCLSource(testInput, {
    cvtcase: '*NONE',
    indrmks: '*YES',
    indcol: 2,
    labelpos: 2,
    bgncol: 14,
    indcont: 27
});

console.log('\nFormatted output:');
formatted.forEach((line, idx) => {
    console.log(`  ${idx + 1}: |${line}|`);
});

console.log('\n--- Verification ---');

// Check blank lines preserved
const inputBlanks = testInput.filter(l => l.trim() === '').length;
const outputBlanks = formatted.filter(l => l.trim() === '').length;
console.log(`Blank lines: Input=${inputBlanks}, Output=${outputBlanks}`);
if (inputBlanks === outputBlanks) {
    console.log('✓ Blank lines preserved');
} else {
    console.log('✗ Blank lines lost!');
}

// Check comment preserved (may be wrapped across lines)
const allText = formatted.join(' ');
const hasComment = allText.includes('This comment') && allText.includes('preserved');
if (hasComment) {
    console.log('✓ Continuation comment preserved');
} else {
    console.log('✗ Continuation comment lost!');
}

// Check standalone comment preserved
const hasStandaloneComment = formatted.some(line => line.includes('This is a standalone comment'));
if (hasStandaloneComment) {
    console.log('✓ Standalone comment preserved');
} else {
    console.log('✗ Standalone comment lost!');
}

if (inputBlanks === outputBlanks && hasComment && hasStandaloneComment) {
    console.log('\n🎉 ALL CHECKS PASSED!');
} else {
    console.log('\n❌ SOME CHECKS FAILED');
}
