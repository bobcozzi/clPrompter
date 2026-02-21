import { parseCLParms, extractParmMetas } from './parseCL';

// Sample CALL command XML with V7R4+ PARM structure
const callXMLV7R4 = `<?xml version="1.0" encoding="UTF-8"?>
<QcdCLCmd DTDVersion="1.0" CmdPromptType="CL">
  <Cmd Cmd="CALL" CmdAlias="CL" CmdAbbrev="CALL" CmdMaxPos="1">
    <Parm Kwd="PGM" Prompt="Program" Type="QUAL" Min="1" Max="1" PosNbr="1">
      <Qual Type="NAME" Min="1" MaxLen="10" Prompt="Program name"/>
      <Qual Type="NAME" Min="0" MaxLen="10" Dft="*LIBL" SpcVal="((*LIBL) (*CURLIB))" Prompt="Library"/>
    </Parm>
    <Parm Kwd="PARM" Prompt="Parameters to pass" Type="ELEM" Min="0" Max="255">
      <Elem Type="CHAR" Prompt="Parameter value" Min="1" MaxLen="5000" ConstantValue="*NONE"/>
    </Parm>
  </Cmd>
</QcdCLCmd>`;

// Test case 1: CALL command with multiple PARM values
console.log('=== Test 1: CALL with multiple PARM values ===');
const cmdLine1 = 'CALL PGM(MYPGM) PARM(&PARM1 &PARM2 &PARM3 )';
const parmMetas1 = extractParmMetas(callXMLV7R4);
console.log('Parm Metas:', parmMetas1.map(m => ({
  Kwd: m.Kwd,
  Type: m.Type,
  Max: m.Max,
  hasElems: m.Elems?.length || 0
})));

const parsed1 = parseCLParms(cmdLine1, parmMetas1);
console.log('Parsed:', JSON.stringify(parsed1, null, 2));
console.log('PARM value:', parsed1.PARM);
console.log('PARM length:', parsed1.PARM?.length);

// Test case 2: CALL command with no space before closing paren
console.log('\n=== Test 2: CALL without trailing space ===');
const cmdLine2 = 'CALL PGM(MYPGM) PARM(&PARM1 &PARM2 &PARM3)';
const parsed2 = parseCLParms(cmdLine2, parmMetas1);
console.log('Parsed:', JSON.stringify(parsed2, null, 2));
console.log('PARM value:', parsed2.PARM);
console.log('PARM length:', parsed2.PARM?.length);

// Test case 3: CALL command with parenthesized instances (like old multi-instance format)
console.log('\n=== Test 3: CALL with parenthesized instances ===');
const cmdLine3 = 'CALL PGM(MYPGM) PARM((&PARM1) (&PARM2) (&PARM3))';
const parsed3 = parseCLParms(cmdLine3, parmMetas1);
console.log('Parsed:', JSON.stringify(parsed3, null, 2));
console.log('PARM value:', parsed3.PARM);
console.log('PARM length:', parsed3.PARM?.length);
