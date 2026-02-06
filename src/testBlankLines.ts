/**
 * Test blank line preservation in file formatting
 */

import { formatCLSource, FormatOptions } from './formatCL';

const formatOptions: FormatOptions = {
    cvtcase: '*NONE',
    indrmks: '*YES',
    labelpos: 2,
    bgncol: 14,
    indcol: 25,
    indcont: 27
};

console.log("\n=== Testing Blank Line Preservation ===\n");

// Test input with blank lines between commands
const inputLines = [
    'PGM',
    '',
    'DCL VAR(&NAME) TYPE(*CHAR) LEN(10)',
    '',
    '',
    "CHGVAR VAR(&NAME) VALUE('TEST')",
    '',
    'ENDPGM'
];

console.log("Input (with blank lines):");
inputLines.forEach((line, i) => {
    console.log(`  ${i + 1}: |${line}|`);
});

const formatted = formatCLSource(inputLines, formatOptions, 0);

console.log("\nFormatted output:");
formatted.forEach((line, i) => {
    console.log(`  ${i + 1}: |${line}|`);
});

// Count blank lines
const inputBlanks = inputLines.filter(l => l.trim() === '').length;
const outputBlanks = formatted.filter(l => l.trim() === '').length;

console.log(`\nBlank lines: Input=${inputBlanks}, Output=${outputBlanks}`);

if (outputBlanks === inputBlanks) {
    console.log('✓ PASS: Blank lines preserved!');
} else {
    console.log(`✗ FAIL: Lost ${inputBlanks - outputBlanks} blank lines`);
}
