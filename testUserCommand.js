// Mock vscode module
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

console.log('Testing user\'s command: CLSYNTAX: PGM &p1\n');

try {
  const tokens = tokenizeCL('CLSYNTAX: PGM &p1');
  console.log('Tokens:');
  tokens.forEach(t => console.log(`  ${t.type}: "${t.value}"`));
  console.log('\n✓ SUCCESS: Command tokenized without error');
} catch (e) {
  console.log('✗ FAILED:', e.message);
  console.log(e.stack);
}
