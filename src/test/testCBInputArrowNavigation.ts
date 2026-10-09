import * as assert from 'assert';
import { cbinputMoveIndex, cbinputResolveHighlightIndex } from '../webview-assets/cbinput';

const options = ['Alpha', 'Beta', 'Gamma'];

// Regression: when value already matches first option, first ArrowDown after focus
// must advance to the next entry (not appear as a no-op).
let highlightedIndex = -1;
highlightedIndex = cbinputResolveHighlightIndex(options, 'Alpha');
assert.strictEqual(highlightedIndex, 0, 'focus sync should align highlight with current value');

highlightedIndex = cbinputMoveIndex(options, highlightedIndex, 'next');
assert.strictEqual(highlightedIndex, 1, 'first ArrowDown should move to next option');

// ArrowUp from first option should wrap to last option.
highlightedIndex = cbinputResolveHighlightIndex(options, 'Alpha');
highlightedIndex = cbinputMoveIndex(options, highlightedIndex, 'previous');
assert.strictEqual(highlightedIndex, 2, 'ArrowUp from first option should wrap to last');

// Non-matching value should start at -1 and first ArrowDown should go to first option.
highlightedIndex = cbinputResolveHighlightIndex(options, 'NotInList');
assert.strictEqual(highlightedIndex, -1, 'non-matching value should not force a highlight');

highlightedIndex = cbinputMoveIndex(options, highlightedIndex, 'next');
assert.strictEqual(highlightedIndex, 0, 'ArrowDown from no highlight should start at first option');

// Empty options should remain unhighlighted.
assert.strictEqual(cbinputMoveIndex([], -1, 'next'), -1, 'empty option set should stay unhighlighted');

console.log('CBInput arrow navigation regression tests passed');
