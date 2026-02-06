// Runner for testSbmjobComment - sets up vscode mock
import * as Module from 'module';

const originalRequire = Module.prototype.require;
(Module.prototype.require as any) = function(this: any, id: string) {
    if (id === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (key: string) => {
                        const defaults: any = {
                            'formatRightMargin': 70,
                            'formatCmdPosition': 14,
                            'formatKwdPosition': 25,
                            'formatContinuePosition': 27,
                            'formatLabelPosition': 2
                        };
                        return defaults[key];
                    }
                })
            }
        };
    }
    return originalRequire.apply(this, arguments as any);
};

require('./testSbmjobComment');
