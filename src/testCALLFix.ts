import { parseCLParms, extractParmMetas } from './parseCL';
import { rewriteLeadingPositionalsByList } from './tokenizeCL';

// Sample CALL command XML with V7R4+ PARM structure
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

console.log('=== Testing Fixed Positional CALL Command ===\n');

// Test case 1: Basic positional with multiple PARM values
console.log('Test 1: CALL MYPGM &PARM1 &PARM2 &PARM3');
const cmdLine1 = 'CALL MYPGM &PARM1 &PARM2 &PARM3';
const parmMetas = extractParmMetas(callXMLV7R4);
const posOrder = ['PGM', 'PARM'];
const maxPos = 2;

const rewritten1 = rewriteLeadingPositionalsByList(cmdLine1, posOrder, maxPos);
console.log('  Rewritten:', rewritten1);

const parsed1 = parseCLParms(rewritten1, parmMetas);
console.log('  Parsed PARM:', parsed1.PARM);
console.log('  PARM count:', parsed1.PARM?.length);
console.log(parsed1.PARM?.length === 3 ? '  ✓ SUCCESS: All 3 parameters captured\n' : '  ✗ FAILED\n');

// Test case 2: Single PARM value (should still work)
console.log('Test 2: CALL MYPGM &PARM1');
const cmdLine2 = 'CALL MYPGM &PARM1';
const rewritten2 = rewriteLeadingPositionalsByList(cmdLine2, posOrder, maxPos);
console.log('  Rewritten:', rewritten2);
const parsed2 = parseCLParms(rewritten2, parmMetas);
console.log('  Parsed PARM:', parsed2.PARM);
console.log('  PARM count:', parsed2.PARM?.length);
console.log(parsed2.PARM?.length === 1 ? '  ✓ SUCCESS: Single parameter captured\n' : '  ✗ FAILED\n');

// Test case 3: Many PARM values
console.log('Test 3: CALL MYPGM &P1 &P2 &P3 &P4 &P5');
const cmdLine3 = 'CALL MYPGM &P1 &P2 &P3 &P4 &P5';
const rewritten3 = rewriteLeadingPositionalsByList(cmdLine3, posOrder, maxPos);
console.log('  Rewritten:', rewritten3);
const parsed3 = parseCLParms(rewritten3, parmMetas);
console.log('  Parsed PARM:', parsed3.PARM);
console.log('  PARM count:', parsed3.PARM?.length);
console.log(parsed3.PARM?.length === 5 ? '  ✓ SUCCESS: All 5 parameters captured\n' : '  ✗ FAILED\n');

// Test case 4: With library qualification
console.log('Test 4: CALL MYLIB/MYPGM &PARM1 &PARM2');
const cmdLine4 = 'CALL MYLIB/MYPGM &PARM1 &PARM2';
const rewritten4 = rewriteLeadingPositionalsByList(cmdLine4, posOrder, maxPos);
console.log('  Rewritten:', rewritten4);
const parsed4 = parseCLParms(rewritten4, parmMetas);
console.log('  Parsed PGM:', parsed4.PGM);
console.log('  Parsed PARM:', parsed4.PARM);
console.log('  PARM count:', parsed4.PARM?.length);
console.log(parsed4.PARM?.length === 2 ? '  ✓ SUCCESS: Qualified library handled correctly\n' : '  ✗ FAILED\n');

// Test case 5: Already in keyword format (should not be affected)
console.log('Test 5: CALL PGM(MYPGM) PARM(&PARM1 &PARM2)');
const cmdLine5 = 'CALL PGM(MYPGM) PARM(&PARM1 &PARM2)';
const rewritten5 = rewriteLeadingPositionalsByList(cmdLine5, posOrder, maxPos);
console.log('  Rewritten:', rewritten5);
const parsed5 = parseCLParms(rewritten5, parmMetas);
console.log('  Parsed PARM:', parsed5.PARM);
console.log('  PARM count:', parsed5.PARM?.length);
console.log(parsed5.PARM?.length === 2 ? '  ✓ SUCCESS: Keyword format preserved\n' : '  ✗ FAILED\n');
