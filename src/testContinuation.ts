/**
 * Test continuation character spacing
 * The continuation char should have NO space before it when at right margin
 */

import { formatCL_SEU } from './tokenizeCL';
import { tokenizeCL, parseCL } from './tokenizeCL';

// Test case: Long string that needs continuation
const cmd = `CHGVAR VAR(&FROMFILE) VALUE('These are the times to remember, cause they will not last forever.')`;

console.log('Testing continuation character spacing...\n');
console.log('Input:');
console.log(cmd);
console.log('\n' + '='.repeat(80));

const tokens = tokenizeCL(cmd);
const node = parseCL(tokens);

if (node) {
    const formatted = formatCL_SEU(node);
    console.log('\nFormatted output:');
    console.log(formatted);

    console.log('\n' + '='.repeat(80));
    console.log('Line-by-line analysis:');
    const lines = formatted.split('\n');
    lines.forEach((line, idx) => {
        const len = line.length;
        const hasContinuation = line.includes('+');
        const charBeforePlus = hasContinuation ? line.charAt(line.indexOf('+') - 1) : '';
        console.log(`Line ${idx + 1} (${len} chars): ${line}`);
        if (hasContinuation) {
            console.log(`  → Char before '+': '${charBeforePlus}' (${charBeforePlus === ' ' ? 'SPACE - ERROR!' : 'OK'})`);
        }
    });

    // Check for space before +
    const hasSpaceBeforePlus = / \+/.test(formatted);
    console.log('\n' + '='.repeat(80));
    if (hasSpaceBeforePlus) {
        console.log('❌ ERROR: Space found before continuation character!');
        console.log('   This will break string concatenation.');
    } else {
        console.log('✅ OK: No space before continuation character');
    }
}
