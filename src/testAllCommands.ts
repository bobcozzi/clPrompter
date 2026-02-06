/**
 * Test formatter with ALL commands from testCLCommands.clle
 * This test reads the file, parses each command, and compares formatter output
 */

import * as fs from 'fs';
import * as path from 'path';
import { tokenizeCL, parseCL } from './tokenizeCL';
import { formatCLCommand_v2 } from './tokenLayoutFormatter';

interface TestCommand {
    label?: string;
    original: string;  // Original formatted version
    logical: string;    // Single-line logical command (continuations collapsed)
    startLine: number;
}

/**
 * Parse the testCLCommands.clle file and extract each command
 */
function parseTestFile(filePath: string): TestCommand[] {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    const commands: TestCommand[] = [];

    let currentCmd: TestCommand | null = null;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Skip empty lines and comment-only lines
        if (!line.trim() || line.trim().startsWith('/*')) {
            i++;
            continue;
        }

        // Check for label
        const labelMatch = line.match(/^\s*(\w+):\s+(\w+)/);
        if (labelMatch) {
            const label = labelMatch[1];
            const cmdStart = line.indexOf(labelMatch[2]);
            const cmdLine = line.substring(cmdStart);

            currentCmd = {
                label,
                original: line,
                logical: '',
                startLine: i + 1
            };

            // Check if command continues
            if (cmdLine.includes('+')) {
                // Has continuation
                const continueChar = cmdLine.match(/\+\s*$/);
                if (continueChar) {
                    currentCmd.logical = cmdLine.replace(/\s*\+\s*$/, '').trim();
                } else {
                    currentCmd.logical = cmdLine.trim();
                }
            } else {
                // Complete on one line
                currentCmd.logical = cmdLine.trim();
                commands.push(currentCmd);
                currentCmd = null;
            }
        } else if (line.match(/^\s+\w+/)) {
            // Command without label
            const cmdMatch = line.match(/^\s+(\w+)/);
            if (cmdMatch) {
                currentCmd = {
                    original: line,
                    logical: '',
                    startLine: i + 1
                };

                const cmdLine = line.trim();
                if (cmdLine.includes('+') && cmdLine.match(/\+\s*$/)) {
                    // Has continuation
                    currentCmd.logical = cmdLine.replace(/\s*\+\s*$/, '').trim();
                } else {
                    // Complete on one line
                    currentCmd.logical = cmdLine.trim();
                    commands.push(currentCmd);
                    currentCmd = null;
                }
            }
        } else if (currentCmd) {
            // Continuation line
            const contLine = line.trim();

            // Remove leading/trailing continuation markers and comments
            let cleanLine = contLine.replace(/^\+\s*/, '').replace(/\s*\+\s*$/, '');

            // Check if this line has a comment
            const commentMatch = cleanLine.match(/\s*\/\*.*?\*\/\s*$/);
            if (commentMatch) {
                const comment = commentMatch[0];
                cleanLine = cleanLine.substring(0, cleanLine.length - comment.length).trim();
                // Keep the comment for later
                currentCmd.logical += ' ' + cleanLine;
                // Add comment and finalize command
                if (!currentCmd.logical.includes('/*')) {
                    currentCmd.logical += ' ' + comment.trim();
                }
                currentCmd.original += '\n' + line;
                commands.push(currentCmd);
                currentCmd = null;
            } else if (contLine.match(/\+\s*$/)) {
                // More continuation coming
                currentCmd.logical += ' ' + cleanLine;
                currentCmd.original += '\n' + line;
            } else {
                // Last continuation line
                currentCmd.logical += ' ' + cleanLine;
                currentCmd.original += '\n' + line;
                commands.push(currentCmd);
                currentCmd = null;
            }
        }

        i++;
    }

    return commands;
}

/**
 * Normalize a formatted command for comparison (remove extra whitespace, normalize spacing)
 */
function normalizeFormatted(text: string): string {
    return text
        .split('\n')
        .map(line => line.trimEnd())  // Remove trailing spaces
        .join('\n');
}

/**
 * Compare two formatted outputs line by line
 */
function compareOutputs(expected: string, actual: string): { match: boolean; issues: string[] } {
    const issues: string[] = [];
    const expLines = expected.split('\n');
    const actLines = actual.split('\n');

    if (expLines.length !== actLines.length) {
        issues.push(`Line count mismatch: expected ${expLines.length}, got ${actLines.length}`);
    }

    const maxLines = Math.max(expLines.length, actLines.length);
    for (let i = 0; i < maxLines; i++) {
        const expLine = expLines[i] || '';
        const actLine = actLines[i] || '';

        if (expLine !== actLine) {
            issues.push(`Line ${i + 1} differs:`);
            issues.push(`  Expected: "${expLine}"`);
            issues.push(`  Actual:   "${actLine}"`);

            // Check for specific known issues
            if (actLine.includes(' +') && !actLine.match(/\+\s*$/)) {
                issues.push(`  ⚠️  Space before continuation + in middle of line`);
            }
            if (expLine.includes(')') && !actLine.includes(')')) {
                issues.push(`  ⚠️  Missing closing paren - KNOWN ISSUE #2`);
            }
            if (expLine.includes("'") && actLine.includes("'")) {
                // String wrapping issue
                const expHasPlus = expLine.match(/'+\s*$/);
                const actHasPlus = actLine.match(/'+\s*$/);
                if (expHasPlus && !actHasPlus) {
                    issues.push(`  ⚠️  Long string not wrapping properly - KNOWN ISSUE #1`);
                }
            }
        }
    }

    return { match: issues.length === 0, issues };
}

// Main test execution
// When compiled, __dirname will be 'out', so go up one level to find src
const testFilePath = path.join(__dirname, '..', 'src', 'testCLCommands.clle');

// Standard CL formatting config (matching VS Code defaults)
const formatConfig = {
    leftMargin: 14,        // Command position
    rightMargin: 70,       // Right margin for wrapping
    contIndent: 27,        // Continuation line indent
    continuationChar: '+',
    labelPosition: 2,
    kwdPosition: 25        // First parameter position
};

console.log('='.repeat(80));
console.log('FULL TEST SUITE: testCLCommands.clle');
console.log('='.repeat(80));
console.log(`Reading: ${testFilePath}\n`);

const commands = parseTestFile(testFilePath);
console.log(`Found ${commands.length} commands to test\n`);

let passed = 0;
let failed = 0;
const failures: Array<{ cmd: TestCommand; issues: string[] }> = [];

for (const cmd of commands) {
    const testName = cmd.label
        ? `${cmd.label} (line ${cmd.startLine})`
        : `Line ${cmd.startLine}`;

    console.log('-'.repeat(80));
    console.log(`Testing: ${testName}`);
    console.log(`Command: ${cmd.logical.substring(0, 60)}${cmd.logical.length > 60 ? '...' : ''}`);

    try {
        // Parse and format
        const tokens = tokenizeCL(cmd.logical);
        const node = parseCL(tokens);

        if (!node) {
            console.log('❌ FAILED TO PARSE');
            failed++;
            failures.push({ cmd, issues: ['Failed to parse command'] });
            continue;
        }

        const formatted = formatCLCommand_v2(node, cmd.label, formatConfig);

        // Compare
        const expected = normalizeFormatted(cmd.original);
        const actual = normalizeFormatted(formatted);
        const comparison = compareOutputs(expected, actual);

        if (comparison.match) {
            console.log('✅ PASS - Output matches expected');
            passed++;
        } else {
            console.log('❌ FAIL - Output differs from expected');
            console.log('\nIssues:');
            comparison.issues.forEach(issue => console.log(`  ${issue}`));
            failed++;
            failures.push({ cmd, issues: comparison.issues });
        }

    } catch (error: any) {
        console.log(`❌ ERROR: ${error.message}`);
        failed++;
        failures.push({ cmd, issues: [error.message] });
    }
}

console.log('\n' + '='.repeat(80));
console.log('TEST RESULTS');
console.log('='.repeat(80));
console.log(`Total:  ${commands.length}`);
console.log(`Passed: ${passed} (${Math.round(passed / commands.length * 100)}%)`);
console.log(`Failed: ${failed} (${Math.round(failed / commands.length * 100)}%)`);

if (failures.length > 0) {
    console.log('\n' + '='.repeat(80));
    console.log('FAILURE SUMMARY');
    console.log('='.repeat(80));

    // Group by issue type
    const missingParens = failures.filter(f =>
        f.issues.some(i => i.includes('Missing closing paren'))
    );
    const stringWrapping = failures.filter(f =>
        f.issues.some(i => i.includes('string not wrapping'))
    );
    const other = failures.filter(f =>
        !f.issues.some(i => i.includes('Missing closing paren') || i.includes('string not wrapping'))
    );

    if (missingParens.length > 0) {
        console.log(`\n🔴 KNOWN ISSUE #2: Missing closing paren (${missingParens.length} commands)`);
        missingParens.slice(0, 3).forEach(f => {
            console.log(`  - ${f.cmd.label || 'Line ' + f.cmd.startLine}: ${f.cmd.logical.substring(0, 50)}...`);
        });
    }

    if (stringWrapping.length > 0) {
        console.log(`\n🔴 KNOWN ISSUE #1: Long string wrapping (${stringWrapping.length} commands)`);
        stringWrapping.slice(0, 3).forEach(f => {
            console.log(`  - ${f.cmd.label || 'Line ' + f.cmd.startLine}: ${f.cmd.logical.substring(0, 50)}...`);
        });
    }

    if (other.length > 0) {
        console.log(`\n⚠️  Other issues (${other.length} commands)`);
        other.slice(0, 5).forEach(f => {
            console.log(`  - ${f.cmd.label || 'Line ' + f.cmd.startLine}: ${f.issues[0]}`);
        });
    }
}

console.log('\n' + '='.repeat(80));
