/**
 * Test for comment loss issue
 */

import { tokenizeCL, parseCL, extractCommentFromCommand } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

const config = {
    leftMargin: 14,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25
};

console.log("\n=== Testing Comment Preservation ===\n");

// Test 1: Short string with comment (user says this works)
const test1 = `CHGVAR VAR(&SHORTVAR) VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') /* Hello world */`;

console.log("Test 1 (short string): Working case");
console.log("Input:", test1);

const extracted1 = extractCommentFromCommand(test1);
console.log("Extracted command:", extracted1.command);
console.log("Extracted comment:", extracted1.comment);

const tokens1 = tokenizeCL(extracted1.command);
const ast1 = parseCL(tokens1, extracted1.comment);
const formatted1 = formatCLCommand_v2(ast1, undefined, config);

console.log("\nFormatted output:");
console.log(formatted1);
console.log("\nComment present?", formatted1.includes('/* Hello world */') ? '✓ YES' : '✗ NO');

// Test 2: Long string with spaces and comment (user says this fails)
const test2 = `CHGVAR VAR(&FROMFILE) VALUE('These are the times to remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. remember, cause they will not last forever. won''t although we''ll want to.') /* Hello world how is it going? */`;

console.log("\n\nTest 2 (long string): Failing case");
console.log("Input:", test2);

const extracted2 = extractCommentFromCommand(test2);
console.log("Extracted command:", extracted2.command);
console.log("Extracted comment:", extracted2.comment);

const tokens2 = tokenizeCL(extracted2.command);
const ast2 = parseCL(tokens2, extracted2.comment);
const formatted2 = formatCLCommand_v2(ast2, undefined, config);

console.log("\nFormatted output:");
console.log(formatted2);
console.log("\nComment present?", formatted2.includes('/* Hello world how is it going? */') ? '✓ YES' : '✗ NO');

// Test 3: Already formatted multi-line command (what happens when re-formatting?)
const test3Multiline = [
    `CHGVAR     VAR(&FROMFILE) VALUE('These are the times to +`,
    `                          remember, cause they will not last +`,
    `                          forever. remember, cause they will not +`,
    `                          last forever. remember, cause they will +`,
    `                          not last forever. remember, cause they +`,
    `                          will not last forever. won''t although +`,
    `                          we''ll want to.') /* Hello world how is it going? */`
].join('\n');

console.log("\n\nTest 3 (already formatted): What file formatter sees");
console.log("Input (multiline):");
console.log(test3Multiline);

// Simulate what collectCLCmdFromLine does: collapse multi-line to single line
const collapsed = test3Multiline
    .split('\n')
    .map(line => line.trim())
    .map(line => line.replace(/^\+/, '').trim())
    .map(line => line.replace(/\+$/, '').trim())
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

console.log("\nCollapsed to single line:", collapsed);

const extracted3 = extractCommentFromCommand(collapsed);
console.log("Extracted command:", extracted3.command);
console.log("Extracted comment:", extracted3.comment);

const tokens3 = tokenizeCL(extracted3.command);
const ast3 = parseCL(tokens3, extracted3.comment);
const formatted3 = formatCLCommand_v2(ast3, undefined, config);

console.log("\nRe-formatted output:");
console.log(formatted3);
console.log("\nComment present?", formatted3.includes('/* Hello world how is it going? */') ? '✓ YES' : '✗ NO');
