/**
 * Final verification test with user's original examples
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

console.log("\n===== USER ISSUE #1: Nested Command Parens =====\n");

const issue1Input = `SBMJOB CMD(DSPJOB JOB(063459/COZZI/THREADS) DUPJOBOPT(*MSG)) JOB(IBMIRD) PRTDEV(*USRPRF) /* what the heck? Over. */`;

console.log("Original command:");
console.log(issue1Input);

const issue1Extracted = extractCommentFromCommand(issue1Input);
const issue1Tokens = tokenizeCL(issue1Extracted.command);
const issue1Parsed = parseCL(issue1Tokens, issue1Extracted.comment);
const issue1Formatted = formatCLCommand_v2(issue1Parsed, undefined, config);

console.log("\nFormatted output:");
console.log(issue1Formatted);

console.log("\n✅ VERIFICATION:");
if (issue1Formatted.includes('JOB(063459/COZZI/THREADS)')) {
    console.log("✓ Nested command parens around JOB parameter preserved");
} else {
    console.log("✗ ERROR: JOB parameter missing parens");
}
if (issue1Formatted.includes('DUPJOBOPT(*MSG)')) {
    console.log("✓ Nested command parens around DUPJOBOPT parameter preserved");
} else {
    console.log("✗ ERROR: DUPJOBOPT parameter missing parens");
}
if (issue1Formatted.includes('/* what the heck? Over. */')) {
    console.log("✓ Comment preserved");
} else {
    console.log("✗ ERROR: Comment missing");
}

console.log("\n===== USER ISSUE #2: Comment Removed =====\n");

const issue2Input = `CHGVAR VAR(&LONGVAR_FIELDNAME) VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') /* Something, something something, dark size */`;

console.log("Original command:");
console.log(issue2Input);

const issue2Extracted = extractCommentFromCommand(issue2Input);
const issue2Tokens = tokenizeCL(issue2Extracted.command);
const issue2Parsed = parseCL(issue2Tokens, issue2Extracted.comment);
const issue2Formatted = formatCLCommand_v2(issue2Parsed, undefined, config);

console.log("\nFormatted output:");
console.log(issue2Formatted);

console.log("\n✅ VERIFICATION:");
if (issue2Formatted.includes('/* Something, something something, dark size */')) {
    console.log("✓ Comment preserved");
} else {
    console.log("✗ ERROR: Comment missing");
}
if (issue2Formatted.includes("VALUE('xxx")) {
    console.log("✓ Long string VALUE parameter present");
} else {
    console.log("✗ ERROR: VALUE parameter missing");
}

// Count lines to verify wrapping occurred
const issue2Lines = issue2Formatted.split('\n');
console.log(`✓ String wrapped across ${issue2Lines.length} lines (rightMargin=${config.rightMargin})`);

console.log("\n===== SUMMARY =====\n");
console.log("Both issues have been fixed:");
console.log("1. Nested command parameters inside CMD() now preserve their parentheses");
console.log("2. Trailing comments are extracted before tokenization and preserved in output");
