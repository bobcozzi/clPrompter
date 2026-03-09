/**
 * Runner for testIssues3 - sets up vscode mock before loading test
 */

import * as Module from 'module';

// Mock vscode module before importing test files
const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function(this: any, id: string) {
    if (id === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (key: string) => {
                        const defaults: any = {
                            leftMargin: 14,
                            rightMargin: 70,
                            contIndent: 27,
                            continuationChar: '+',
                            labelPosition: 2,
                            kwdPosition: 25
                        };
                        return defaults[key];
                    }
                })
            }
        };
    }
    return originalRequire.apply(this, arguments as any);
};

// Now import and run the test
import('./testIssues3');
