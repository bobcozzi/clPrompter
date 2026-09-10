import { isValidNameValue } from '../promptHelpers';

interface Case {
    label: string;
    value: string;
    maxLen?: number;
    nameType?: string;
    expected: boolean;
}

const cases: Case[] = [
    // *NAME (period and underscore allowed)
    { label: 'NAME accepts period/underscore', value: 'A987@.442#', nameType: 'NAME', expected: true },
    { label: 'NAME accepts ONE_NAME', value: 'ONE_NAME', nameType: 'NAME', expected: true },
    { label: 'NAME rejects leading digit', value: '1ABC', nameType: 'NAME', expected: false },

    // *SNAME (period not allowed, underscore allowed)
    { label: 'SNAME rejects period', value: 'AB.C', nameType: 'SNAME', expected: false },
    { label: 'SNAME accepts underscore', value: 'AB_C', nameType: 'SNAME', expected: true },

    // *CNAME (period and underscore not allowed)
    { label: 'CNAME rejects period', value: 'AB.C', nameType: 'CNAME', expected: false },
    { label: 'CNAME rejects underscore', value: 'AB_C', nameType: 'CNAME', expected: false },
    { label: 'CNAME accepts alnum/special lead chars', value: '$LIBX', nameType: 'CNAME', expected: true },

    // Quoted forms
    { label: 'NAME accepts simple quoted name', value: '"ABC"', nameType: 'NAME', expected: true },
    { label: 'NAME accepts quoted graphic name', value: '"AA%abc"', nameType: 'NAME', expected: true },
    { label: 'SNAME rejects quoted period', value: '"AB.C"', nameType: 'SNAME', expected: false },
    { label: 'CNAME rejects quoted underscore', value: '"AB_C"', nameType: 'CNAME', expected: false },
    { label: 'Quoted name rejects control chars', value: '"AB\u0001C"', nameType: 'NAME', expected: false },

    // Length handling
    { label: 'Default NAME max 10 (unquoted)', value: 'ABCDEFGHIJK', nameType: 'NAME', expected: false },
    { label: 'Default NAME max 10 (quoted unquoted-equivalent)', value: '"ABCDEFGHIJK"', nameType: 'NAME', expected: false },
    { label: 'Custom maxLen supports long names', value: 'ABCDEFGHIJK', maxLen: 256, nameType: 'NAME', expected: true },

    // Variables
    { label: 'Allows CL variable name', value: '&LIBNAME', nameType: 'NAME', expected: true },
    { label: 'Rejects invalid CL variable name', value: '&1BAD', nameType: 'NAME', expected: false }
];

let pass = 0;
let fail = 0;

for (const tc of cases) {
    const actual = isValidNameValue(tc.value, tc.maxLen, tc.nameType);
    const ok = actual === tc.expected;
    if (ok) {
        pass++;
        console.log(`PASS: ${tc.label}`);
    } else {
        fail++;
        console.error(
            `FAIL: ${tc.label} | value=${JSON.stringify(tc.value)} type=${tc.nameType ?? 'NAME'} maxLen=${tc.maxLen ?? 'default'} expected=${tc.expected} actual=${actual}`
        );
    }
}

console.log(`\nSummary: ${pass} passed, ${fail} failed`);

if (fail > 0) {
    process.exitCode = 1;
}
