/**
 * Simple test of key commands from testCLCommands.clle
 * Tests the two known issues:
 * 1. Long text strings not being wrapped properly
 * 2. Right paren being dropped when continuation occurs
 */

import { tokenizeCL, parseCL } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

const config = {
    leftMargin: 14,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25
};

interface TestCase {
    name: string;
    label?: string;
    input: string;
    expected: string;
}

const testCases: TestCase[] = [
    {
        name: "Long string VALUE - Issue #1",
        label: undefined,
        input: "CHGVAR VAR(&SHORTVAR) VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')",
        expected: `             CHGVAR     VAR(&SHORTVAR) +
                          VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx+
                          xxxxxxxxxxxxxxxxxxxxxxxxxx')`
    },
    {
        name: "Long string with spaces - Issue #1",
        label: undefined,
        input: "CHGVAR VAR(&FROMFILE) VALUE('These are the times to remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. won''t although we''ll want to.')",
        expected: `             CHGVAR     VAR(&FROMFILE) VALUE('These are the times to +
                          remember, cause they will not last +
                          forever. remember, cause they will not +
                          last forever. remember, cause they will +
                          not last forever. remember, cause they +
                          will not last forever. won''t although +
                          we''ll want to.') /* Hello world */`
    },
    {
        name: "CHGJOB with multiple params - Issue #2",
        label: "CHANGJOB",
        input: "CHGJOB JOB(400400/COZZI/DSP01) JOBPTY(3) OUTQ(*USRPRF) LOG(4 0 *SECLVL) DDMCNV(*KEEP) SCDDATE(*MONTHSTR) SCDTIME(*CURRENT) DATFMT(*YMD) DFTWAIT(*NOMAX)",
        expected: ` CHANGJOB:   CHGJOB     JOB(400400/COZZI/DSP01) JOBPTY(3) +
                          OUTQ(*USRPRF) LOG(4 0 *SECLVL) +
                          DDMCNV(*KEEP) SCDDATE(*MONTHSTR) +
                          SCDTIME(*CURRENT) DATFMT(*YMD) +
                          DFTWAIT(*NOMAX)`
    },
    {
        name: "IF with long condition",
        label: undefined,
        input: "IF COND(&TOFILE *EQ '*FROM' *OR &TOFILE = '*FROMFILE') THEN(DO)",
        expected: `             IF         COND(&TOFILE *EQ '*FROM' *OR &TOFILE = +
                          '*FROMFILE') THEN(DO)`
    },
    {
        name: "RUNIQRY with nested params - Issue #2",
        label: "IQUERY",
        input: "RUNIQRY SQL('select * from qiws.qcustcdt') OUTPUT(*PRINT) EXTRA((*BEFORE 'Something something something, dark side.') (*AFTER 'The force awakens in this one.')) EMAIL('cozzi@rpgiv.com' 'jason@aidltd.com')",
        expected: ` IQUERY:     RUNIQRY    SQL('select * from qiws.qcustcdt') +
                          OUTPUT(*PRINT) EXTRA((*BEFORE 'Something +
                          something something, dark side.') (*AFTER +
                          'The force awakens in this one.')) +
                          EMAIL('cozzi@rpgiv.com' +
                          'jason@aidltd.com')`
    }
];

console.log('='.repeat(80));
console.log('SIMPLE FORMATTER TEST - Known Issues');
console.log('='.repeat(80));

let passCount = 0;
let failCount = 0;

for (const test of testCases) {
    console.log('\n' + '-'.repeat(80));
    console.log(`Test: ${test.name}`);
    console.log('-'.repeat(80));

    try {
        const tokens = tokenizeCL(test.input);
        const node = parseCL(tokens);

        if (!node) {
            console.log('❌ PARSE FAILED');
            failCount++;
            continue;
        }

        const formatted = formatCLCommand_v2(node, test.label, config);

        console.log('\nInput (collapsed):');
        console.log(test.input.substring(0, 70) + '...');

        console.log('\nExpected output:');
        console.log(test.expected);

        console.log('\nActual output:');
        console.log(formatted);

        // Compare line by line
        const expectedLines = test.expected.split('\n');
        const actualLines = formatted.split('\n');

        let hasIssues = false;
        const issues: string[] = [];

        if (expectedLines.length !== actualLines.length) {
            issues.push(`Line count: expected ${expectedLines.length}, got ${actualLines.length}`);
            hasIssues = true;
        }

        const maxLines = Math.max(expectedLines.length, actualLines.length);
        for (let i = 0; i < maxLines; i++) {
            const expLine = expectedLines[i] || '';
            const actLine = actualLines[i] || '';

            if (expLine.trimEnd() !== actLine.trimEnd()) {
                hasIssues = true;
                issues.push(`Line ${i + 1} differs`);

                // Check for known issues
                if (actLine.includes(' +') && actLine.match(/ \+$/)) {
                    issues.push(`  ⚠️  Has space before + (should be no space)`);
                }

                // Check for missing closing paren
                const expParens = (expLine.match(/\)/g) || []).length;
                const actParens = (actLine.match(/\)/g) || []).length;
                if (expParens > actParens) {
                    issues.push(`  🔴 ISSUE #2: Missing closing paren! Expected ${expParens}, got ${actParens}`);
                }

                // Check for string wrapping
                if (expLine.includes("'") && actLine.includes("'")) {
                    const expHasCont = expLine.match(/'+\s*$/);
                    const actHasCont = actLine.match(/'+\s*$/);
                    if (expHasCont && !actHasCont) {
                        issues.push(`  🔴 ISSUE #1: String not continuing properly`);
                    }
                }
            }
        }

        if (hasIssues) {
            console.log('\n❌ DIFFERENCES FOUND:');
            issues.forEach(issue => console.log(`  ${issue}`));
            failCount++;
        } else {
            console.log('\n✅ PASS - Output matches expected');
            passCount++;
        }

    } catch (error: any) {
        console.log(`\n❌ ERROR: ${error.message}`);
        console.log(error.stack);
        failCount++;
    }
}

console.log('\n' + '='.repeat(80));
console.log('RESULTS');
console.log('='.repeat(80));
console.log(`Passed: ${passCount}/${testCases.length}`);
console.log(`Failed: ${failCount}/${testCases.length}`);
console.log('='.repeat(80));
