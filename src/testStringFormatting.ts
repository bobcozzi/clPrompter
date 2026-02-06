/**
 * Test string formatting behavior from user's console log
 */

import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

console.log('================================================================================');
console.log('Test: String Formatting - VALUE( breaking behavior');
console.log('================================================================================\n');

// Test 1: Very long string - should backtrack entire VALUE( to new line
const test1: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&SHORTVAR' },
        {
            name: 'VALUE',
            value: "'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"
        }
    ]
};

console.log('Test 1: VERY long string (250+ chars)');
console.log('Expected: VALUE( backtracked to new line, string starts on same line as VALUE(');
console.log('\nActual output:');
const result1 = formatCLCommand_v2(test1, undefined, {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+'
});
console.log(result1);

// Show line lengths
const lines1 = result1.split('\n');
console.log('\nLine lengths:');
lines1.forEach((line, i) => {
    console.log(`  Line ${i + 1}: ${line.length} chars ${line.length > 70 ? '❌ EXCEEDS 70!' : ''}`);
});

console.log('\n================================================================================');

// Test 2: Medium string - should fit on first line with VALUE(
const test2: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&FROMFILE' },
        {
            name: 'VALUE',
            value: "'These are the times to remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. won''t although we''ll want to.'"
        }
    ]
};

console.log('\nTest 2: Medium string (~240 chars)');
console.log('Expected: VALUE( stays on first line, string wraps naturally');
console.log('\nActual output:');
const result2 = formatCLCommand_v2(test2, undefined, {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+'
});
console.log(result2);

// Show line lengths
const lines2 = result2.split('\n');
console.log('\nLine lengths:');
lines2.forEach((line, i) => {
    console.log(`  Line ${i + 1}: ${line.length} chars ${line.length > 70 ? '❌ EXCEEDS 70!' : ''}`);
});

console.log('\n================================================================================');
console.log('User\'s Expected Output:');
console.log('================================================================================\n');

console.log('Test 1 Expected:');
console.log(`             CHGVAR     VAR(&SHORTVAR) +
                          VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxx')`);

console.log('\n');
console.log('Test 2 Expected:');
console.log(`             CHGVAR     VAR(&FROMFILE) VALUE('These are the times to +
                          remember, cause they will not last +
                          forever. remember, cause they will not +
                          last forever. remember, cause they will +
                          not last forever. remember, cause they +
                          will not last forever. won''t although +
                          we''ll want to.')`);

console.log('\n================================================================================');
console.log('Analysis:');
console.log('================================================================================\n');
console.log('Issue: Formatter appears to be breaking after VALUE( instead of:');
console.log('  1. Keeping VALUE(\'string... together when it fits');
console.log('  2. Backtracking entire VALUE() to new line when string is very long');
console.log('\nCurrent behavior might be:');
console.log('  CHGVAR     VAR(&SHORTVAR) VALUE( +');
console.log('               \'xxxxxxxxxx...');
console.log('\nDesired behavior:');
console.log('  Option A (fits on line): VALUE(\'string...');
console.log('  Option B (too long): Backtrack to: VAR(&SHORTVAR) +');
console.log('                       Next line:     VALUE(\'string...');
