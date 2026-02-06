/**
 * Test harness for comparing old vs new formatter
 * Run this to verify the new token-based formatter produces equivalent output
 */

import { tokenizeCL, parseCL, formatCL_SEU } from './tokenizeCL';
// import { formatCL_SEU } from './tokenLayoutFormatter';  // Not exported there

// Test cases
const testCommands = [
    // 1. Simple ELEM with wrapped expressions
    "RUNIQRY SQL('select * from qiws.qcustcdt') OUTPUT(*PRINT) EXTRA((*BEFORE 'Something something something, dark side.') (*AFTER 'The force awakens in this one.')) EMAIL('cozzi@rpgiv.com' 'jason@aidltd.com')",

    // 2. SBMJOB with CMD parameter
    "SBMJOB CMD(DSPJOB JOB(063459/COZZI/THREADS) OUTPUT(*) OPTION(*SELECT) DUPJOBOPT(*MSG)) JOB(IBMIRD) PRTDEV(*USRPRF)",

    // 3. Simple command
    "CHGVAR VAR(&COUNT) VALUE(&COUNT + 1)",

    // 4. Command with long string
    "SNDPGMMSG MSG('This is a very long message that should wrap nicely across multiple lines without breaking in weird places') TOMSGQ(*SYSOPR)",
];

console.log('='.repeat(100));
console.log('CL FORMATTER COMPARISON TEST');
console.log('='.repeat(100));

for (let i = 0; i < testCommands.length; i++) {
    const cmd = testCommands[i];
    console.log(`\n${'='.repeat(100)}`);
    console.log(`TEST ${i + 1}: ${cmd.substring(0, 80)}...`);
    console.log('='.repeat(100));

    try {
        // Parse the command
        const tokens = tokenizeCL(cmd);
        const node = parseCL(tokens);

        if (!node) {
            console.log('ERROR: Failed to parse command');
            continue;
        }
        console.log('\n--- FORMATTER OUTPUT (formatCL_SEU) ---');
        const result = formatCL_SEU(node);
        console.log(result);

        // Format with new formatter
        // console.log('\n--- NEW FORMATTER (tokenLayoutFormatter.ts) ---');
        // const newResult = formatCL_SEU(node);
        // console.log(newResult);

        // Compare
        // const oldLines = oldResult.split('\n');
        // const newLines = newResult.split('\n');

        // Compare (comparing removed as there's only one formatter now)
        /*
        if (oldResult.trim() === newResult.trim()) {
            console.log('\n✓ IDENTICAL OUTPUT');
        } else {
            console.log('\n✗ OUTPUT DIFFERS');
            console.log(`  Old: ${oldLines.length} lines`);
            console.log(`  New: ${newLines.length} lines`);
        }
        */

    } catch (error) {
        console.log('ERROR:', error);
    }
}

console.log('\n' + '='.repeat(100));
console.log('TEST COMPLETE');
console.log('='.repeat(100));
