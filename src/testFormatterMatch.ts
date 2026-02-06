/**
 * Test if formatter output matches the IBM i formatted commands in testCLCommands.clle
 * This verifies that our formatter replicates IBM i CL prompter behavior
 */

import * as fs from 'fs';
import * as path from 'path';
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

// Read the test file
const testFilePath = path.join(__dirname, '..', 'src', 'testCLCommands.clle');
const content = fs.readFileSync(testFilePath, 'utf-8');
const lines = content.split('\n');

interface CommandBlock {
    label?: string;
    originalFormatted: string;  // Multi-line formatted version from file
    logicalCommand: string;     // Single-line logical command
    startLine: number;
    endLine: number;
}

/**
 * Extract commands with their original formatting preserved
 */
function extractCommandBlocks(): CommandBlock[] {
    const blocks: CommandBlock[] = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Skip empty lines and standalone comments
        if (!line.trim() || (line.trim().startsWith('/*') && !line.includes('+'))) {
            i++;
            continue;
        }

        let label: string | undefined;
        let startLine = i;
        let originalLines: string[] = [];
        let logicalParts: string[] = [];

        // Check for label
        const labelMatch = line.match(/^\s*(\w+):\s+/);
        if (labelMatch) {
            label = labelMatch[1];
        }

        // Collect all lines for this command (including continuations)
        let currentLine = line;
        originalLines.push(currentLine);

        // Extract logical part (remove label, continuations, extra spaces)
        let logicalPart = currentLine.trim();
        if (labelMatch) {
            logicalPart = currentLine.substring(labelMatch[0].length).trim();
        }

        // Remove trailing + and accumulate logical command
        if (logicalPart.endsWith('+')) {
            logicalPart = logicalPart.substring(0, logicalPart.length - 1).trim();
        }
        logicalParts.push(logicalPart);

        // Check for continuation
        let hasContinuation = currentLine.trim().endsWith('+');

        while (hasContinuation && i + 1 < lines.length) {
            i++;
            currentLine = lines[i];
            originalLines.push(currentLine);

            let contPart = currentLine.trim();
            // Remove leading +
            if (contPart.startsWith('+')) {
                contPart = contPart.substring(1).trim();
            }

            hasContinuation = contPart.endsWith('+');

            // Remove trailing +
            if (hasContinuation) {
                contPart = contPart.substring(0, contPart.length - 1).trim();
            }

            logicalParts.push(contPart);
        }

        // Join logical parts into single-line command
        const logicalCommand = logicalParts.join(' ');
        const originalFormatted = originalLines.join('\n');

        blocks.push({
            label,
            originalFormatted,
            logicalCommand,
            startLine: startLine + 1,
            endLine: i + 1
        });

        i++;
    }

    return blocks;
}

console.log("Comparing formatter output with IBM i formatted commands\n");
console.log("=".repeat(70));

const blocks = extractCommandBlocks();
let perfectMatches = 0;
let minorDiffs = 0;
let majorDiffs = 0;

blocks.forEach((block, idx) => {
    const { label, originalFormatted, logicalCommand, startLine } = block;

    try {
        // Extract comment from logical command
        const extracted = extractCommentFromCommand(logicalCommand);

        // Tokenize and parse
        const tokens = tokenizeCL(extracted.command);
        const ast = parseCL(tokens, extracted.comment);

        // Format with our formatter
        const ourOutput = formatCLCommand_v2(ast, label, config);

        // Compare line by line
        const originalLines = originalFormatted.split('\n');
        const ourLines = ourOutput.split('\n');

        if (ourOutput === originalFormatted) {
            console.log(`\n✓ Test ${idx + 1} (Line ${startLine}): PERFECT MATCH`);
            perfectMatches++;
        } else {
            // Check if differences are minor (whitespace only)
            const normalizedOriginal = originalFormatted.replace(/\s+/g, ' ').trim();
            const normalizedOurs = ourOutput.replace(/\s+/g, ' ').trim();

            if (normalizedOriginal === normalizedOurs) {
                console.log(`\n≈ Test ${idx + 1} (Line ${startLine}): Minor whitespace differences`);
                minorDiffs++;
            } else {
                console.log(`\n✗ Test ${idx + 1} (Line ${startLine})${label ? ` (${label}:)` : ''}: DIFFERS`);
                console.log(`  Command: ${logicalCommand.substring(0, 50)}...`);
                console.log(`  Original (${originalLines.length} lines):`);
                originalLines.forEach((l, i) => console.log(`    ${i + 1}: |${l}|`));
                console.log(`  Our output (${ourLines.length} lines):`);
                ourLines.forEach((l, i) => console.log(`    ${i + 1}: |${l}|`));
                majorDiffs++;
            }
        }

    } catch (error: any) {
        console.log(`\n✗ Test ${idx + 1} (Line ${startLine}): ERROR - ${error.message}`);
        majorDiffs++;
    }
});

console.log("\n" + "=".repeat(70));
console.log(`\nRESULTS:`);
console.log(`  Perfect matches:  ${perfectMatches}/${blocks.length} (${Math.round(perfectMatches/blocks.length*100)}%)`);
console.log(`  Minor diffs:      ${minorDiffs}/${blocks.length}`);
console.log(`  Major diffs:      ${majorDiffs}/${blocks.length}`);

if (perfectMatches === blocks.length) {
    console.log(`\n🎉 Perfect! Formatter output exactly matches IBM i formatting!`);
} else if (perfectMatches + minorDiffs === blocks.length) {
    console.log(`\n✓ Good! Only minor whitespace differences from IBM i formatting`);
} else {
    console.log(`\n⚠ Some formatting differences exist - review major diffs above`);
}
