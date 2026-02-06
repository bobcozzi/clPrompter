import { formatCLCommand_v2 } from './tokenLayoutFormatter';
import { CLNode } from './types';

const config = {
    leftMargin: 14,
    kwdPosition: 24,
    contIndent: 27,
    rightMargin: 70,
    continuationChar: '+'
};

console.log('=== Testing Very Long Qualified Name ===\n');

const test: CLNode = {
    type: 'command_call',
    name: 'COZTEST/BADQUAL',
    parameters: [
        {
            name: 'FILE',
            value: 'THESEARETHEDAYSTOHOLDONTOBUTWEWONTALTHOUGHWELLWANTTO/THESEARETHETIMESTOREMEMBERCAUSETHEYWILLNOTLASTFOREVER'
        }
    ],
    comment: '/* Hello world */'
};

console.log('Input:');
console.log('COZTEST/BADQUAL FILE(THESEARETHEDAYSTOHOLDONTOBUTWEWONTALTHOUGHWELLWANTTO/THESEARETHETIMESTOREMEMBERCAUSETHEYWILLNOTLASTFOREVER) /* Hello world */');
console.log('\nActual Output:');
const formatted = formatCLCommand_v2(test, undefined, config);
console.log(formatted);

console.log('\n\nExpected Output:');
console.log('COZTEST/BADQUAL +');
console.log('              FILE(THESEARETHEDAYSTOHOLDONTOBUTWEWONTALTH+');
console.log('              OUGHWELLWANTTO/THESEARETHETIMESTOREMEMBERCA+');
console.log('              USETHEYWILLNOTLASTFOREVER) /* Hello world */');

console.log('\n\nLine Length Analysis:');
const lines = formatted.split('\n');
lines.forEach((line, i) => {
    const len = line.length;
    const status = len <= 70 ? '✓' : '❌';
    console.log(`Line ${i + 1}: ${len} chars ${status}`);
    console.log(`  "${line}"`);
});

// Check if qualified name stayed together (no spaces around /)
if (formatted.includes(' / ')) {
    console.log('\n❌ ERROR: Qualified name has spaces around slash');
} else {
    console.log('\n✓ Qualified name has no spaces around slash');
}
