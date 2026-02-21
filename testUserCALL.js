const { parseCLParms, extractParmMetas } = require('./out/parseCL');

// V7R4+ CALL command XML with ELEM PARM
const callXML = `<?xml version="1.0" encoding="UTF-8"?>
<QcdCLCmd DTDVersion="1.0" CmdPromptType="CL">
  <Cmd Cmd="CALL" CmdMaxPos="2">
    <Parm Kwd="PGM" Type="QUAL" Min="1" Max="1" PosNbr="1">
      <Qual Type="NAME" Min="1" MaxLen="10"/>
      <Qual Type="NAME" Min="0" MaxLen="10" Dft="*LIBL"/>
    </Parm>
    <Parm Kwd="PARM" Type="ELEM" Min="0" Max="255" PosNbr="2">
      <Elem Type="CHAR" Min="1" MaxLen="5000"/>
    </Parm>
  </Cmd>
</QcdCLCmd>`;

console.log('=== Testing User\'s Exact Command ===\n');

// User's exact command
const cmd = 'call PGMA PARM(&P1 &P2 &p3)';
console.log('Command:', cmd);

const metas = extractParmMetas(callXML);
console.log('\nPARM meta:');
const parmMeta = metas.find(m => m.Kwd === 'PARM');
console.log('  Type:', parmMeta.Type);
console.log('  Max:', parmMeta.Max);
console.log('  Elems:', parmMeta.Elems ? parmMeta.Elems.length : 0);

const parsed = parseCLParms(cmd, metas);
console.log('\nParsed result:');
console.log('  Keys:', Object.keys(parsed));
console.log('  PGM:', JSON.stringify(parsed.PGM));
console.log('  PARM:', JSON.stringify(parsed.PARM));
console.log('  PARM length:', parsed.PARM ? parsed.PARM.length : 0);

if (parsed.PARM && parsed.PARM.length === 3) {
  console.log('\n✓ SUCCESS: All 3 PARM instances parsed correctly');
  console.log('  Instance 0:', parsed.PARM[0]);
  console.log('  Instance 1:', parsed.PARM[1]);
  console.log('  Instance 2:', parsed.PARM[2]);
} else {
  console.log('\n✗ PROBLEM: Expected 3 PARM instances, got', parsed.PARM ? parsed.PARM.length : 0);
}

// Also test with parens around each
console.log('\n\n=== Testing With Parens Around Each Instance ===\n');
const cmd2 = 'call PGMA PARM((&P1) (&P2) (&p3))';
console.log('Command:', cmd2);
const parsed2 = parseCLParms(cmd2, metas);
console.log('PARM:', JSON.stringify(parsed2.PARM));
console.log('PARM length:', parsed2.PARM ? parsed2.PARM.length : 0);
