// Mock vscode module for testing BEFORE requiring modules
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
  if (id === 'vscode') {
    return {
      window: { activeTextEditor: null },
      EndOfLine: { CRLF: 2, LF: 1 }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { tokenizeCL } = require('./out/tokenizeCL');

console.log('Testing basic tokenizer...\n');

try {
  console.log('Test 1: Simple command');
  const tokens1 = tokenizeCL('CALL MYPGM');
  console.log('  Tokens:', tokens1.map(t => `${t.type}:${t.value}`).join(' '));
  console.log('  ✓ SUCCESS\n');
} catch (e) {
  console.log('  ✗ FAILED:', e.message, '\n');
}

try {
  console.log('Test 2: Command with variable');
  const tokens2 = tokenizeCL('CALL PGM(&VAR)');
  console.log('  Tokens:', tokens2.map(t => `${t.type}:${t.value}`).join(' '));
  console.log('  ✓ SUCCESS\n');
} catch (e) {
  console.log('  ✗ FAILED:', e.message, '\n');
}

try {
  console.log('Test 3: Command with multiple variables');
  const tokens3 = tokenizeCL('CALL PGM(MYPGM) PARM(&VAR1)');
  console.log('  Tokens:', tokens3.map(t => `${t.type}:${t.value}`).join(' '));
  console.log('  ✓ SUCCESS\n');
} catch (e) {
  console.log('  ✗ FAILED:', e.message, '\n');
}

try {
  console.log('Test 4: Positional with variables');
  const tokens4 = tokenizeCL('CALL MYPGM &VAR1');
  console.log('  Tokens:', tokens4.map(t => `${t.type}:${t.value}`).join(' '));
  console.log('  ✓ SUCCESS\n');
} catch (e) {
  console.log('  ✗ FAILED:', e.message, '\n');
}
