import { parseCLParms, extractParmMetas } from './parseCL';

// Manual test of the positional rewriting logic
// This simulates what rewriteLeadingPositionalsByList does

console.log('=== Simulating positional CALL command rewriting ===\n');

// When user types: CALL MYPGM &PARM1 &PARM2 &PARM3
// The positional rewriter should convert it to: CALL PGM(MYPGM) PARM(&PARM1 &PARM2 &PARM3)
// But currently it only converts: CALL PGM(MYPGM) PARM(&PARM1) &PARM2 &PARM3

const original = 'CALL MYPGM &PARM1 &PARM2 &PARM3';
console.log('Original:', original);

// What the rewriter currently does (based on code analysis):
// It finds first positional (MYPGM) -> converts to PGM(MYPGM)
// It finds second positional (&PARM1) -> converts to PARM(&PARM1)
// It stops at the first named parameter or after maxPos positionals
const currentRewritten = 'CALL PGM(MYPGM) PARM(&PARM1) &PARM2 &PARM3';
console.log('Current rewritten:', currentRewritten);
console.log('  Problem: &PARM2 and &PARM3 are left as trailing values\n');

// What we want:
// Since PARM has Max=255, we want all space-separated values to be captured
const desiredRewritten = 'CALL PGM(MYPGM) PARM(&PARM1 &PARM2 &PARM3)';
console.log('Desired rewritten:', desiredRewritten);
console.log('  Solution: Capture all remaining positionals for multi-instance PARM\n');

// Test with the current (incorrect) rewriting
const callXMLV7R4 = `<?xml version="1.0" encoding="UTF-8"?>
<QcdCLCmd DTDVersion="1.0" CmdPromptType="CL">
  <Cmd Cmd="CALL" CmdAlias="CL" CmdAbbrev="CALL" CmdMaxPos="2">
    <Parm Kwd="PGM" Prompt="Program" Type="QUAL" Min="1" Max="1" PosNbr="1">
      <Qual Type="NAME" Min="1" MaxLen="10" Prompt="Program name"/>
      <Qual Type="NAME" Min="0" MaxLen="10" Dft="*LIBL" SpcVal="((*LIBL) (*CURLIB))" Prompt="Library"/>
    </Parm>
    <Parm Kwd="PARM" Prompt="Parameters to pass" Type="ELEM" Min="0" Max="255" PosNbr="2">
      <Elem Type="CHAR" Prompt="Parameter value" Min="1" MaxLen="5000" ConstantValue="*NONE"/>
    </Parm>
  </Cmd>
</QcdCLCmd>`;

const parmMetas = extractParmMetas(callXMLV7R4);

console.log('=== Parsing WITH current (incorrect) rewriting ===');
const parsed1 = parseCLParms(currentRewritten, parmMetas);
console.log('Parsed:', JSON.stringify(parsed1, null, 2));
console.log('PARM length:', parsed1.PARM?.length, '(only 1 value captured)\n');

console.log('=== Parsing WITH desired (correct) rewriting ===');
const parsed2 = parseCLParms(desiredRewritten, parmMetas);
console.log('Parsed:', JSON.stringify(parsed2, null, 2));
console.log('PARM length:', parsed2.PARM?.length, '(all 3 values captured)\n');

console.log('CONCLUSION:');
console.log('  The parser works correctly when values are inside PARM()');
console.log('  The issue is in rewriteLeadingPositionalsByList');
console.log('  It needs to be updated to capture all positionals for multi-instance parameters');
