// Runner for margin overflow test
import * as Module from 'module';

// Mock vscode module before importing test files
const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function(this: any, id: string) {
    if (id === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (key: string, defaultValue: any) => defaultValue
                })
            },
            TextDocument: class {}
        };
    }
    return originalRequire.apply(this, arguments as any);
};

require('./testMarginOverflow');
