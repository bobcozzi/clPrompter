// This file can be used to diagnose issues with CALL command parsing
// To use this, add diagnostic logging to extension.ts to see what XML is actually being received

import { extractParmMetas } from './parseCL';

export function debugCALLCommandXML(xml: string): void {
  console.log('=== CALL Command XML Diagnostics ===');

  // Extract PARM parameter metas
  const metas = extractParmMetas(xml);
  const parmMeta = metas.find(m => m.Kwd === 'PARM');

  if (!parmMeta) {
    console.log('ERROR: PARM parameter not found in XML');
    return;
  }

  console.log('PARM parameter details:');
  console.log('  Kwd:', parmMeta.Kwd);
  console.log('  Type:', parmMeta.Type);
  console.log('  Max:', parmMeta.Max);
  console.log('  Has Elems:', parmMeta.Elems?.length || 0);
  console.log('  Has Quals:', parmMeta.Quals?.length || 0);

  if (parmMeta.Elems && parmMeta.Elems.length > 0) {
    console.log('  Child Elem[0]:');
    console.log('    Type:', parmMeta.Elems[0].Type);
    console.log('    MaxLen:', (parmMeta.Elems[0] as any).MaxLen);
  }

  // Check if Max > 1 (multi-instance)
  if (parmMeta.Max && parmMeta.Max > 1) {
    console.log('  ✓ PARM is multi-instance (Max > 1)');
    console.log('  ✓ Parser will split space-separated values into multiple instances');
  } else {
    console.log('  ✗ PARM is NOT multi-instance (Max =', parmMeta.Max, ')');
    console.log('  ✗ Parser will treat entire value as single instance');
    console.log('  ✗ This indicates V7R3 or earlier XML structure');
  }

  // Extract the raw PARM tag from XML
  const parmTagMatch = xml.match(/<Parm[^>]*\bKwd="PARM"[^>]*>/i);
  if (parmTagMatch) {
    console.log('\nRaw PARM tag from XML:');
    console.log(parmTagMatch[0]);
  }

  console.log('=== End Diagnostics ===\n');
}
