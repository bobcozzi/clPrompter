import * as assert from 'assert';
import { DOMParser } from '@xmldom/xmldom';
import { isInternalConstantElemShellParm } from '../promptHelpers';

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<QcdCLCmd DTDVersion="2.0">
  <Cmd CmdName="TESTCMD" CmdLib="QSYS">
    <Parm Kwd="HIDDEN1" Type="ELEM" Min="0">
      <Elem Type="CHAR" Min="0" Len="1" Constant="X"></Elem>
      <Elem Type="CHAR" Min="0" Len="1" Constant="Y"></Elem>
    </Parm>

    <Parm Kwd="HASPOS" Type="ELEM" Min="0" PosNbr="5">
      <Elem Type="CHAR" Min="0" Len="1" Constant="X"></Elem>
    </Parm>

    <Parm Kwd="HASPROMPT" Type="ELEM" Min="0" Prompt="Visible parm">
      <Elem Type="CHAR" Min="0" Len="1" Constant="X"></Elem>
    </Parm>

    <Parm Kwd="NOCONST" Type="ELEM" Min="0">
      <Elem Type="CHAR" Min="0" Len="1"></Elem>
    </Parm>

    <Parm Kwd="ELEMPROMPT" Type="ELEM" Min="0">
      <Elem Type="CHAR" Min="0" Len="1" Constant="X" Prompt="Element prompt"></Elem>
    </Parm>

    <Parm Kwd="NESTED" Type="ELEM" Min="0">
      <Elem Type="ELEM" Min="0" Constant="X">
        <Elem Type="CHAR" Min="0" Len="1" Constant="Z"></Elem>
      </Elem>
    </Parm>

    <Parm Kwd="NOTELEM" Type="CHAR" Min="0">
      <SngVal><Value Val="*YES"/></SngVal>
    </Parm>
  </Cmd>
</QcdCLCmd>`;

const doc = new DOMParser().parseFromString(xml, 'text/xml');
const parmNodes = Array.from(doc.getElementsByTagName('Parm'));

const byKwd = new Map<string, Element>();
parmNodes.forEach((parm) => {
    const domParm = parm as unknown as Element;
    const kwd = domParm.getAttribute('Kwd') || '';
    if (kwd) byKwd.set(kwd, domParm);
});

assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('HIDDEN1') || null), true, 'constant-only ELEM shell should be hidden');
assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('HASPOS') || null), false, 'PosNbr means promptable, do not hide');
assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('HASPROMPT') || null), false, 'Prompt means user-facing, do not hide');
assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('NOCONST') || null), false, 'non-constant ELEM should not be hidden');
assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('ELEMPROMPT') || null), false, 'prompted ELEM child should not be hidden');
assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('NESTED') || null), false, 'nested ELEM structure should not be hidden');
assert.strictEqual(isInternalConstantElemShellParm(byKwd.get('NOTELEM') || null), false, 'non-ELEM parm should not be hidden');

console.log('Hidden constant ELEM shell rule tests passed');
