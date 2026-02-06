/**
 * Test formatter with real commands from testCLCommands.clle
 */

import { formatCL_SEU } from './tokenizeCL';
import { tokenizeCL, parseCL } from './tokenizeCL';

const testCases = [
    {
        name: "Simple CHGVAR",
        cmd: "CHGVAR VAR(&TOLIB) VALUE(&TOLIB *BCAT 'HELLO WORLD')"
    },
    {
        name: "CHGVAR with long string",
        cmd: "CHGVAR VAR(&FROMFILE) VALUE('These are the times to remember, cause they will not last forever.')"
    },
    {
        name: "Qualified name in expression",
        cmd: "CHGVAR VAR(&OBJNAME) VALUE(&OBJ / &NAME)"
    },
    {
        name: "DLTF with qualified name",
        cmd: "DLTF FILE(QTEMP/DDMTOFILE) SYSTEM(*FILETYPE)"
    },
    {
        name: "IF with expression",
        cmd: "IF COND(&TOFILE *EQ '*FROM' *OR &TOFILE = '*FROMFILE') THEN(DO)"
    },
    {
        name: "Complex CHGVAR with multiple operators",
        cmd: "CHGVAR VAR(&CPYSRC3) VALUE(&TOFILE *TCAT ') ' *BCAT 'FROMMBR(' *CAT 'FROMFILE(' *CAT &FROMLIB *TCAT '/' *CAT &FROMFILE *TCAT ')' *BCAT 'TOFILE(' *CAT &TOLIB *TCAT '/' *CAT &TOFILE *TCAT ') ' *BCAT 'FROMMBR(' *CAT &FROMMBR *TCAT ')' *BCAT 'TOMBR(' *CAT &TOMBR *TCAT ')')"
    }
];

console.log('='.repeat(80));
console.log('TESTING FORMATTER WITH REAL COMMANDS');
console.log('='.repeat(80));

for (const test of testCases) {
    console.log(`\n${'-'.repeat(80)}`);
    console.log(`Test: ${test.name}`);
    console.log(`Input: ${test.cmd.substring(0, 70)}...`);
    console.log('-'.repeat(80));

    try {
        const tokens = tokenizeCL(test.cmd);
        const node = parseCL(tokens);

        if (!node) {
            console.log('❌ FAILED TO PARSE');
            continue;
        }

        const formatted = formatCL_SEU(node);
        console.log('\nFormatted output:');
        console.log(formatted);

        // Analyze
        const lines = formatted.split('\n');
        console.log(`\nAnalysis:`);
        console.log(`  Lines: ${lines.length}`);

        lines.forEach((line, idx) => {
            const len = line.length;
            const maxLen = 70;
            const status = len <= maxLen ? '✓' : '❌';
            const hasSpaceBeforePlus = / \+$/.test(line);
            const spaceStatus = hasSpaceBeforePlus ? '❌ SPACE BEFORE +!' : '';

            console.log(`  Line ${idx + 1}: ${len} chars ${status} ${spaceStatus}`);
            if (len > maxLen) {
                console.log(`    EXCEEDS MARGIN by ${len - maxLen} chars`);
            }
        });

    } catch (error: any) {
        console.log(`❌ ERROR: ${error.message}`);
    }
}

console.log('\n' + '='.repeat(80));
console.log('TEST COMPLETE');
console.log('='.repeat(80));
