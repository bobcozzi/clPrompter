import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

// Test underscore in variable name
const node: CLNode = {
    type: 'command_call',
    name: 'CHGVAR',
    parameters: [
        {
            name: 'VAR',
            value: '&LONGVAR_FIELDNAME'
        }
    ]
};

console.log('Testing variable name with underscore:');
console.log('Input value:', node.parameters[0].value);
console.log('\nFormatted output:');
const formatted = formatCLCommand_v2(node, undefined, {
    labelPosition: 1,
    leftMargin: 13,
    kwdPosition: 24,
    rightMargin: 70,
    contIndent: 27,
    continuationChar: '+'
});
console.log(formatted);
console.log('\nChecking for unwanted space:');
if (formatted.includes('&LONGVAR _FIELDNAME')) {
    console.log('⚠️  SPACE FOUND BEFORE UNDERSCORE');
} else if (formatted.includes('&LONGVAR_FIELDNAME')) {
    console.log('✅ Variable name preserved correctly');
} else {
    console.log('❓ Variable name not found in output');
}
