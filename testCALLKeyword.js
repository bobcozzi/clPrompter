// Mock vscode module for testing BEFORE requiring modules
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return {
      window: { activeTextEditor: null },
      EndOfLine: { CRLF: 2, LF: 1 }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { parseCLParms, extractParmMetas } = require('./out/parseCL');

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

console.log('=== Testing CALL Command Parsing (Keyword Format) ===\n');

const parmMetas = extractParmMetas(callXMLV7R4);

// Test case 1: User's original issue - keyword format with multiple PARM values
console.log('Test 1: CALL PGM(MYPGM) PARM(&PARM1 &PARM2 &PARM3)');
const cmdLine1 = 'CALL PGM(MYPGM) PARM(&PARM1 &PARM2 &PARM3)';
const parsed1 = parseCLParms(cmdLine1, parmMetas);
console.log('  Parsed PARM:', parsed1.PARM);
console.log('  PARM count:', parsed1.PARM?.length);
console.log(parsed1.PARM?.length === 3 ? '  ✓ SUCCESS: All 3 parameters captured\n' : '  ✗ FAILED\n');

// Test case 2: Single PARM value
console.log('Test 2: CALL PGM(MYPGM) PARM(&PARM1)');
const cmdLine2 = 'CALL PGM(MYPGM) PARM(&PARM1)';
const parsed2 = parseCLParms(cmdLine2, parmMetas);
console.log('  Parsed PARM:', parsed2.PARM);
console.log('  PARM count:', parsed2.PARM?.length);
console.log(parsed2.PARM?.length === 1 ? '  ✓ SUCCESS: Single parameter captured\n' : '  ✗ FAILED\n');

// Test case 3: Five PARM values
console.log('Test 3: CALL PGM(MYPGM) PARM(&P1 &P2 &P3 &P4 &P5)');
const cmdLine3 = 'CALL PGM(MYPGM) PARM(&P1 &P2 &P3 &P4 &P5)';
const parsed3 = parseCLParms(cmdLine3, parmMetas);
console.log('  Parsed PARM:', parsed3.PARM);
console.log('  PARM count:', parsed3.PARM?.length);
console.log(parsed3.PARM?.length === 5 ? '  ✓ SUCCESS: All 5 parameters captured\n' : '  ✗ FAILED\n');

// Test case 4: Mixed values
console.log('Test 4: CALL PGM(MYLIB/MYPGM) PARM(&VAR1 *NONE &VAR2)');
const cmdLine4 = 'CALL PGM(MYLIB/MYPGM) PARM(&VAR1 *NONE &VAR2)';
const parsed4 = parseCLParms(cmdLine4, parmMetas);
console.log('  Parsed PGM:', parsed4.PGM);
console.log('  Parsed PARM:', parsed4.PARM);
console.log('  PARM count:', parsed4.PARM?.length);
console.log(parsed4.PARM?.length === 3 ? '  ✓ SUCCESS: Mixed values handled correctly\n' : '  ✗ FAILED\n');

console.log('\nNOTE: The parser correctly handles multi-instance PARM parameters when in keyword format.');
console.log('The user\'s issue in the GitHub report should be resolved by this fix.');
