import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

console.log('================================================================================');
console.log('Test: Comment Preservation with Long Strings');
console.log('================================================================================\n');

// Test 1: Very long string (250 chars) WITH comment
const test1: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&SHORTVAR' },
        {
            name: 'VALUE',
            value: "'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'"
        }
    ],
    comment: '/* hello world */'
};

console.log('Test 1: VERY long string (250+ chars) WITH comment');
console.log('Expected: Comment should appear after closing paren');
console.log('\nActual output:');
const result1 = formatCLCommand_v2(test1, undefined, {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    contIndent: 27,
    rightMargin: 70,
    continuationChar: '+'
});
console.log(result1);

// Check if comment is present
if (result1.includes('/* hello world */')) {
    console.log('✓ Comment preserved!');
} else {
    console.log('✗ ERROR: Comment was lost!');
}

// Measure line lengths
const lines1 = result1.split('\n');
console.log('\nLine lengths:');
lines1.forEach((line, idx) => {
    console.log(`  Line ${idx + 1}: ${line.length} chars`);
});

console.log('\n================================================================================\n');

// Test 2: Medium string (~240 chars) WITH comment
const test2: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&FROMFILE' },
        {
            name: 'VALUE',
            value: "'These are the times to remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. won''t although we''ll want to.'"
        }
    ],
    comment: '/* Hello world */'
};

console.log('Test 2: Medium string (240 chars) WITH comment');
console.log('Expected: Comment should appear after closing paren');
console.log('\nActual output:');
const result2 = formatCLCommand_v2(test2, undefined, {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    contIndent: 27,
    rightMargin: 70,
    continuationChar: '+'
});
console.log(result2);

// Check if comment is present
if (result2.includes('/* Hello world */')) {
    console.log('✓ Comment preserved!');
} else {
    console.log('✗ ERROR: Comment was lost!');
}

// Measure line lengths
const lines2 = result2.split('\n');
console.log('\nLine lengths:');
lines2.forEach((line, idx) => {
    console.log(`  Line ${idx + 1}: ${line.length} chars`);
});

console.log('\n================================================================================\n');

// Test 3: Short string WITH comment (should fit on same line)
const test3: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        { name: 'VAR', value: '&SHORT' },
        { name: 'VALUE', value: "'Hello'" }
    ],
    comment: '/* Simple comment */'
};

console.log('Test 3: Short string WITH comment (should fit on same line)');
console.log('Expected: Comment should appear on same line as command');
console.log('\nActual output:');
const result3 = formatCLCommand_v2(test3, undefined, {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    contIndent: 27,
    rightMargin: 70,
    continuationChar: '+'
});
console.log(result3);

// Check if comment is present on same line
const lines3 = result3.split('\n');
if (lines3.length === 1 && result3.includes('/* Simple comment */')) {
    console.log('✓ Comment preserved on same line!');
} else if (result3.includes('/* Simple comment */')) {
    console.log('⚠ Comment preserved but on different line');
} else {
    console.log('✗ ERROR: Comment was lost!');
}

console.log('\nLine lengths:');
lines3.forEach((line, idx) => {
    console.log(`  Line ${idx + 1}: ${line.length} chars`);
});
