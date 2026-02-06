// Runner for integration test
import * as Module from 'module';

// Mock vscode module before importing test files
const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function(this: any, id: string) {
    if (id === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (key: string, defaultValue: any) => {
                        const defaults: any = {
                            formatCmdPosition: 14,
                            formatRightMargin: 70,
                            formatContinuePosition: 27,
                            formatLabelPosition: 2,
                            formatKwdPosition: 25
                        };
                        return defaults[key] || defaultValue;
                    }
                })
            },
            TextDocument: class {}
        };
    }
    return originalRequire.apply(this, arguments as any);
};

require('./testIntegration');
