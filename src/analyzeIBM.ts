/*
 * MIT License
 *
 * Copyright (c) 2026 R. Cozzi, Jr.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

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
