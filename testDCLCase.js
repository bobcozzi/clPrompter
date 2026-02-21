// Quick test for DCL case conversion
// Mock vscode module before requiring other modules
const Module = require('module');
const originalRequire = Module.prototype.require;

function createMockVscode(convertCmdAndParmNameCase) {
    return {
        workspace: {
            getConfiguration(section) {
                return {
                    get(key, defaultValue) {
                        const defaults = {
                            'formatRightMargin': 70,
                            'convertCmdAndParmNameCase': convertCmdAndParmNameCase,
                            'formatLabelPosition': 2,
                            'formatCmdPosition': 14,
                            'formatKwdPosition': 25,
                            'formatContinuePosition': 27
                        };
                        return key in defaults ? defaults[key] : defaultValue;
                    }
                };
            }
        }
    };
}

const input = "DCL &P2 TYPE(*char) LEN(32) VALUE('Hello world')";
console.log('Original:', input);
console.log('');

// Test with different case options
const caseOptions = ['*UPPER', '*LOWER', '*NONE'];

for (const caseOption of caseOptions) {
    console.log(`\n--- Testing convertCmdAndParmNameCase = ${caseOption} ---`);

    // Set up mock for this test
    Module.prototype.require = function(id) {
        if (id === 'vscode') {
            return createMockVscode(caseOption);
        }
        return originalRequire.apply(this, arguments);
    };

    // Clear module cache to pick up new mock
    delete require.cache[require.resolve('./out/tokenizeCL')];

    // Load modules with mock
    const { formatCLCmd } = require('./out/tokenizeCL');

    // Extract parts
    const cmdName = 'DCL';
    const parmStr = "&P2 TYPE(*char) LEN(32) VALUE('Hello world')";

    // Format with current case setting
    const formatted = formatCLCmd(undefined, cmdName, parmStr);

    console.log(formatted);
}

// Restore original require
Module.prototype.require = originalRequire;
