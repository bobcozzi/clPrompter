// Tests for DTD-coverage items: NbrTrueRel=ALL, CmpVal-less PmtCtlCond,
// RelKwd, RangeMinKwd/RangeMaxKwd, ChoicePgmValues consumption.
// Run with: npm run test:dtd-coverage
/// <reference types="node" />

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

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { buildAllMaps } from '../extractor';

function run(): void {
    // The .xml fixture is not copied to out/ — resolve it from src/test.
    const fixture = path.join(__dirname, '..', '..', 'src', 'test', 'dtdcoverage_cmddefn.xml');
    const xml = fs.readFileSync(fixture, 'utf8');
    const { allowedValsMap, depConstraints, pmtCtlMap } = buildAllMaps(xml);

    // --- P1.3: RelKwd → _RELKWD_ metadata on MAX ---
    const maxVals: string[] = allowedValsMap['MAX'] || [];
    assert.ok(
        maxVals.some(v => v === '_RELKWD_GE_MIN'),
        `MAX should carry _RELKWD_GE_MIN, got: ${JSON.stringify(maxVals)}`
    );

    // --- P1.3: RangeMinKwd/RangeMaxKwd → _RANGEMINKWD_/_RANGEMAXKWD_ on WITHIN ---
    const withinVals: string[] = allowedValsMap['WITHIN'] || [];
    assert.ok(
        withinVals.some(v => v === '_RANGEMINKWD_LOW'),
        `WITHIN should carry _RANGEMINKWD_LOW, got: ${JSON.stringify(withinVals)}`
    );
    assert.ok(
        withinVals.some(v => v === '_RANGEMAXKWD_HIGH'),
        `WITHIN should carry _RANGEMAXKWD_HIGH, got: ${JSON.stringify(withinVals)}`
    );

    // --- P2.7: ChoicePgmValues → static values surfaced on OBJ ---
    const objVals: string[] = allowedValsMap['OBJ'] || [];
    assert.ok(objVals.includes('QSYS'), `OBJ should include ChoicePgmValues QSYS, got: ${JSON.stringify(objVals)}`);
    assert.ok(objVals.includes('QGPL'), `OBJ should include ChoicePgmValues QGPL, got: ${JSON.stringify(objVals)}`);

    // --- P1.1: Dep with NbrTrueRel=ALL preserved ---
    const allDep = depConstraints.find(d => d.nbrTrueRel === 'ALL');
    assert.ok(allDep, 'should have a Dep constraint with nbrTrueRel=ALL');
    assert.strictEqual(allDep!.depParms.length, 2, 'ALL dep should have 2 DepParms');

    // --- P1.2: PmtCtlCond with no CmpVal (SPCFD) is kept ---
    const deponctlGroups = pmtCtlMap['DEPONCTL'];
    assert.ok(deponctlGroups, 'DEPONCTL should be in pmtCtlMap');
    assert.strictEqual(deponctlGroups.length, 1, 'DEPONCTL should have 1 PmtCtlGroup');
    assert.strictEqual(deponctlGroups[0].nbrTrueRel, 'ALL', 'DEPONCTL group nbrTrueRel should be ALL');
    const conds = deponctlGroups[0].conds;
    assert.ok(
        conds.some(c => c.rel === 'SPCFD' && c.cmpVal === undefined),
        `DEPONCTL should keep the CmpVal-less SPCFD cond, got: ${JSON.stringify(conds)}`
    );
    assert.ok(
        conds.some(c => c.rel === 'NE' && c.cmpVal === '0'),
        `DEPONCTL should keep the NE CmpVal=0 cond, got: ${JSON.stringify(conds)}`
    );

    console.log('testDtdCoverage: all assertions passed');
}

run();
