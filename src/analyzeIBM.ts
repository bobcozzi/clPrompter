// Analyzing IBM i CL prompter output to determine exact positions
// From user's example:
// `CHGVAR     VAR(&FROMLIB) VALUE(QTEMP)`

const ibmOutput = `             CHGVAR     VAR(&FROMLIB) VALUE(QTEMP)`;

console.log('Column ruler:');
console.log('0        1         2         3         4         5         6         7         8');
console.log('12345678901234567890123456789012345678901234567890123456789012345678901234567890');
console.log('\nIBM i CL Prompter output:');
console.log(ibmOutput);

const chgvarPos = ibmOutput.indexOf('CHGVAR');
const varPos = ibmOutput.indexOf('VAR(');
const valuePos = ibmOutput.indexOf('VALUE(');

console.log(`\nCHGVAR starts at column: ${chgvarPos}`);
console.log(`VAR starts at column: ${varPos}`);
console.log(`VALUE starts at column: ${valuePos}`);

// Calculate expected settings
console.log(`\nExpected settings (1-based):`);
console.log(`formatCmdPosition: ${chgvarPos + 1}`);
console.log(`formatKwdPosition: ${varPos + 1}`);
