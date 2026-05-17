/**
 * Tests for Case=MIXED and Case=MONO attribute handling in buildCLCommand.
 *
 * Expected behaviour:
 *   Case=MIXED  — user-entered value is preserved as-is (quoted if needed to
 *                 prevent IBM i from uppercasing it).
 *   Case=MONO   — value is returned unquoted; IBM i uppercases it at runtime.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildCLCommand, extractAllowedValsAndTypes } from '../formatCL';
import { extractParmMetas } from '../parseCL';

// Load the test XML (contains SHOWME/NOSHOW with Case=MIXED, SHOWME2/NOSHOW2 with Case=MONO)
const xmlPath = path.join(__dirname, 'show_noShow_cmddefn.xml');
const xml = fs.readFileSync(xmlPath, 'utf8');

const parmMetas = extractParmMetas(xml);
const { allowedValsMap, parmTypeMap } = extractAllowedValsAndTypes(xml);

// ── helpers ──────────────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;

function check(label: string, actual: string, expected: string) {
    if (actual === expected) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.log(`  ✗ ${label}`);
        console.log(`      expected: ${expected}`);
        console.log(`      actual:   ${actual}`);
        fail++;
    }
}

// ── Case=MIXED tests ─────────────────────────────────────────────────────────

console.log('\n=== Case=MIXED (SHOWME / NOSHOW) ===\n');

// 1. Mixed-case user value must be quoted to preserve case
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME: 'MyValue' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME'])
    );
    check("SHOWME='MyValue'  → quoted", cmd, "SHOWHIDE SHOWME('MyValue')");
}

// 2. All-uppercase value for MIXED parm — returned unquoted (already all-uppercase;
//    quoting would add no value since IBM i cannot change it further)
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME: 'MYVALUE' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME'])
    );
    check("SHOWME='MYVALUE'  → unquoted (already uppercase)", cmd, "SHOWHIDE SHOWME(MYVALUE)");
}

// 3. All-lowercase value for MIXED parm — quoted
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME: 'myvalue' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME'])
    );
    check("SHOWME='myvalue'  → quoted", cmd, "SHOWHIDE SHOWME('myvalue')");
}

// 4. CL variable — never quoted regardless of Case
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME: '&myVar' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME'])
    );
    check("SHOWME='&myVar'   → unquoted variable", cmd, "SHOWHIDE SHOWME(&myVar)");
}

// 5. Special value starting with * — unquoted (step 3 in quoteIfNeeded)
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { NOSHOW: '*SAME' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['NOSHOW'])
    );
    check("NOSHOW='*SAME'    → unquoted special value", cmd, "SHOWHIDE NOSHOW(*SAME)");
}

// 6. Mixed-case value with embedded single quote — quoted and escaped
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME: "It's mixed" },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME'])
    );
    check("SHOWME with quote → escaped", cmd, "SHOWHIDE SHOWME('It''s mixed')");
}

// ── Case=MONO tests ──────────────────────────────────────────────────────────

console.log('\n=== Case=MONO (SHOWME2 / NOSHOW2) ===\n');

// 7. Mixed-case value for MONO parm — returned unquoted (IBM i will uppercase it)
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME2: 'MyValue' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME2'])
    );
    check("SHOWME2='MyValue' → unquoted (MONO)", cmd, "SHOWHIDE SHOWME2(MyValue)");
}

// 8. All-lowercase value for MONO parm — unquoted
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME2: 'myvalue' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME2'])
    );
    check("SHOWME2='myvalue' → unquoted (MONO)", cmd, "SHOWHIDE SHOWME2(myvalue)");
}

// 9. CL variable for MONO parm — unquoted
{
    const cmd = buildCLCommand(
        'SHOWHIDE',
        { SHOWME2: '&myVar' },
        {},
        allowedValsMap,
        parmTypeMap,
        parmMetas,
        new Set(['SHOWME2'])
    );
    check("SHOWME2='&myVar'  → unquoted variable (MONO)", cmd, "SHOWHIDE SHOWME2(&myVar)");
}

// ── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`Passed: ${pass} / ${pass + fail}`);
if (fail > 0) {
    console.log(`FAILED: ${fail} test(s)`);
    process.exit(1);
} else {
    console.log('All tests passed.');
}
