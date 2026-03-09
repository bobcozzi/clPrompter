/**
 * Runner for testBlankLines - sets up vscode mock before loading test
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
                            formatCmdPosition: 14,
                            formatRightMargin: 70,
                            formatContinuePosition: 27,
                            formatLabelPosition: 2,
                            formatKwdPosition: 25
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
import('./testBlankLines');
