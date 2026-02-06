/**
 * Comprehensive test of all commands from testCLCommands.clle
 * Uses the extractor to process multi-line commands properly
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

// Simple document mock for collectCLCmdFromLine
const mockDoc = {
    lineCount: lines.length,
    lineAt: (idx: number) => ({
        text: lines[idx]
    })
};

// Extract commands using the same logic as collectCLCmdFromLine
function extractCommand(startLine: number): { command: string; label?: string; endLine: number; comment?: string } | null {
    const line = lines[startLine];

    // Skip empty lines and standalone comments
    if (!line.trim() || (line.trim().startsWith('/*') && !line.includes('+'))) {
        return null;
    }

    let label: string | undefined;
    let cmdText = line;

    // Check for label (match "LABEL:" with optional whitespace before and after colon)
    const labelMatch = line.match(/^\s*(\w+):\s+/);
    if (labelMatch) {
        label = labelMatch[1];
        // Extract everything after the matched "LABEL:   " portion
        cmdText = line.substring(labelMatch[0].length);
    }

    // Scan forward for continuations
    let endLine = startLine;
    let command = cmdText.trim();
    let prevHadCont = command.endsWith('+');

    if (prevHadCont) {
        command = command.substring(0, command.length - 1).trim();
    }

    while (prevHadCont && endLine + 1 < lines.length) {
        endLine++;
        let nextLine = lines[endLine].trim();

        // Remove leading + if present
        if (nextLine.startsWith('+')) {
            nextLine = nextLine.substring(1).trim();
        }

        // Check for trailing +
        const hasCont = nextLine.endsWith('+');
        if (hasCont) {
            nextLine = nextLine.substring(0, nextLine.length - 1).trim();
        }

        command += ' ' + nextLine;
        prevHadCont = hasCont;
    }

    // Extract comment
    const extracted = extractCommentFromCommand(command);

    return {
        command: extracted.command,
        label,
        endLine,
        comment: extracted.comment
    };
}

console.log("Testing all commands from testCLCommands.clle\n");
console.log("=".repeat(70));

let lineIdx = 0;
let testNum = 0;
let passCount = 0;
let failCount = 0;
const errors: string[] = [];

while (lineIdx < lines.length) {
    const result = extractCommand(lineIdx);

    if (!result) {
        lineIdx++;
        continue;
    }

    testNum++;
    const { command, label, endLine, comment } = result;

    try {
        // Tokenize
        const tokens = tokenizeCL(command);

        // Parse
        const ast = parseCL(tokens, comment);

        // Format
        const formatted = formatCLCommand_v2(ast, label, config);

        console.log(`\nTest ${testNum}: Line ${lineIdx + 1}${label ? ` (${label}:)` : ''}`);
        console.log(`Command: ${command.substring(0, 60)}${command.length > 60 ? '...' : ''}`);
        console.log(`✓ PASS - Formatted successfully`);

        passCount++;

    } catch (error: any) {
        console.log(`\nTest ${testNum}: Line ${lineIdx + 1}${label ? ` (${label}:)` : ''}`);
        console.log(`Command: ${command.substring(0, 60)}${command.length > 60 ? '...' : ''}`);
        console.log(`✗ FAIL - ${error.message}`);

        failCount++;
        errors.push(`Line ${lineIdx + 1}: ${error.message}`);
    }

    lineIdx = endLine + 1;
}

console.log("\n" + "=".repeat(70));
console.log(`\nRESULTS: ${passCount} passed, ${failCount} failed out of ${testNum} tests`);

if (failCount > 0) {
    console.log("\nERRORS:");
    errors.forEach(err => console.log(`  - ${err}`));
} else {
    console.log("\n🎉 All commands from testCLCommands.clle format successfully!");
}
