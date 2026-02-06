/**
 * Test long strings and specific formatting issues reported by user
 */

import { tokenizeCL, parseCL } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

// Test cases from user report
const testCommands = [
    // Test 1: Long string with continuation
    "CHGVAR VAR(&LONGVAR_FIELDNAME) VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')",

    // Test 2: Long string with spaces that should be preserved
    "CHGVAR VAR(&FROMFILE) VALUE('These are the times to remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. won''t although we''ll want to.')",

    // Test 3: Command with label and parameters that were breaking incorrectly
    "CHGJOB JOB(400400/COZZI/DSP01) JOBPTY(3) OUTQ(*USRPRF) LOG(4 0 *SECLVL) DDMCNV(*KEEP) SCDDATE(*MONTHSTR) SCDTIME(*CURRENT) DATFMT(*YMD) DFTWAIT(*NOMAX)",
];

console.log('='.repeat(100));
console.log('LONG STRING FORMATTING TEST');
console.log('='.repeat(100));

for (let i = 0; i < testCommands.length; i++) {
    const cmd = testCommands[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`TEST ${i + 1}: ${cmd.substring(0, 60)}...`);
    console.log('='.repeat(100));

    try {
        const tokens = tokenizeCL(cmd);
        const node = parseCL(tokens);

        console.log('\nParsed VALUE:', JSON.stringify(node.parameters[1]?.value, null, 2 ));

        const labelToUse = i === 2 ? 'CHANGJOB' : undefined;
        const formatted = formatCLCommand_v2(node, labelToUse);
        // Check line lengths
        const lines = formatted.split('\n');
        let hasOverflow = false;
        for (const line of lines) {
            if (line.length > 80) {
                hasOverflow = true;
                console.log(`⚠️  LINE OVERFLOW: ${line.length} chars: "${line.substring(0, 80)}..."`);
            }
        }

        if (!hasOverflow) {
            console.log('✅ All lines within margin');
        }

    } catch (error) {
        console.error('❌ ERROR:', error);
    }
}

console.log('\n' + '='.repeat(100));
console.log('TEST COMPLETE');
console.log('='.repeat(100));
