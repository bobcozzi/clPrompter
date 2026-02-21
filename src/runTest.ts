/**
 * Test runner that mocks vscode module
 */

// Create mock vscode module before requiring any other modules
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id: string) {
    if (id === 'vscode') {
        // Return mock vscode
        return {
            workspace: {
                getConfiguration(section: string) {
                    return {
                        get(key: string, defaultValue?: any): any {
                            const defaults: any = {
                                'formatRightMargin': 70,
                                'convertCmdAndParmNameCase': '*UPPER',
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
    return originalRequire.apply(this, arguments as any);
};

// Now require and run the test
require('./testSimple');
