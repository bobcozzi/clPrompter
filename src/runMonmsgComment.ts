// Runner for MONMSG comment test
import * as Module from 'module';

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

require('./testMonmsgComment');
