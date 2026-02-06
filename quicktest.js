// Simple test for SBMJOB comment issue
const Module = require('module');
const orig = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    get: (k, defaultValue) => defaultValue
                })
            },
            TextDocument: class {}
        };
    }
    return orig.apply(this, arguments);
};

const formatCL = require('./out/formatCL');
const formatCLCmd = formatCL.formatCLCmd || formatCL.default;

const testCmd = 'SBMJOB CMD(DSPJOB JOB(063459/COZZI/THREADS) DUPJOBOPT(*MSG)) JOB(IBMIRD) PRTDEV(*USRPRF) /* what the heck? Over. */';

console.log('Input:', testCmd);
console.log('\nFormatting...');

const result = formatCLCmd(testCmd, {
    cvtcase: '*NONE',
    indrmks: '*YES',
    indcol: 2,
    labelpos: 2,
    bgncol: 14,
    indcont: 27
});

console.log('\nFormatted output:');
    console.log('Line:', lastParamLine);
} else {
    console.log('\n✗ FAIL: Comment moved to separate line');
}
