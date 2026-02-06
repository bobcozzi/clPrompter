/**
 * Test for Issue #3: Nested command parens and comment preservation
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

console.log("\n=== Issue #3a: Nested Command Parens Lost ===\n");

const sbmjobInput = `SBMJOB CMD(DSPJOB JOB(063459/COZZI/THREADS) DUPJOBOPT(*MSG)) JOB(IBMIRD) PRTDEV(*USRPRF) /* what the heck? Over. */`;

console.log("Input:", sbmjobInput);

console.log("\n--- Comment Extraction ---");
const sbmjobExtracted = extractCommentFromCommand(sbmjobInput);
console.log("Command (no comment):", sbmjobExtracted.command);
console.log("Comment:", sbmjobExtracted.comment);

console.log("\n--- Tokenization ---");
const sbmjobTokens = tokenizeCL(sbmjobExtracted.command);
console.log("Tokens:", JSON.stringify(sbmjobTokens, null, 2));

console.log("\n--- Parsing ---");
const sbmjobParsed = parseCL(sbmjobTokens, sbmjobExtracted.comment);
console.log("Parsed:", JSON.stringify(sbmjobParsed, null, 2));

console.log("\n--- Formatting ---");
const sbmjobFormatted = formatCLCommand_v2(sbmjobParsed, undefined, config);
console.log("Formatted output:");
console.log(sbmjobFormatted);

console.log("\n=== Issue #3b: Comment Removed ===\n");

const chgvarInput = `CHGVAR VAR(&LONGVAR_FIELDNAME) VALUE('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx') /* Something, something something, dark size */`;

console.log("Input:", chgvarInput);

console.log("\n--- Comment Extraction ---");
const chgvarExtracted = extractCommentFromCommand(chgvarInput);
console.log("Command (no comment):", chgvarExtracted.command);
console.log("Comment:", chgvarExtracted.comment);

console.log("\n--- Tokenization ---");
const chgvarTokens = tokenizeCL(chgvarExtracted.command);
console.log("Tokens:", JSON.stringify(chgvarTokens, null, 2));

console.log("\n--- Parsing ---");
const chgvarParsed = parseCL(chgvarTokens, chgvarExtracted.comment);
console.log("Parsed:", JSON.stringify(chgvarParsed, null, 2));

console.log("\n--- Formatting ---");
const chgvarFormatted = formatCLCommand_v2(chgvarParsed, undefined, config);
console.log("Formatted output:");
console.log(chgvarFormatted);
