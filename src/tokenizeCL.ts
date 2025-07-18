
import * as vscode from 'vscode';
import { DOMParser } from '@xmldom/xmldom';
// tokenizeCL.ts - Tokenizer + Parser for IBM i CL Commands

export type CLToken =
    | { type: 'command' | 'keyword' | 'function' | 'variable' | 'value' | 'string' | 'symbolic_value'; value: string }
    | { type: 'paren_open' | 'paren_close'; value: '(' | ')' }
    | { type: 'space'; value: ' ' };

export interface CLNode {
    type: 'command_call';
    name: string;
    parameters: CLParameter[];
}

export interface CLParameter {
    name: string;
    value: CLValue;
}

export type CLValue =
    | string
    | CLNode
    | CLValue[]
    | { function: string; args: CLValue[] }
    | { type: 'expression'; tokens: CLToken[] };

/** Tokenizer */
export function tokenizeCL(input: string): CLToken[] {
    const tokens: CLToken[] = [];
    let i = 0;

    const peek = (): string => input[i];
    const next = (): string => input[i++];
    const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t';
    const isAlpha = (ch: string): boolean => /[A-Z]/i.test(ch);
    const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

    while (i < input.length) {
        const ch = peek();

        if (isSpace(ch)) {
            while (isSpace(peek())) next();
            tokens.push({ type: 'space', value: ' ' });
        } else if (ch === '(' || ch === ')') {
            tokens.push({ type: ch === '(' ? 'paren_open' : 'paren_close', value: ch });
            next();

        } else if (ch === "'") {
            // Quoted string, preserve all quotes and doubled quotes
            let str = '';
            str += next(); // opening quote
            while (i < input.length) {
                const curr = next();
                str += curr;
                if (curr === "'") {
                    // Check for doubled quote (escaped quote)
                    if (peek() === "'") {
                        str += next(); // add the second quote
                        continue;
                    } else {
                        break; // end of quoted string
                    }
                }
            }
            tokens.push({ type: 'string', value: str });
        } else if (ch === '&') {
            // Variable
            let varName = next();
            while (isAlpha(peek()) || isDigit(peek())) varName += next();
            tokens.push({ type: 'variable', value: varName });
        } else if (ch === '*') {
            // Symbolic value or operator
            let sym = next();
            while (isAlpha(peek())) sym += next();
            tokens.push({ type: 'symbolic_value', value: sym });
        } else if (ch === '%') {
            // Built-in function
            let fn = next();
            while (isAlpha(peek())) fn += next();
            tokens.push({ type: 'function', value: fn });
        } else {
            // Keyword, command, or value
            let val = '';
            while (i < input.length && !isSpace(peek()) && peek() !== '(' && peek() !== ')') {
                val += next();
            }
            const upperVal = val.toUpperCase();
            if (tokens.length === 0 && /^[A-Z][A-Z0-9]*$/.test(upperVal)) {
                tokens.push({ type: 'command', value: upperVal });
            } else if (/^[A-Z][A-Z0-9]*$/.test(upperVal)) {
                tokens.push({ type: 'keyword', value: upperVal });
            } else {
                tokens.push({ type: 'value', value: val });
            }
        }
    }

    return tokens;
}

/** Parser */
export function parseCL(tokens: CLToken[]): CLNode {
    let i = 0;
    const next = () => tokens[i++];
    const peek = () => tokens[i];
    const consume = (expectedType: CLToken['type']): CLToken => {
        const tok = next();
        if (tok.type !== expectedType) throw new Error(`Expected ${expectedType} but got ${tok.type}`);
        return tok;
    };

    function parseValue(): CLValue {
        // Handles both single and multiple ELEM groups (parenthesized expressions)
        const values: CLValue[] = [];
        while (i < tokens.length) {
            // Skip spaces between groups
            while (peek() && peek().type === 'space') next();

            // If next is a parenthesized group, parse it as an expression
            if (peek() && peek().type === 'paren_open') {
                next(); // consume '('
                const exprTokens: CLToken[] = [];
                let depth = 1;
                while (i < tokens.length && depth > 0) {
                    const tok = next();
                    if (tok.type === 'paren_open') depth++;
                    if (tok.type === 'paren_close') depth--;
                    if (depth > 0) exprTokens.push(tok);
                }
                values.push({ type: 'expression', tokens: exprTokens });
                // Skip spaces after group
                while (peek() && peek().type === 'space') next();
            } else {
                // Not a parenthesized group, parse as a single value/expression
                // (This covers simple parameters and positional values)
                const exprTokens: CLToken[] = [];
                while (i < tokens.length && peek().type !== 'paren_close' && peek().type !== 'paren_open') {
                    exprTokens.push(next());
                }
                if (exprTokens.length === 1) {
                    const single = exprTokens[0];
                    if (
                        single.type === 'string' ||
                        single.type === 'value' ||
                        single.type === 'symbolic_value' ||
                        single.type === 'variable'
                    ) {
                        values.push(single.value);
                    } else {
                        values.push({ type: 'expression', tokens: exprTokens });
                    }
                } else if (exprTokens.length > 0) {
                    values.push({ type: 'expression', tokens: exprTokens });
                }
                break; // Only one non-paren group allowed
            }
        }
        if (values.length === 1) return values[0];
        return values;
    }

    const commandToken = consume('command');
    const parameters: CLParameter[] = [];
    let positionalIndex = 1;

    while (i < tokens.length) {
        if (peek().type === 'space') next();

        const tok = peek();
        // Always treat all-caps words as keywords (even if misclassified as value)
        if (
            (tok.type === 'keyword') ||
            (tok.type === 'value' && /^[A-Z][A-Z0-9]*$/i.test(tok.value))
        ) {
            const paramName = next();
            // Accept both keyword and value tokens as parameter names
            console.log('PARAM:', paramName.value, 'Next token:', peek());
            if (peek() && peek().type === 'paren_open') {
                next(); // consume '('
                const val = parseValue();
                if (peek() && peek().type === 'paren_close') next();
                parameters.push({ name: paramName.value, value: val });
            } else {
                // If not followed by paren, skip (or handle as error)
                continue; // next();
            }
        } else if (tok.type !== 'paren_open' && tok.type !== 'paren_close') {
            // Only allow positional parameters for known commands (e.g., MONMSG)
            // For most commands, skip unexpected value tokens
            next(); // skip
        } else {
            next(); // Skip unexpected
        }
    }

    return { type: 'command_call', name: commandToken.value, parameters };
}



export function formatCLCmd(label: string | undefined, cmdName: string, paramStr: string): string {
    // Tokenize and parse just the parameter string
    const tokens = tokenizeCL(`${cmdName} ${paramStr}`);
    const ast = parseCL(tokens);

    // Set the command name from the known value
    ast.name = cmdName;

    // Format with SEU-style indentation
    return formatCL_SEU(ast, label);
}

/** Formatter */
export function formatCL(node: CLNode,
    indent = 0,
    indentStep = 2,
    rightMargin = 80,
    continuationChar = '+'): string {
    const pad = (n: number) => ' '.repeat(n);
    const outputLines: string[] = [];

    const formatValue = (value: CLValue, currentIndent: number): string => {
        if (typeof value === 'string') {
            return value;
        }
        if (Array.isArray(value)) {
            // Handle Max > 1 ELEM: array of arrays
            if (value.length > 0 && Array.isArray(value[0])) {
                // Each v is an array representing an ELEM group, already formatted with parens
                return value.map((v) => formatValue(v, currentIndent + indentStep)).join(' ');
            }
            // Single ELEM group
            return (
                '(' +
                value.map((v) => formatValue(v, currentIndent + indentStep)).join(' ') +
                ')'
            );
        }
        if ('function' in value) {
            const args = value.args.map((a) => formatValue(a, currentIndent + indentStep));
            const inner = args.join(' ');
            const candidate = `${value.function}(${inner})`;
            if ((pad(currentIndent) + candidate).length <= rightMargin) {
                return candidate;
            } else {
                return (
                    `${value.function}(` +
                    '\n' +
                    args.map((arg) => pad(currentIndent + indentStep) + arg).join('\n') +
                    '\n' +
                    pad(currentIndent) + ')'
                );
            }
        }
        if ('type' in value && value.type === 'command_call') {
            return formatCL(value, currentIndent + indentStep, indentStep, rightMargin, continuationChar);
        }
        if ('type' in value && value.type === 'expression') {
            // --- Use the new chunking logic for wrapping ---
            const chunks = splitExpressionTokensForWrap(value.tokens);
            // Try to fit as much as possible on the current line, wrap at spaces if needed
            let expr = '';
            let lineLen = currentIndent;
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (i === 0) {
                    expr += chunk;
                    lineLen += chunk.length;
                } else {
                    // +1 for the space
                    if (lineLen + 1 + chunk.length > rightMargin) {
                        expr += `\n${chunk}`; // <-- REMOVE INDENTATION HERE
                        lineLen = chunk.length;
                    } else {
                        expr += ' ' + chunk;
                        lineLen += 1 + chunk.length;
                    }
                }
            }
            return expr;
        }
        return '';
    };

    let currentLine = pad(indent) + node.name;
    const collectedLines: string[] = [];

    for (const param of node.parameters) {
        const formattedValue = formatValue(
            param.value,
            indent + indentStep + param.name.length + 1
        );
        const formatted = param.name.startsWith('__pos')
            ? `${pad(indent + indentStep)}${formattedValue}`
            : `${pad(indent + indentStep)}${param.name}(${formattedValue})`;

        const trimmed = formatted.trim();

        if (currentLine.length + 1 + trimmed.length > rightMargin) {
            collectedLines.push(currentLine + ' ' + continuationChar);
            currentLine = trimmed;
        } else {
            collectedLines.push(currentLine + ' ' + continuationChar);
            currentLine = trimmed;
        }
    }

    collectedLines.push(currentLine); // Final line

    // Update all but the last line to ensure continuation char is at the end
    const finalLines = collectedLines.map((line, idx) =>
        idx < collectedLines.length - 1 ? line.replace(/[ \t]*$/, ' ' + continuationChar) : line
    );

    return finalLines.join('\n');
}

// --- Add this helper near the top of the file ---
/**
 * Joins CL tokens for an expression, preserving original spacing and allowing line breaks at spaces.
 * Returns an array of "chunks" (strings) that can be joined or wrapped as needed.
 */
function splitExpressionTokensForWrap(tokens: CLToken[]): string[] {
    const chunks: string[] = [];
    let current = '';
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'space') {
            if (current) {
                chunks.push(current);
                current = '';
            }
        } else if (t.type === 'string') {
            // Always preserve quotes for string tokens
            current += t.value;
        } else {
            current += t.value;
        }
    }
    if (current) chunks.push(current);
    return chunks;
}


function padTo(pos: number, currentLen: number): string {
    return ' '.repeat(Math.max(0, (pos - currentLen) - 1));
}

function applyCase(text: string, keywordCase: 'upper' | 'lower'): string {
    // Skip case conversion if it's quoted (literal string)
    if (text.includes("'") || text.includes('"') || /\s/.test(text)) {
        return text;
    }

    return keywordCase === 'upper' ? text.toUpperCase() : text.toLowerCase();
}

function isExpression(val: any): val is { type: 'expression'; tokens: CLToken[] } {
    return typeof val === 'object' && val !== null && val.type === 'expression';
}

export function formatCL_SEU(
    node: CLNode,
    label?: string
): string {

    const continuationChar = '+';
    const config = vscode.workspace.getConfiguration('clPrompter');
    const rightMargin = config.get<number>('cmdRightMargin', 72);
    const keywordCase = (config.get<number>('cmdKwdCase', 0) === 0) ? 'upper' : 'lower';
    const LABEL_COL = config.get<number>('cmdLabelIndent', 2);
    const CMD_COL = config.get<number>('cmdIndent', 14);
    const FIRST_PARAM_COL = config.get<number>('cmdIndentParm', 25);
    const CONT_LINE_COL = config.get<number>('cmdContIndent', 27);
    let wrapped = false;
    const lines: string[] = [];
    const atomicValues = collectAtomicValues(node);

    // 🔹 ADD atomic keyword+parens here:
    for (const param of node.parameters) {
        const keywordWithParen = applyCase(param.name, keywordCase) + '(';
        atomicValues.add(keywordWithParen);
    }

    const formatValue = (value: CLValue, indentPos: number): string => {
        if (typeof value === 'string') return value;

        if (Array.isArray(value)) {
            // Handle Max > 1 ELEM: array of expressions (each group is an expression)
            if (value.length > 0 && value.every(isExpression)) {
                return value.map((v) => '(' + formatValue(v, indentPos + 1) + ')').join(' ');
            }
            // Handle Max > 1 ELEM: array of arrays (legacy)
            if (value.length > 0 && Array.isArray(value[0])) {
                return value.map((v) => '(' + formatValue(v, indentPos + 1) + ')').join(' ');
            }
            // Single ELEM group
            return '(' + value.map(v => formatValue(v, indentPos + 1)).join(' ') + ')';
        }

        if ('function' in value) {
            const args = value.args.map(a => formatValue(a, indentPos + 1));
            const singleLine = `${value.function}(${args.join(' ')})`;
            if (indentPos + singleLine.length <= rightMargin) {
                return singleLine;
            } else {
                const indentedArgs = args.map(arg => ' '.repeat(indentPos + 2) + arg).join(`\n${continuationChar}\n`);
                return `${value.function}(\n${indentedArgs}\n${' '.repeat(indentPos)})`;
            }
        }
        if ('type' in value && value.type === 'command_call') {
            return formatCL_SEU(value, label).replace(/\n/g, '\n' + ' '.repeat(indentPos));
        }
        if ('type' in value && value.type === 'expression') {
            const chunks = splitExpressionTokensForWrap(value.tokens);
            let expr = '';
            let lineLen = indentPos;
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (i === 0) {
                    expr += chunk;
                    lineLen += chunk.length;
                } else {
                    if (lineLen + 1 + chunk.length > rightMargin) {
                        expr += `\n${chunk}`;
                        lineLen = chunk.length;
                    } else {
                        expr += ' ' + chunk;
                        lineLen += 1 + chunk.length;
                    }
                }
            }
            return expr;
        }
        return '';
    };

    const labelPart = label
        ? padTo(LABEL_COL, 0) + (label + ':').padEnd(CMD_COL - LABEL_COL)
        : padTo(CMD_COL, 0);

    let currentLine = labelPart + applyCase(node.name, keywordCase) + padTo(FIRST_PARAM_COL, (labelPart + applyCase(node.name, keywordCase)).length);

    // Remove this block if you want strict column control, or adjust as needed
    // if (currentLine.length < FIRST_PARAM_COL) {
    //     currentLine += ' '.repeat(FIRST_PARAM_COL - currentLine.length);
    // }

    const linesOut: string[] = [];
    let firstParam = true;

    for (const [idx, param] of node.parameters.entries()) {
        const indentPos = idx === 0 ? FIRST_PARAM_COL : CONT_LINE_COL;
        const formattedValue = formatValue(param.value, indentPos);
        const valueLines = formattedValue.split('\n');
        const firstValueLine = valueLines[0];
        const keywordText = applyCase(param.name, keywordCase);
        const paramStrFirstLine =
            keywordText + '(' +
            (firstValueLine.startsWith("'") ? firstValueLine : applyCase(firstValueLine, keywordCase));

        // let paramText = firstParam ? paramStrFirstLine : ' ' + paramStrFirstLine;
        // space between parameters
        let paramText = '';  // (currentLine.length === FIRST_PARAM_COL ? '' : ' ') + paramStrFirstLine;
        if (currentLine && currentLine.endsWith(' ') || wrapped) {
            paramText = paramStrFirstLine;
        }
        else {
            paramText = ' ' + paramStrFirstLine;
        }
        wrapped = false;
        const result = appendWrappedCLLine(
            currentLine,
            paramText,
            linesOut,
            rightMargin,
            indentPos,
            continuationChar,
            atomicValues
        );
        if (result.lineWrap && !wrapped) {
            // remove the blank padding we added before calling appendWrappedCLLine
            if (result.currentLine.startsWith(' ')) {
                currentLine = result.currentLine.slice(1);
            } else {
                currentLine = result.currentLine;
            }
        }
        else {
            currentLine = result.currentLine;
        }
        wrapped = result.lineWrap;

        for (let i = 1; i < valueLines.length; i++) {
            if (!valueLines[i].trim()) continue;

            if (wrapped) {
                currentLine = padTo(CONT_LINE_COL, 0) + currentLine.trimStart();
                wrapped = false;
            }
            const result = appendWrappedCLLine(
                currentLine,
                valueLines[i],
                linesOut,
                rightMargin,
                CONT_LINE_COL,
                continuationChar,
                atomicValues
            );
            currentLine = result.currentLine;
            wrapped = result.lineWrap;
        }

        currentLine += ')';
        firstParam = false;
    }

    linesOut.push(currentLine);
    return linesOut.join('\n');
}

/**
 * Appends wrapped lines to linesOut, breaking only at spaces (never in the middle of a word).
 * Returns the updated currentLine after wrapping.
 */


function isCLNameChar(ch: string, isFirst: boolean): boolean {
    if (isFirst) return /[a-zA-Z&]/.test(ch); // allow & for variables
    return /[a-zA-Z0-9@#$_]/.test(ch);
}

function findLastSafeBreak(text: string, maxLen: number): number {
    // Try to break at the last space within maxLen
    let breakAt = text.lastIndexOf(' ', maxLen);
    if (breakAt === -1 || breakAt === 0) breakAt = maxLen;

    // Check if breaking here would split a valid CL name or variable
    let left = breakAt - 1;
    while (left >= 0 && isCLNameChar(text[left], false)) left--;
    left++;
    // If the word starts with a valid first char, and the break is not at a space, don't break here
    if (
        left < breakAt &&
        isCLNameChar(text[left], true) &&
        breakAt < text.length &&
        isCLNameChar(text[breakAt], false)
    ) {
        // Find the next space after maxLen
        let nextSpace = text.indexOf(' ', maxLen);
        if (nextSpace === -1) return text.length;
        return nextSpace;
    }
    return breakAt;
}
function collectAtomicValues(node: CLNode | CLValue): Set<string> {
    const values = new Set<string>();

    function walk(val: CLNode | CLValue) {
        if (typeof val === 'string') {
            // Only treat unquoted strings (like *YES, *LIBL, 1234) as atomic
            const isQuoted = val.startsWith("'") && val.endsWith("'");
            if (!isQuoted || val.length <= 10) {
                values.add(val);
            }

            // Always treat numbers as atomic
            if (/^\d+$/.test(val)) values.add(val);
            // *symbol, %func, &var
            if (/^[*%&]/.test(val)) values.add(val);
        } else if (Array.isArray(val)) {
            val.forEach(walk);
        } else if ('function' in val) {
            val.args.forEach(walk);
        } else if ('type' in val && val.type === 'expression') {
            // Add each token value as atomic if it's numeric or short quoted string
            for (const t of val.tokens) {
                if (
                    t.type === 'string' &&
                    t.value.length <= 10
                ) {
                    values.add(t.value);
                } else if (t.type === 'value' && /^\d+$/.test(t.value)) {
                    values.add(t.value);
                }
            }
        } else if ('type' in val && val.type === 'command_call') {
            val.parameters.forEach(p => walk(p.value));
        }
    }

    walk(node);
    return values;
}

function appendWrappedCLLine(
    initialLine: string,
    text: string,
    linesOut: string[],
    rightMargin: number,
    indentCol: number,
    continuationChar: string,
    atomicValues: Set<string>
): { currentLine: string, lineWrap: boolean } {
    let currentLine = initialLine;
    let remaining = text;
    let iteration = 0;
    const MAX_ITER = 1000;
    let wrappedLine = false;
    while (remaining.length > 0) {
        const available = rightMargin - currentLine.length;
        if (!remaining.trim()) break;
        iteration++;
        if (iteration > MAX_ITER) {
            console.error('appendWrappedCLLine: Exceeded max iterations, breaking to avoid infinite loop.');
            break;
        }
        if (iteration > 900) {
            console.warn('Iteration:', iteration, 'remaining starts with:', remaining.slice(0, 40));
        }
        // --- NEW: If the start of remaining is an atomic value longer than available, emit it as-is ---
        let atomicAtStart = false;
        for (const val of atomicValues) {
            if (!val) continue;
            if (remaining.startsWith(val) && val.length > available) {
                atomicAtStart = true;
                currentLine += val;
                remaining = remaining.slice(val.length).replace(/^ /, '');
                // Also block breaking immediately after keyword(
                if (val.endsWith('(') && currentLine.trim().endsWith(val)) {
                    linesOut.push(currentLine + ' ' + continuationChar);
                    currentLine = padTo(indentCol, 0);
                    continue;
                }
                break;
            }
        }
        if (atomicAtStart) {
            remaining = '';
            break;
        }
        // If the rest fits, just append
        if (remaining.length <= available) {
            currentLine += remaining;
            remaining = '';
            break;
        }

        // Find the last space within the allowed width
        let breakAt = remaining.lastIndexOf(' ', available);
        // Prevent breaking immediately after KEYWORD(
        for (const val of atomicValues) {
            if (!val.endsWith('(')) continue;
            const idx = remaining.indexOf(val);
            if (idx !== -1 && breakAt === idx + val.length - 1) {
                // We're about to break right after KEYWORD(
                linesOut.push(currentLine + ' ' + continuationChar);
                currentLine = padTo(indentCol, 0);
                wrappedLine = true;
                continue;
            }
        }
        // Prevent breaking immediately after a KEYWORD(
        const parenIdx = currentLine.lastIndexOf('(');
        if (parenIdx !== -1) {
            const maybeKeyword = currentLine.slice(0, parenIdx).trim().split(/\s+/).pop();
            if (maybeKeyword && atomicValues.has(`${maybeKeyword}(`)) {
                // Prevent breaking right after KEYWORD(
                linesOut.push(currentLine + ' ' + continuationChar);
                currentLine = padTo(indentCol, 0);
                wrappedLine = true;
                continue;
            }
        }

        // Prevent breaking immediately after any opening parenthesis
        if (
            breakAt > 0 &&
            remaining[breakAt - 1] === '('
        ) {
            // Look ahead for the next non-space character
            let k = breakAt;
            while (k < remaining.length && remaining[k] === ' ') k++;
            // Only allow break if next non-space is another '(' (for ELEM/Max>1)
            if (remaining[k] !== '(') {
                // Don't break here for simple values or QUALs
                linesOut.push(currentLine + ' ' + continuationChar);
                currentLine = padTo(indentCol, 0);
                wrappedLine = true;
                continue;
            }
        }

        // Prevent breaking inside atomic values
        let breakWouldSplitAtomic = false;
        for (const val of atomicValues) {
            if (!val) continue;
            let idx = remaining.indexOf(val);
            if (idx !== -1 && breakAt > idx && breakAt < idx + val.length) {
                breakWouldSplitAtomic = true;
                break;
            }
        }
        if (breakWouldSplitAtomic) {
            linesOut.push(currentLine + ' ' + continuationChar);
            currentLine = padTo(indentCol, 0);
            wrappedLine = true;
            continue;
        }

        // If breakAt is after a '(' and KEYWORD( is atomic, move the whole atomic value to the next line
        // If breakAt is after a '(' and the next non-space is NOT another '(', move the whole atomic value to the next line
        if (breakAt > 0 && remaining[breakAt - 1] === '(') {
            // Look ahead for the next non-space character
            let k = breakAt;
            while (k < remaining.length && remaining[k] === ' ') k++;
            if (remaining[k] !== '(') {
                // Don't break here for simple values
                linesOut.push(currentLine + ' ' + continuationChar);
                currentLine = padTo(indentCol, 0);
                wrappedLine = true;
                continue;
            }
            // If the next non-space is '(', allow the break (for ELEM/Max>1)
        }

        // If no space found, or break would split an atomic value, move the next atomic value to the next line
        if (breakAt === -1 || breakAt === 0) {
            let nextAtomic = null;
            let nextAtomicIdx = -1;
            for (const val of atomicValues) {
                if (!val) continue;
                let idx = remaining.indexOf(val);
                if (idx !== -1 && (nextAtomicIdx === -1 || idx < nextAtomicIdx)) {
                    nextAtomic = val;
                    nextAtomicIdx = idx;
                }
            }
            if (nextAtomicIdx === 0 && nextAtomic) {
                if (currentLine.trim().length > 0) {
                    linesOut.push(currentLine + ' ' + continuationChar);
                    currentLine = padTo(indentCol, 0);
                    wrappedLine = true;
                }
                currentLine += nextAtomic;
                remaining = remaining.slice(nextAtomic.length).replace(/^ /, '');
                continue;
            } else if (nextAtomicIdx > 0) {
                breakAt = nextAtomicIdx;
            } else {
                breakAt = available;
                if (breakAt <= 0) breakAt = 1; // Always make progress
            }
        }

        // Normal break at space (including inside quoted strings)
        // Don't break immediately after KEYWORD(

        let chunk = remaining.slice(0, breakAt);
        if (chunk.length === 0) {
            chunk = remaining.slice(0, 1);
        }
        // Only add a space if needed (not after '(' or if already a space)
        if (
            currentLine.length > 0 &&
            !currentLine.endsWith('(') &&
            !currentLine.endsWith(' ') &&
            !chunk.startsWith(' ')
        ) {
            currentLine += ' ';
        }
        currentLine += chunk;

        linesOut.push(currentLine + ' ' + continuationChar);
        wrappedLine = true;
        currentLine = padTo(indentCol, 0);
        remaining = remaining.slice(chunk.length).replace(/^ /, '');
    }
    return { currentLine, lineWrap: wrappedLine };
}