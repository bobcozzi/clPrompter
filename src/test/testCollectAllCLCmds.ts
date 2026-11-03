// Tests for collectAllCLCmds / stripCLLabel statement extraction.
// Run with: npm run test:collect-all-cl-cmds
/// <reference types="node" />
import * as vscode from 'vscode';

// Mock vscode before requiring modules that import it (tokenizeCL pulls in
// vscode for getEOL(), which is unavailable under plain node).
const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request: string) {
    if (request === 'vscode') {
        return {
            window: {},
            EndOfLine: { CRLF: 2, LF: 1 }
        };
    }
    return originalLoad.apply(this, arguments as any);
};

import { collectAllCLCmds, stripCLLabel, extractGotoTargetLabel, findCLLabelLine } from '../extractor';

function mockDoc(source: string): vscode.TextDocument {
    const lines = source.split('\n');
    return {
        lineCount: lines.length,
        lineAt: (idx: number) => ({ text: lines[idx] })
    } as vscode.TextDocument;
}

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (!ok) {
        failures++;
        console.log(`  expected: ${JSON.stringify(expected)}`);
        console.log(`  actual:   ${JSON.stringify(actual)}`);
    }
}

// 1. Single-line commands separated by blank lines
{
    const doc = mockDoc(`CPYF FROMFILE(A) TOFILE(B)\n\nDSPLIBL\n   DSPJOB`);
    const statements = collectAllCLCmds(doc);
    check('single-line commands', statements.map((s) => s.command), ['CPYF FROMFILE(A) TOFILE(B)', 'DSPLIBL', 'DSPJOB']);
}

// 2. '+' continuation joins and trims next line
{
    const doc = mockDoc(`CPYF FROMFILE(QGPL/LONGFILE-+
          NAME) TOFILE(*PRINT)`);
    const statements = collectAllCLCmds(doc);
    check('+ continuation', statements.map((s) => s.command), ['CPYF FROMFILE(QGPL/LONGFILE-NAME) TOFILE(*PRINT)']);
    check('+ continuation line span', [statements[0].startLine, statements[0].endLine], [0, 1]);
}

// 3. '-' continuation joins without trimming
{
    const doc = mockDoc(`CHGVAR VAR(&X) VALUE('abc'-\n   'def')`);
    const statements = collectAllCLCmds(doc);
    check('- continuation', statements.map((s) => s.command), [`CHGVAR VAR(&X) VALUE('abc' 'def')`]);
}

// 4. Comment-only lines are skipped
{
    const doc = mockDoc(`/* header comment */\n\n/* multi\n   line comment */\nCPYF FROMFILE(A) TOFILE(B)`);
    const statements = collectAllCLCmds(doc);
    check('comment-only lines skipped', statements.map((s) => s.command), ['CPYF FROMFILE(A) TOFILE(B)']);
}

// 5. Trailing comments are not part of the command
{
    const doc = mockDoc(`CPYF FROMFILE(A) TOFILE(B) /* copy it */\nDSPLIBL`);
    const statements = collectAllCLCmds(doc);
    check('trailing comment excluded', statements.map((s) => s.command), ['CPYF FROMFILE(A) TOFILE(B)', 'DSPLIBL']);
}

// 6. Labels are stripped from runnable statements
{
    const doc = mockDoc(`LOOP: CPYF FROMFILE(A) TOFILE(B)\nTOP: DSPLIBL`);
    const statements = collectAllCLCmds(doc);
    check('labels stripped', statements.map((s) => s.command), ['CPYF FROMFILE(A) TOFILE(B)', 'DSPLIBL']);
}

// 7. Quoted strings containing ':' or '/*' are not treated as labels/comments
{
    const doc = mockDoc(`CHGVAR VAR(&X) VALUE('http://x/*y*/')\nSNDMSG MSG('a: b') TOUSR(QSYSOPR)`);
    const statements = collectAllCLCmds(doc);
    check('quoted colon/comment text preserved', statements.map((s) => s.command), [`CHGVAR VAR(&X) VALUE('http://x/*y*/')`, `SNDMSG MSG('a: b') TOUSR(QSYSOPR)`]);
}

// 8. stripCLLabel edge cases
check('stripCLLabel simple', stripCLLabel('END: CALL PGM(X)'), 'CALL PGM(X)');
check('stripCLLabel no label', stripCLLabel('CALL PGM(X)'), 'CALL PGM(X)');
check('stripCLLabel colon in quote not a label', stripCLLabel(`SNDMSG MSG('a:b') TOUSR(QSYSOPR)`), `SNDMSG MSG('a:b') TOUSR(QSYSOPR)`);

// 9. Empty source yields nothing
check('empty source', collectAllCLCmds(mockDoc('\n\n   \n')), []);

// 10. Range restriction honors startLine/endLine
{
    const doc = mockDoc(`CPYF FROMFILE(A) TOFILE(B)\nDSPLIBL\nDSPJOB`);
    const statements = collectAllCLCmds(doc, 1, 2);
    check('range restricted', statements.map((s) => s.command), ['DSPLIBL', 'DSPJOB']);
}

// 11. GOTO target extraction (positional and CMDLBL keyword)
check('GOTO positional', extractGotoTargetLabel('GOTO READNEXT'), 'READNEXT');
check('GOTO CMDLBL keyword', extractGotoTargetLabel('GOTO CMDLBL(READNEXT)'), 'READNEXT');
check('GOTO CMDLBL keyword spaced', extractGotoTargetLabel('GOTO  CMDLBL( END )'), 'END');
check('GOTO no target', extractGotoTargetLabel('GOTO'), undefined);
check('GOTO lowercase', extractGotoTargetLabel('goto readnext'), 'readnext');
check('GOTO keyword then extra parm', extractGotoTargetLabel('GOTO CMDLBL(READNEXT) PARM(X)'), 'READNEXT');
check('GOTO positional with extra junk falls back to first positional', extractGotoTargetLabel('GOTO READNEXT EXTRA'), 'READNEXT');
check('non-GOTO command yields no target', extractGotoTargetLabel('CPYF FROMFILE(A) TOFILE(B)'), undefined);
// Labels are never quoted; a quoted value is not a label target.
check('GOTO quoted value is not a label', extractGotoTargetLabel("GOTO CMDLBL('MY LABEL')"), "'MY LABEL'");

// 12. findCLLabelLine finds the label line, case-insensitive, ignoring comments
{
    const doc = mockDoc(`PGM\nREADNEXT: CPYF FROMFILE(A) TOFILE(B)\n/* END: done */\nEND: ENDPGM`);
    check('label found', findCLLabelLine(doc, 'readnext'), 1);
    check('label not in comment', findCLLabelLine(doc, 'end'), 3);
    check('label missing', findCLLabelLine(doc, 'NOPE'), undefined);
}

// 13. GOTO target after continuation collapse (GOTO +\n CMDLBL(...))
{
    const doc = mockDoc(`GOTO +\n  CMDLBL(READNEXT)`);
    const statements = collectAllCLCmds(doc);
    check('GOTO continuation collapses to one statement', statements.length, 1);
    check('GOTO continuation target', extractGotoTargetLabel(statements[0].command), 'READNEXT');
}

// 14. GOTO label matrix: labeled statements, continuations, keyword/positional.
// Each input line is collected (labels stripped) and its GOTO target resolved.
{
    const cases: Array<{ source: string; expected: string | undefined }> = [
        { source: 'LABEL1: GOTO LABEL2', expected: 'LABEL2' },
        { source: 'GOTO LABEL3', expected: 'LABEL3' },
        { source: 'GOTO CMDLBL(LABEL4)', expected: 'LABEL4' },
        { source: 'GOTO +\n   LABEL5', expected: 'LABEL5' },
        { source: 'GOTO +\n  CMDLBL(label6)', expected: 'label6' },
        { source: 'LABEL7: GOTO +\n   CMDLBL(label8)', expected: 'label8' }
    ];
    for (const { source, expected } of cases) {
        const statements = collectAllCLCmds(mockDoc(source));
        const actual = statements.length > 0 ? extractGotoTargetLabel(statements[0].command) : undefined;
        check(`GOTO target: ${source.split('\n')[0]}`, actual, expected);
    }
}

// 15. MONMSG EXEC(GOTO ...) nested command unwrapping
{
    const nested: Array<{ source: string; expected: string | undefined }> = [
        { source: 'MONMSG MSGID(CPF0000) EXEC(GOTO ENDPGM)', expected: 'ENDPGM' },
        { source: 'MONMSG MSGID(CPF0000 CPF9999) EXEC(GOTO CMDLBL(CLEANUP))', expected: 'CLEANUP' },
        { source: 'MONMSG +\n   MSGID(CPF0000) +\n   EXEC(GOTO ERROR)', expected: 'ERROR' },
        // Plain MONMSG without EXEC, or EXEC that is not a GOTO, resolve to nothing.
        { source: 'MONMSG MSGID(CPF0000)', expected: undefined },
        { source: 'MONMSG MSGID(CPF0000) EXEC(CALL PGM(X))', expected: undefined }
    ];
    for (const { source, expected } of nested) {
        const statements = collectAllCLCmds(mockDoc(source));
        const actual = statements.length > 0 ? extractGotoTargetLabel(statements[0].command) : undefined;
        check(`MONMSG EXEC(GOTO): ${source.split('\n')[0]}`, actual, expected);
    }
}

console.log(failures === 0 ? '\nAll collectAllCLCmds tests passed.' : `\n${failures} test(s) FAILED.`);
if (failures > 0) {
    process.exit(1);
}
