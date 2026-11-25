import * as assert from 'assert';
import { DOMParser } from '@xmldom/xmldom';
import { getMissingRequiredElemIndexes } from '../promptHelpers';

const parentSngValXml = `<QcdCLCmd><Cmd CmdName="ADDLIBLE">
  <Parm Kwd="POSITION" Type="ELEM" Min="0" Max="1">
    <SngVal><Value Val="*FIRST"/><Value Val="*LAST"/></SngVal>
    <Elem Type="CHAR" Min="1" Max="1"><SpcVal Val="*AFTER"/><SpcVal Val="*BEFORE"/><SpcVal Val="*REPLACE"/></Elem>
    <Elem Type="NAME" Min="1" Max="1"/>
  </Parm>
</Cmd></QcdCLCmd>`;

const elemSngValXml = `<QcdCLCmd><Cmd CmdName="TEST">
  <Parm Kwd="VALUES" Type="ELEM" Min="0" Max="1">
    <Elem Type="CHAR" Min="1" Max="1"><SngVal><Value Val="*ALL"/></SngVal></Elem>
    <Elem Type="NAME" Min="1" Max="1"/>
  </Parm>
</Cmd></QcdCLCmd>`;

function parseParm(xml: string): Element {
    return new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('Parm')[0] as unknown as Element;
}

const position = parseParm(parentSngValXml);
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, ['', '']), [], 'an untouched optional tuple stays optional');
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, ['*AFTER', '']), [1], '*AFTER requires the reference library');
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, ['*AFTER', 'QGPL']), [], 'a complete tuple is accepted');
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, ['*LAST', '']), [], 'a parent SNGVAL stands alone and bypasses later child Min');

const secondPositionInstance = ['', ''];
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, secondPositionInstance), [], 'an added tuple starts optional and blank');
secondPositionInstance[0] = '*AFTER';
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, secondPositionInstance), [1], 'an added tuple enforces its required second child after its first child is entered');
secondPositionInstance[0] = '*LAST';
assert.deepStrictEqual(getMissingRequiredElemIndexes(position, secondPositionInstance), [], 'a first-ELEM SNGVAL makes an added tuple complete by itself');

const values = parseParm(elemSngValXml);
assert.deepStrictEqual(getMissingRequiredElemIndexes(values, ['*ALL', '']), [], 'a first-ELEM SNGVAL also stands alone');

console.log('ELEM child Min validation tests passed');