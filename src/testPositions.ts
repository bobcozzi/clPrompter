import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

// Simple test to verify column positions
const node: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        {
            name: 'VAR',
            value: '&X'
        },
        {
            name: 'VALUE',
            value: "'TEST'"
        }
    ]
};

// Use actual user settings: LabelPosition=2, CmdPosition=14, KwdPosition=25, ContinuePosition=27, RightMargin=70
const formatted = formatCLCommand_v2(node, undefined, {
    labelPosition: 1,    // formatLabelPosition 2 (1-based) = 1 (0-based)
    leftMargin: 13,      // formatCmdPosition 14 (1-based) = 13 (0-based)
    kwdPosition: 24,     // formatKwdPosition 25 (1-based) = 24 (0-based)
    rightMargin: 70,     // formatRightMargin
    contIndent: 27,      // formatContinuePosition 27 (1-based)
    continuationChar: '+'
});
const lines = formatted.split('\n');

console.log('\nColumn ruler:');
console.log('0        1         2         3         4         5         6         7         8');
console.log('12345678901234567890123456789012345678901234567890123456789012345678901234567890');
console.log('\nFormatted output:');
console.log(formatted);

// Analyze positions
const firstLine = lines[0];
const chgvarPos = firstLine.indexOf('CHGVAR');
const varPos = firstLine.indexOf('VAR(');

console.log(`\nCHGVAR starts at column: ${chgvarPos} (should be 13, or col 14 in 1-based)`);
console.log(`VAR starts at column: ${varPos} (should be 24, or col 25 in 1-based)`);
