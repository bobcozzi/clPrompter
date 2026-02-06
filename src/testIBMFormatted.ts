/**
 * Test formatting of IBM-formatted CL commands with comments
 * Simulates what happens when user opens IBM SEU/PDM formatted code and re-formats it
 */

import { formatCLSource, FormatOptions } from './formatCL';

const formatOptions: FormatOptions = {
    cvtcase: '*NONE',
    indrmks: '*NO',
    labelpos: 2,
    bgncol: 14,
    indcol: 27,
    indcont: 28
};

console.log('================================================================================');
console.log('Test: Formatting IBM SEU/PDM formatted code with multi-line comments');
console.log('================================================================================\n');

// Test 1: IBM formatted code with multi-line comment (comment spans 2 lines)
const ibmCode1 = [
    '            CHGVAR     VAR(&SHORTVAR) +',
    '                          VALUE(\'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+',
    '                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+',
    '                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+',
    '                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+',
    '                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+',
    '                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+',
    '                          xxxxxxxxxxxx\') /* hello +',
    '                          world */'
];

console.log('Test 1: Very long string with multi-line comment');
console.log('Input (IBM formatted):');
ibmCode1.forEach((line, idx) => console.log(`  ${idx + 1}: ${line}`));

const result1 = formatCLSource(ibmCode1, formatOptions, 0);

console.log('\nOutput (our formatter):');
result1.forEach((line, idx) => console.log(`  ${idx + 1}: ${line}`));

// Check if comment is preserved
const hasComment1 = result1.some(line => line.includes('hello') && line.includes('world'));
if (hasComment1) {
    console.log('\n✓ Comment preserved!');
} else {
    console.log('\n✗ ERROR: Comment was LOST!');
}

console.log('\n================================================================================\n');

// Test 2: IBM formatted code with single-line comment
const ibmCode2 = [
    '            CHGVAR     VAR(&FROMFILE) VALUE(\'These are the times to +',
    '                          remember, cause they will not last +',
    '                          forever. remember, cause they will not +',
    '                          last forever. remember, cause they will +',
    '                          not last forever. remember, cause they +',
    '                          will not last forever. won\'\'t although +',
    '                          we\'\'ll want to.\') /* Hello world */'
];

console.log('Test 2: Medium string with single-line comment');
console.log('Input (IBM formatted):');
ibmCode2.forEach((line, idx) => console.log(`  ${idx + 1}: ${line}`));

const result2 = formatCLSource(ibmCode2, formatOptions, 0);

console.log('\nOutput (our formatter):');
result2.forEach((line, idx) => console.log(`  ${idx + 1}: ${line}`));

// Check if comment is preserved
const hasComment2 = result2.some(line => line.includes('Hello world'));
if (hasComment2) {
    console.log('\n✓ Comment preserved!');
} else {
    console.log('\n✗ ERROR: Comment was LOST!');
}

console.log('\n================================================================================\n');

// Test 3: Short command with comment (control test)
const ibmCode3 = [
    '            CHGVAR     VAR(&SHORT) VALUE(\'Hello\') /* Simple comment */'
];

console.log('Test 3: Short string with single-line comment (control)');
console.log('Input (IBM formatted):');
ibmCode3.forEach((line, idx) => console.log(`  ${idx + 1}: ${line}`));

const result3 = formatCLSource(ibmCode3, formatOptions, 0);

console.log('\nOutput (our formatter):');
result3.forEach((line, idx) => console.log(`  ${idx + 1}: ${line}`));

// Check if comment is preserved
const hasComment3 = result3.some(line => line.includes('Simple comment'));
if (hasComment3) {
    console.log('\n✓ Comment preserved!');
} else {
    console.log('\n✗ ERROR: Comment was LOST!');
}
