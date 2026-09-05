import * as assert from 'assert';
import { isSpecifiedFromChildDefault } from '../promptHelpers';

function run(): void {
    // Untouched QUAL default should not count as specified.
    assert.strictEqual(isSpecifiedFromChildDefault('*NONE', '*NONE', false), false);

    // Blank value should not count as specified.
    assert.strictEqual(isSpecifiedFromChildDefault('', '*NONE', false), false);
    assert.strictEqual(isSpecifiedFromChildDefault('   ', '*NONE', false), false);

    // A changed value should count as specified.
    assert.strictEqual(isSpecifiedFromChildDefault('MYMSGQ', '*NONE', false), true);

    // If value came from the original command, preserve specified semantics.
    assert.strictEqual(isSpecifiedFromChildDefault('*NONE', '*NONE', true), true);

    // No child default: any non-blank value is specified.
    assert.strictEqual(isSpecifiedFromChildDefault('ABC', undefined, false), true);

    console.log('testDepQualDefault: all assertions passed');
}

run();
