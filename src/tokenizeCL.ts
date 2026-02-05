import * as vscode from 'vscode';
import { CLToken, CLNode, CLParsedParm, CLValue } from './types';

// CL variable name pattern: &NAME or &NAME_QUALIFIER
// Format: & followed by letter, then up to 21 more chars (letters, digits, underscores)
// Max: 22 chars total (e.g., &LONGVAR_FIELDNAME)
export const CL_VARIABLE_PATTERN = /^&[A-Z][A-Z0-9_]{0,21}$/i;

// Function to get proper EOL character for cross-platform compatibility
function getEOL(): string {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return activeEditor.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    }
    // Default to LF if no active editor
    return '\n';
}

// import { DOMParser } from '@xmldom/xmldom';
// tokenizeCL.ts - Tokenizer + Parser for IBM i CL Commands

/** Tokenizer */
export function tokenizeCL(input: string): CLToken[] {
    const tokens: CLToken[] = [];
    let i = 0;

    const peek = (): string => input[i];
    const peekN = (n: number): string => input.substring(i, i + n);
    const next = (): string => input[i++];
    const isSpace = (ch: string): boolean => ch === ' ' || ch === '\t';
    const isAlpha = (ch: string): boolean => /[A-Z]/i.test(ch);
    const isDigit = (ch: string): boolean => /[0-9]/.test(ch);

    // IBM i CL symbolic operators (per IBM documentation)
    const SYMBOLIC_OPERATORS = [
        '*CAT', '*BCAT', '*TCAT',           // Character string operators
        '*AND', '*OR', '*NOT',              // Logical operators
        '*EQ', '*GT', '*LT', '*GE', '*LE',  // Relational operators
        '*NE', '*NG', '*NL'                 // More relational operators
    ];

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
            // Check if this is a symbolic operator, symbolic value, or multiplication operator
            if (isAlpha(input[i + 1])) {
                // Read the full symbolic token
                let sym = next(); // consume '*'
                while (isAlpha(peek())) sym += next();
                const upperSym = sym.toUpperCase();

                // Check if it's a known operator
                if (SYMBOLIC_OPERATORS.includes(upperSym)) {
                    tokens.push({ type: 'operator', value: upperSym });
                } else {
                    // It's a symbolic value like *FILE, *LIBL, *CURLIB
                    tokens.push({ type: 'symbolic_value', value: sym });
                }
            } else {
                // Standalone * is multiplication operator
                next();
                tokens.push({ type: 'operator', value: '*' });
            }
        } else if (peekN(2) === '||' || peekN(2) === '|>' || peekN(2) === '|<' ||
                   peekN(2) === '>=' || peekN(2) === '<=' || peekN(2) === '¬=' ||
                   peekN(2) === '¬>' || peekN(2) === '¬<') {
            // Two-character operators
            const op = peekN(2);
            next(); next();
            tokens.push({ type: 'operator', value: op });
        } else if (ch === '+' || ch === '-' || ch === '/' ||
                   ch === '=' || ch === '>' || ch === '<' ||
                   ch === '&' || ch === '|' || ch === '¬') {
            // Single-character operators
            next();
            tokens.push({ type: 'operator', value: ch });
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
            // Check for command (first token, can be LIB/CMD or just CMD)
            if (tokens.length === 0 && /^([A-Z][A-Z0-9]*\/)?[A-Z][A-Z0-9]*$/.test(upperVal)) {
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
export function parseCL(tokens: CLToken[], comment?: string): CLNode {
    let i = 0;
    const next = () => tokens[i++];
    const peek = () => tokens[i];
    const consume = (expectedType: CLToken['type']): CLToken => {
        const tok = next();
        if (tok.type !== expectedType) throw new Error(`Expected ${expectedType} but got ${tok.type}`);
        return tok;
    };


    function parseValue(): CLValue {
        // Collects multiple groups: unwrapped expression(s) and parenthesized groups
        const values: CLValue[] = [];
        while (i < tokens.length) {
            // Skip spaces between groups
            while (peek() && peek().type === 'space') next();

            // Stop if the enclosing param's ')' is next
            if (peek() && peek().type === 'paren_close') break;

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
                // Mark this expression as originally wrapped
                values.push({ type: 'expression', tokens: exprTokens, wrapped: true } as any);
                continue;
            }

            // Unwrapped expression until next '(' or ')'
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
                    values.push({ type: 'expression', tokens: exprTokens, wrapped: false } as any);
                }
            } else if (exprTokens.length > 0) {
                values.push({ type: 'expression', tokens: exprTokens, wrapped: false } as any);
            }
        }
        if (values.length === 1) return values[0];
        return values;
    }

    const commandToken = consume('command');
    const parameters: CLParsedParm[] = [];
    let positionalIndex = 1;
    let seenNamed = false;

    while (i < tokens.length) {
        if (peek() && peek().type === 'space') next();
        const tok = peek();
        if (!tok) break;

        // Named parameter: KEYWORD '(' value ')'
        if (tok.type === 'keyword') {
            const lookahead = tokens[i + 1];
            if (lookahead && lookahead.type === 'paren_open') {
                const parmName = next(); // keyword
                seenNamed = true;
                // Debug
                console.log('PARM:', parmName.value, 'Next token:', peek());
                next(); // consume '('
                const val = parseValue();
                if (peek() && peek().type === 'paren_close') next();
                parameters.push({ name: parmName.value, value: val });
                continue;
            }
        }

        // Positional parameter(s) allowed only before first named parameter
        if (!seenNamed && (tok.type === 'value' || tok.type === 'string' || tok.type === 'variable' || tok.type === 'symbolic_value' || tok.type === 'function')) {
            const posTok = next(); // consume the positional token
            parameters.push({ name: `__pos${positionalIndex++}`, value: posTok.value });
            continue;
        }

        // Otherwise, consume and move on
        next();
    }

    return { type: 'command_call', name: commandToken.value, parameters, comment };
}

// Add these helpers near your submit/prompt handling:

type AnyMeta = any; // use your real ParmMeta type

export function mapPositionalToMetaValue(meta: AnyMeta, raw: string) {
    // Heuristic: if first top-level Elem is QUAL (OBJ+LIB), convert "LIB/OBJ" or "OBJ" into [ ['OBJ','LIB'] ]
    const hasQualFirst =
        Array.isArray(meta.Elems) &&
        meta.Elems.length > 0 &&
        meta.Elems[0] &&
        (meta.Elems[0].Type === 'QUAL' || meta.Elems[0].type === 'QUAL');

    if (hasQualFirst) {
        const parts = raw.split('/');
        const obj = parts.length === 2 ? parts[1] : parts[0];
        const lib = parts.length === 2 ? parts[0] : '*LIBL';
        // Shape expected downstream: [ ['OBJ','LIB'] ] (+ other elem groups remain default/empty)
        return [[obj, lib]];
    }

    // Otherwise leave as-is (simple CHAR, etc.)
    return raw;
}


/**
 * Converts leading __posN parameters to real keywords using parmMetas order.
 * Stops mapping as soon as a named keyword is seen. Positionals after that are ignored.
 */
export function resolvePositionalsToKeywords(ast: import('./types').CLNode, parmMetas: AnyMeta[]) {
    const mapped: import('./types').CLParsedParm[] = [];
    let metaIdx = 0;
    let seenNamed = false;

    for (const p of ast.parameters) {
        if (p.name.startsWith('__pos')) {
            if (seenNamed) {
                console.warn('[clPrompter] Positional found after a named parameter. Ignoring:', p.value);
                continue;
            }
            // Find next unmapped meta
            while (metaIdx < parmMetas.length && mapped.some(m => m.name === parmMetas[metaIdx].Kwd)) {
                metaIdx++;
            }
            if (metaIdx >= parmMetas.length) continue;

            const meta = parmMetas[metaIdx++];
            const val = typeof p.value === 'string' ? mapPositionalToMetaValue(meta, p.value) : p.value;
            mapped.push({ name: meta.Kwd, value: val });
        } else {
            seenNamed = true;
            mapped.push(p);
        }
    }

    return { ...ast, parameters: mapped };
}



// Named parm = keyword immediately followed by '(' (no blanks)
function isNamedAt(tokens: any[], idx: number): boolean {
    return tokens[idx]?.type === 'keyword' && tokens[idx + 1]?.type === 'paren_open';
}

// Helper: numeric PosNbr (or “no pos”)
function getPosNbrMeta(m: any): number {
    const raw = m?.PosNbr ?? m?.Pos ?? m?.Position ?? m?.PosNum ?? m?.PosNumber;
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
}

//////////
export function rewriteLeadingPositionalsByList(fullCmd: string, positionalKwds: string[], cmdMaxPos?: number): string {
  const tokens = tokenizeCL(fullCmd);
  if (!tokens.length || positionalKwds.length === 0) return fullCmd;

  const cmdIdx = tokens.findIndex(t => t.type === 'command');
  if (cmdIdx < 0) return fullCmd;

  const limit =
    Number.isFinite(cmdMaxPos as number) && (cmdMaxPos as number) >= 0
      ? Math.min(positionalKwds.length, cmdMaxPos as number)
      : positionalKwds.length;

  const kwdList = positionalKwds.slice(0, limit);
  const outVals = tokens.map(t => t.value);

  const isNamedAt = (idx: number) =>
    tokens[idx]?.type === 'keyword' && tokens[idx + 1]?.type === 'paren_open';

  let i = cmdIdx + 1;
  let posIdx = 0;

  while (i < tokens.length && posIdx < kwdList.length) {
    const t = tokens[i];
    if (t.type === 'space') { i++; continue; }
    if (isNamedAt(i)) break; // stop at first named parm (KWD()

    // Case 1: positional wrapped in (...) → capture group
    if (t.type === 'paren_open') {
      let depth = 1;
      let j = i + 1;
      while (j < tokens.length && depth > 0) {
        if (tokens[j].type === 'paren_open') depth++;
        else if (tokens[j].type === 'paren_close') depth--;
        j++;
      }
      const closeIdx = j - 1;
      if (depth !== 0 || closeIdx <= i) break; // unbalanced; bail out

      const inner = tokens.slice(i + 1, closeIdx).map(x => x.value).join('');
      const kwd = kwdList[posIdx++];
      outVals[i] = `${kwd}(${inner})`;
      for (let k = i + 1; k <= closeIdx; k++) outVals[k] = '';
      i = closeIdx + 1;
      continue;
    }

    // Case 2: bare value-like token → positional
 const isBareKeyword = t.type === 'keyword' && tokens[i + 1]?.type !== 'paren_open';
    const isPositional =
      isBareKeyword ||
      t.type === 'value' ||
      t.type === 'string' ||
      t.type === 'variable' ||
      t.type === 'symbolic_value' ||
      t.type === 'function';

    if (!isPositional) break;

    const kwd = kwdList[posIdx++];
    outVals[i] = `${kwd}(${t.value})`;
    i++;
  }

  return outVals.join('');
}

//////////
// A "throwaway" parameter should never be prompted or used for positionals.
// - Constant attribute present (any value, including empty) → throwaway
// - Type === 'NULL' (case-insensitive) → throwaway
function isThrowawayMeta(m: any): boolean {
  const type = String(m?.Type ?? '').toUpperCase();
  const hasConstantAttr =
    (m != null && Object.prototype.hasOwnProperty.call(m, 'Constant')) ||
    m?.Constant !== undefined; // presence is enough
  return type === 'NULL' || hasConstantAttr;
}

// Ensure rewriteLeadingPositionals filters with isThrowawayMeta
export function rewriteLeadingPositionals(fullCmd: string, parmMetas: any[], cmdMaxPos?: number): string {
  const tokens = tokenizeCL(fullCmd);
  if (!tokens.length) return fullCmd;

  const cmdIdx = tokens.findIndex(t => t.type === 'command');
  if (cmdIdx < 0) return fullCmd;

  // Exclude Constant/NULL parms from positional keyword list
  const metasWithIdx = (parmMetas ?? [])
    .filter(m => !isThrowawayMeta(m))
    .map((m, idx) => ({
      m,
      idx,
      pos: (() => {
        const raw = m?.PosNbr ?? m?.Pos ?? m?.Position ?? m?.PosNum ?? m?.PosNumber;
        const n = Number.parseInt(String(raw), 10);
        return Number.isFinite(n) && n > 0 ? n : Number.POSITIVE_INFINITY;
      })()
    }))
    .sort((a, b) => {
      const aHas = a.pos !== Number.POSITIVE_INFINITY;
      const bHas = b.pos !== Number.POSITIVE_INFINITY;
      if (aHas && bHas) return a.pos - b.pos;   // PosNbr first, ascending
      if (aHas && !bHas) return -1;             // with PosNbr before no-pos
      if (!aHas && bHas) return 1;              // no-pos after PosNbr
      return a.idx - b.idx;                     // stable among no-pos
    });

  const limit =
    Number.isFinite(cmdMaxPos as number) && (cmdMaxPos as number) >= 0
      ? Math.min(metasWithIdx.length, cmdMaxPos as number)
      : metasWithIdx.length;

  const positionalKwds = metasWithIdx
    .slice(0, limit)
    .map(x => String(x.m?.Kwd ?? '').toUpperCase())
    .filter(Boolean);

  if (positionalKwds.length === 0) return fullCmd;

  const outVals = tokens.map(t => t.value);
  const isNamedAt = (idx: number) =>
    tokens[idx]?.type === 'keyword' && tokens[idx + 1]?.type === 'paren_open';

  let i = cmdIdx + 1;
  let posIdx = 0;

  while (i < tokens.length && posIdx < positionalKwds.length) {
    const t = tokens[i];
    if (t.type === 'space') { i++; continue; }
    if (isNamedAt(i)) break;

    const isBareKeyword = t.type === 'keyword' && tokens[i + 1]?.type !== 'paren_open';
    const isPositional =
      isBareKeyword ||
      t.type === 'value' ||
      t.type === 'string' ||
      t.type === 'variable' ||
      t.type === 'symbolic_value' ||
      t.type === 'function';

    if (!isPositional) break;

    const kwd = positionalKwds[posIdx++];
    outVals[i] = `${kwd}(${t.value})`;
    i++;
  }

  return outVals.join('');
}

// Optional: debug the token stream if needed
export function debugTokenStream(fullCmd: string): void {
    const toks = tokenizeCL(fullCmd);
    console.log('[clPrompter::rewriteLeadingPositionals] TOKENS:', toks.map((t: any) => `${t.type}:${t.value}`).join(' | '));
}

// Depth-aware helpers (same logic as in extension.ts)
function skipQuoted(str: string, i: number): number {
    const quote = str[i];
    i++;
    while (i < str.length) {
        if (str[i] === quote) {
            if (str[i + 1] === quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        i++;
    }
    return i;
}

function findMatchingParen(str: string, openIdx: number): number {
    let i = openIdx;
    let depth = 0;
    while (i < str.length) {
        const ch = str[i];
        if (ch === "'" || ch === '"') {
            i = skipQuoted(str, i);
            continue;
        }
        if (ch === '(') depth++;
        else if (ch === ')') {
            depth--;
            if (depth === 0) return i;
        }
        i++;
    }
    return -1;
}

// Extracts KW(value) pairs, preserving nested parens inside value
function extractParms(parmStr: string): Array<{ kwd: string; value: string }> {
    const out: Array<{ kwd: string; value: string }> = [];
    const re = /\b([A-Z0-9$#@_]+)\s*\(/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(parmStr))) {
        const kwd = m[1].toUpperCase();
        const openIdx = m.index + m[0].lastIndexOf('(');
        const closeIdx = findMatchingParen(parmStr, openIdx);
        if (closeIdx > openIdx) {
            const value = parmStr.slice(openIdx + 1, closeIdx);
            out.push({ kwd, value });
            re.lastIndex = closeIdx + 1;
        } else {
            break;
        }
    }
    return out;
}


export function formatCLCmd(label: string | undefined, cmdName: string, parmStr: string, comment?: string): string {
    // Tokenize and parse the full command (command name + params)
    const tokens = tokenizeCL(`${cmdName} ${parmStr}`);
    const ast = parseCL(tokens, comment);

    // Ensure command name is set as provided
    ast.name = cmdName;

    // SEU-style formatter preserves nested parens (e.g., (1 64))
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
            // NEW: array of expressions (each may have wrapped=true/false)
            if (value.length > 0 && value.every(isExpression)) {
                return value
                    .map((v) => {
                        const inner = formatValue(v, currentIndent + indentStep);
                        const wrapped = (v as any).wrapped === true;
                        return wrapped ? `(${inner})` : inner;
                    })
                    .join(' ');
            }
            // Legacy: array of arrays (Max>1 ELEM as nested arrays)
            if (value.length > 0 && Array.isArray(value[0])) {
                return value.map((v) => formatValue(v, currentIndent + indentStep)).join(' ');
            }
            // Single grouped value
            return '(' + value.map((v) => formatValue(v, currentIndent + indentStep)).join(' ') + ')';
        }

        if ('function' in value) {
            const args = value.args.map((a) => formatValue(a, currentIndent + indentStep));
            const inner = args.join(' ');
            const candidate = `${value.function}(${inner})`;
            if ((pad(currentIndent) + candidate).length <= rightMargin) {
                return candidate;
            } else {
                const eol = getEOL();
                return (
                    `${value.function}(` +
                    eol +
                    args.map((arg) => pad(currentIndent + indentStep) + arg).join(eol) +
                    eol +
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
                        const eol = getEOL();
                        expr += `${eol}${chunk}`; // <-- REMOVE INDENTATION HERE
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

    for (const parm of node.parameters) {
        const formattedValue = formatValue(
            parm.value,
            indent + indentStep + parm.name.length + 1
        );
        const formatted = parm.name.startsWith('__pos')
            ? `${pad(indent + indentStep)}${formattedValue}`
            : `${pad(indent + indentStep)}${parm.name}(${formattedValue})`;

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

    const eol = getEOL();
    return finalLines.join(eol);
}


/**
 * Joins CL tokens for an expression, preserving original spacing and allowing line breaks at spaces.
 * Returns an array of "chunks" (strings) that can be joined or wrapped as needed.
 */
function splitExpressionTokensForWrap(tokens: CLToken[]): string[] {
    // Build chunks by treating the entire token sequence as a continuous stream.
    // Break tokens into word-like chunks that can be wrapped optimally.
    // This is similar to how quoted strings wrap - find natural break points.
    const chunks: string[] = [];
    let current = '';

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];

        if (t.type === 'string') {
            // Strings with quotes - add to current
            current += t.value;
        } else if (t.type === 'space') {
            // Space creates a potential break point
            // Add the space to current, then break to create a chunk
            if (current.trim()) {
                current += ' ';
                chunks.push(current.trimEnd());
                current = '';
            }
        } else {
            // Variables, symbolic values, etc.
            current += t.value;
        }
    }

    // Add any remaining content
    if (current.trim()) {
        chunks.push(current.trimEnd());
    }

    return chunks;
}


function padTo(pos: number, currentLen: number): string {
    return ' '.repeat(Math.max(0, pos - currentLen));
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
    const rightMargin = config.get<number>('formatRightMargin', 72);
    const keywordCase = (config.get<string>('formatCase', '*UPPER') === '*UPPER') ? 'upper' : 'lower';
    const LABEL_COL = config.get<number>('formatLabelPosition', 2);
    const CMD_COL = config.get<number>('formatCmdPosition', 14);
    const FIRST_PARAM_COL = config.get<number>('formatKwdPosition', 25);
    const CONT_LINE_COL = config.get<number>('formatContinuePosition', 27);
    let wrapped = false;
    const lines: string[] = [];
    const atomicValues = collectAtomicValues(node);
    // 🔹 ADD atomic keyword+parens AND complete ELEM values here:
    for (const parm of node.parameters) {
        const keywordWithParen = applyCase(parm.name, keywordCase) + '(';
        atomicValues.add(keywordWithParen);

        // For array of wrapped expressions (multi-instance ELEM), add each wrapped expression as atomic
        if (Array.isArray(parm.value) && parm.value.length > 0 &&
            parm.value.every((v: any) => typeof v === 'object' && v !== null && 'wrapped' in v && v.wrapped === true)) {
            // Each wrapped expression should be atomic: (*KEYWORD 'value')
            for (const expr of parm.value) {
                const exprObj = expr as any;
                const tokens = exprObj.tokens as Array<{type: string, value: string}>;
                const inner = tokens.map((t: any) => t.value).join('');
                atomicValues.add(`(${inner})`);
                atomicValues.add(`(${inner})`); // With trailing space variant
                console.log(`[atomicValues] Added wrapped ELEM expression as atomic: "(${inner})"`);
            }
        }
        // For ELEM parameters (expression objects), add the complete keyword+value as atomic to prevent internal breaks
        // ELEM parameters are stored as expression objects with tokens, not arrays
        else if (typeof parm.value === 'object' && parm.value !== null && 'type' in parm.value &&
            (parm.value as any).type === 'expression' && 'tokens' in parm.value) {
            // Expression object - extract non-space token values and join them
            const tokens = (parm.value as any).tokens as Array<{type: string, value: string}>;
            const values = tokens.filter(t => t.type !== 'space').map(t => t.value);

            // If expression contains variables, join without spaces (e.g., &LONGVAR_FIELDNAME)
            // Otherwise join with spaces for operators/keywords (e.g., &VAR *CAT &VAR2)
            const hasVariable = tokens.some((t: any) => t.type === 'variable' || (t.type === 'value' && CL_VARIABLE_PATTERN.test(t.value)));
            const hasOperatorOrKeyword = tokens.some((t: any) => t.type === 'keyword' || t.type === 'operator' || t.type === 'symbolic_value' || (t.type === 'value' && /^[*%]/.test(t.value)));
            console.log(`[atomicValues] parm=${parm.name}, hasVariable=${hasVariable}, hasOperatorOrKeyword=${hasOperatorOrKeyword}, tokens=`, tokens.map(t => `${t.type}:${t.value}`));
            const valueText = (hasVariable && !hasOperatorOrKeyword) ? values.join('') : values.join(' ');
            console.log(`[atomicValues] valueText="${valueText}"`);

            // ONLY add as atomic if it's a simple variable expression (no operators/keywords)
            // Complex expressions like &VAR *EQ '*FROM' should NOT be atomic
            if (hasVariable && !hasOperatorOrKeyword) {
                const withoutParen = applyCase(parm.name, keywordCase) + '(' + valueText;
                const withParen = withoutParen + ')';
                // Add both with and without closing paren (since appendWrappedCLLine gets text without closing paren)
                atomicValues.add(withoutParen);
                atomicValues.add(withParen);
                console.log(`[atomicValues] Added simple variable param as atomic: "${withoutParen}"`);
            }
        }
        // Fallback: For simple arrays (if any parameters still use this format)
        else if (Array.isArray(parm.value) && !('type' in parm.value)) {
            const elements = parm.value.map(v => typeof v === 'string' ? v : String(v));
            const valueText = elements.join(' ');
            const withoutParen = applyCase(parm.name, keywordCase) + '(' + valueText;
            const withParen = withoutParen + ')';
            atomicValues.add(withoutParen);
            atomicValues.add(withParen);
        }
    }
    const formatValue = (value: CLValue, indentPos: number, parmName?: string, actualStartPos?: number): string => {
        if (typeof value === 'string') return value;

        // DEBUG: Log CMD/CMDSTR parameter structure
        if (parmName === 'CMD' || parmName === 'CMDSTR') {
            console.log(`${parmName} parameter structure:`, JSON.stringify(value, null, 2));
            console.log(`${parmName} is array?`, Array.isArray(value));
            if (typeof value === 'object' && value !== null && 'type' in value) {
                console.log(`${parmName} type:`, (value as any).type);
            }
        }

        if (Array.isArray(value)) {
            // Legacy: array of arrays (Max>1 ELEM as nested arrays)
            if (value.length > 0 && Array.isArray(value[0])) {
                return value.map((v) => '(' + formatValue(v, indentPos + 1) + ')').join(' ');
            }
            // NEW: Multi-instance ELEM detection from syntax (all wrapped expressions)
            // If all values are expression objects with wrapped=true, treat as multi-instance
            // CHECK THIS BEFORE general expression handling to preserve wrapping
            const allWrapped = value.every((v: any) =>
                typeof v === 'object' && v !== null && 'wrapped' in v && v.wrapped === true);
            console.log(`[formatValue-array] parm=${parmName}, length=${value.length}, allWrapped=${allWrapped}`, value);
            if (value.length > 1 && allWrapped) {
                // Format each wrapped expression with parens
                console.log(`[formatValue-array] Formatting as multi-instance ELEM with wrapping`);
                return value.map((v: any) => {
                    // Preserve original token spacing by joining tokens directly (spaces are separate tokens)
                    const inner = v.tokens.map((t: CLToken) => t.value).join('');
                    return `(${inner})`;
                }).join(' ');
            }
            // NEW: array of expressions (each may have wrapped=true/false)
            if (value.length > 0 && value.every(isExpression)) {
                // For CMD/CMDSTR parameters, preserve parentheses wrapping for each expression
                // Don't treat as continuous stream - each expression is independent
                const isCmdParameter = parmName && (parmName.toUpperCase() === 'CMD' || parmName.toUpperCase() === 'CMDSTR');

                if (isCmdParameter) {
                    // Original behavior: format each expression independently and wrap if needed
                    // But be smart about spacing - don't add space before wrapped expression if
                    // previous expression was a keyword
                    const parts: string[] = [];
                    for (let i = 0; i < value.length; i++) {
                        const v = value[i];
                        const inner = formatValue(v, indentPos + 1, parmName);
                        const wrapped = (v as any).wrapped === true;
                        // IMPORTANT: When wrapped===true, the tokens already include parentheses
                        // (e.g., "(", "(", "value", ")", ")"), so formatValue returns them.
                        // Don't wrap again or we'll get (((value))) instead of ((value))
                        const formatted = inner;

                        // Check if we need a space before this part
                        if (i === 0) {
                            // First part, no space needed
                            parts.push(formatted);
                        } else {
                            // Check if current expression is wrapped (like "(value)")
                            // and previous expression ended with a keyword
                            const prevExpr = value[i - 1];
                            const prevTokens = prevExpr.tokens;
                            const prevLastToken = prevTokens[prevTokens.length - 1];
                            const prevEndsWithKeyword = prevLastToken.type === 'keyword';

                            // No space before wrapped expression if previous ended with keyword
                            if (wrapped && prevEndsWithKeyword) {
                                parts.push(formatted);
                            } else {
                                parts.push(' ' + formatted);
                            }
                        }
                    }
                    return parts.join('');
                }

                // For other parameters (like VALUE), collect all chunks for optimal line filling
                const allChunks: string[] = [];
                for (let i = 0; i < value.length; i++) {
                    const v = value[i];
                    const chunks = splitExpressionTokensForWrap(v.tokens);

                    // Add space separator between expressions (except before first)
                    if (i > 0 && allChunks.length > 0) {
                        // Space will be added during wrapping
                    }

                    // Add all chunks from this expression
                    allChunks.push(...chunks);
                }

                // Now wrap all chunks together as one continuous stream
                let expr = '';
                let lineLen = indentPos;

                for (let i = 0; i < allChunks.length; i++) {
                    const chunk = allChunks[i];
                    if (i === 0) {
                        expr += chunk;
                        lineLen += chunk.length;
                    } else {
                        // Add space separator between chunks
                        const spaceNeeded = 1;

                        if (lineLen + spaceNeeded + chunk.length > rightMargin) {
                            // Wrap to new line at continuation column
                            const eol = getEOL();
                            expr += `${eol}${' '.repeat(CONT_LINE_COL - 1)}${chunk}`;
                            lineLen = CONT_LINE_COL - 1 + chunk.length;
                        } else {
                            expr += ' ' + chunk;
                            lineLen += spaceNeeded + chunk.length;
                        }
                    }
                }
                return expr;
            }
            // Single grouped value (ELEM parameters like LOG, EXTRA, etc.)
            // Format elements on one line without internal breaks
            const elements = value.map(v => formatValue(v, indentPos + 1));
            return elements.join(' ');
        }

        if ('function' in value) {
            const args = value.args.map(a => formatValue(a, indentPos + 1));
            const singleLine = `${value.function}(${args.join(' ')})`;
            if (indentPos + singleLine.length <= rightMargin) {
                return singleLine;
            } else {
                const eol = getEOL();
                // Create properly formatted multi-line function call with continuation characters at line ends
                const formattedArgs: string[] = [];
                for (let i = 0; i < args.length; i++) {
                    const arg = args[i];
                    const isLast = i === args.length - 1;
                    const indentedArg = ' '.repeat(Math.max(0, CONT_LINE_COL - 1)) + arg;

                    if (isLast) {
                        formattedArgs.push(indentedArg);
                    } else {
                        formattedArgs.push(indentedArg + ' ' + continuationChar);
                    }
                }

                const closeParen = ' '.repeat(Math.max(0, indentPos - 1)) + ')';
                return `${value.function}(${eol}${formattedArgs.join(eol)}${eol}${closeParen}`;
            }
        }
        if ('type' in value && value.type === 'command_call') {
            const eol = getEOL();
            // DEBUG: Log nested command structure
            if (parmName === 'CMD' || parmName === 'CMDSTR') {
                console.log('Nested command:', value.name);
                console.log('Nested command params:', value.parameters.map((p: any) => ({
                    name: p.name,
                    value: typeof p.value === 'string' ? p.value : p.value
                })));
            }
            // Nested commands should always use CONT_LINE_COL for continuation lines, not indentPos
            return formatCL_SEU(value, label).replace(new RegExp(eol, 'g'), eol + ' '.repeat(CONT_LINE_COL - 1));
        }
        if ('type' in value && value.type === 'expression') {
            // Check if this is an atomic ELEM parameter that should NOT be broken into chunks
            // These parameters were marked as atomic earlier and should stay on one line
            if (parmName) {
                const tokens = value.tokens as Array<{type: string, value: string}>;
                const values = tokens.filter(t => t.type !== 'space').map(t => t.value);

                // Check if original tokens contain spaces between variables
                // If yes, preserve spaces. If no, join without spaces (for compound vars like &LIB_&FILE)
                const hasVariable = tokens.some(t => t.type === 'variable' || (t.type === 'value' && CL_VARIABLE_PATTERN.test(t.value)));
                const hasOperatorOrKeyword = tokens.some(t => t.type === 'keyword' || t.type === 'operator' || t.type === 'symbolic_value' || (t.type === 'value' && /^[*%]/.test(t.value)));
                const hasSpacesBetweenTokens = tokens.some(t => t.type === 'space');
                console.log(`[formatValue-atomicCheck] parm=${parmName}, hasVariable=${hasVariable}, hasOperatorOrKeyword=${hasOperatorOrKeyword}, hasSpaces=${hasSpacesBetweenTokens}, tokens=`, tokens.map(t => `${t.type}:${t.value}`));

                // Join logic:
                // 1. If has operators/keywords OR has spaces between tokens → join with spaces
                // 2. If only variables with NO spaces → join without spaces (compound var like &LIB_&FILE)
                const valueText = (hasVariable && !hasOperatorOrKeyword && !hasSpacesBetweenTokens) ? values.join('') : values.join(' ');
                console.log(`[formatValue-atomicCheck] valueText="${valueText}"`);

                const fullParam = parmName + '(' + valueText + ')';

                if (atomicValues.has(fullParam)) {
                    // This is an atomic ELEM - return all values on one line without wrapping
                    return valueText;
                }
            }

            const chunks = splitExpressionTokensForWrap(value.tokens);

            // DEBUG: Log chunks for VALUE parameter
            if (parmName === 'VALUE') {
                console.log('Chunks for VALUE:', chunks);
                console.log('IndentPos (for continuations):', indentPos);
                console.log('ActualStartPos (first line):', actualStartPos);
                console.log('Right margin:', rightMargin);
            }

            let expr = '';
            // Use actualStartPos for the first line if provided, otherwise use indentPos
            let lineLen = actualStartPos !== undefined ? actualStartPos : indentPos;

            // Reserve space for continuation character " +" (2 chars) on any line that might wrap
            // This ensures we don't exceed the margin when the continuation char is added later
            const continuationCharSpace = 2;
            const effectiveMargin = rightMargin - continuationCharSpace;

            // For CMD/CMDSTR parameters, preserve exact token spacing
            const isCmdParameter = parmName && (parmName.toUpperCase() === 'CMD' || parmName.toUpperCase() === 'CMDSTR');

            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                if (i === 0) {
                    // First chunk - just add it
                    expr += chunk;
                    lineLen += chunk.length;
                    if (parmName === 'VALUE') {
                        console.log(`Chunk ${i}: "${chunk}" (len=${chunk.length}), lineLen now: ${lineLen}`);
                    }
                } else {
                    // Subsequent chunks - add space separator and check if wrapping is needed
                    const spaceNeeded = 1; // Always add space between chunks

                    // Check if we're at the last chunk
                    const isLastChunk = (i === chunks.length - 1);
                    // Use effective margin (reserve space for " +") unless it's the last chunk
                    const marginToUse = isLastChunk ? rightMargin : effectiveMargin;

                    if (lineLen + spaceNeeded + chunk.length > marginToUse) {
                        // Wrap to new line at continuation column
                        const eol = getEOL();
                        expr += `${eol}${' '.repeat(CONT_LINE_COL - 1)}${chunk}`;
                        lineLen = CONT_LINE_COL - 1 + chunk.length;
                        if (parmName === 'VALUE') {
                            console.log(`Chunk ${i}: "${chunk}" (len=${chunk.length}) WRAPPED, lineLen now: ${lineLen}`);
                        }
                    } else {
                        // Fits on current line
                        expr += ' ' + chunk;
                        lineLen += spaceNeeded + chunk.length;
                        if (parmName === 'VALUE') {
                            console.log(`Chunk ${i}: "${chunk}" (len=${chunk.length}), lineLen now: ${lineLen}`);
                        }
                    }
                }
            }
            // If this expression was originally wrapped in parentheses, preserve them
            if ('wrapped' in value && value.wrapped === true) {
                return '(' + expr + ')';
            }
            return expr;
        }
        return '';
    };

    const labelPart = label
        ? padTo(LABEL_COL - 1, 0) + (label + ':').padEnd(CMD_COL - LABEL_COL + 1)
        : padTo(CMD_COL - 1, 0);

    let currentLine = labelPart + applyCase(node.name, keywordCase) + padTo(FIRST_PARAM_COL - 2, (labelPart + applyCase(node.name, keywordCase)).length);

    // Remove this block if you want strict column control, or adjust as needed
    // if (currentLine.length < FIRST_PARAM_COL) {
    //     currentLine += ' '.repeat(FIRST_PARAM_COL - currentLine.length);
    // }

    const linesOut: string[] = [];
    let firstParam = true;

    for (const [idx, parm] of node.parameters.entries()) {

        // Check if this is a positional parameter (internal __pos naming)
        const isPositional = parm.name.toLowerCase().startsWith('__pos');
        const keywordText = isPositional ? '' : applyCase(parm.name, keywordCase);

        // Calculate where the value will actually start on the current line
        // For named params: after "KEYWORD("
        // For positional params: right after current position
        const keywordPrefix = isPositional ? '' : keywordText + '(';
        const spaceBeforeParam = firstParam ? '' : ' ';

        // Calculate the actual starting position for the value on the first line
        let actualStartPos: number;
        if (wrapped && !firstParam) {
            // If we're wrapping to a new line, start at continuation column
            actualStartPos = CONT_LINE_COL - 1 + keywordPrefix.length;
        } else {
            // Otherwise, start after current line content plus the keyword prefix
            actualStartPos = currentLine.length + spaceBeforeParam.length + keywordPrefix.length;
        }

        const indentPos = idx === 0 ? FIRST_PARAM_COL : CONT_LINE_COL;
        const formattedValue = formatValue(parm.value, indentPos, parm.name, actualStartPos);
        const eol = getEOL();
        const valueLines = formattedValue.split(eol);
        const firstValueLine = valueLines[0];

        const parmStrFirstLine = isPositional
            ? // For positional params, preserve the value as-is (including parens for expressions)
              (firstValueLine.startsWith("'") || firstValueLine.startsWith("(") ? firstValueLine : applyCase(firstValueLine, keywordCase))
            : keywordText + '(' +
              (firstValueLine.startsWith("'") ? firstValueLine : applyCase(firstValueLine, keywordCase));

        // Check if we need to wrap to a new line before adding this parameter
        // Only wrap if adding this parameter (with closing paren) would exceed the margin
        let justWrapped = false;
        if (!firstParam) {
            const closingParen = isPositional ? '' : ')';
            const spaceBeforeParam = ' ';
            const estimatedParamLength = spaceBeforeParam.length + parmStrFirstLine.length + closingParen.length;
            const wouldExceedMargin = (currentLine.length + estimatedParamLength) > rightMargin;

// Check if this parameter is an ELEM group (expression object) that should be kept atomic
            const isElemExpression = typeof parm.value === 'object' && parm.value !== null &&
                'type' in parm.value && (parm.value as any).type === 'expression' && 'tokens' in parm.value;
            const isElemArray = Array.isArray(parm.value) && !('type' in parm.value);
            const isElemParameter = isElemExpression || isElemArray;

            // For ELEM parameters, construct the full text using the raw values (not firstValueLine)
            let fullParamText: string;
            if (isElemExpression) {
                // Extract non-space token values from expression object
                const tokens = (parm.value as any).tokens as Array<{type: string, value: string}>;
                const values = tokens.filter(t => t.type !== 'space').map(t => t.value);
                const valueText = values.join(' ');
                fullParamText = keywordText + '(' + valueText + ')';
            } else if (isElemArray) {
                // For array ELEM parameters, use formattedValue which handles wrapped expressions
                // formattedValue already includes proper wrapping from formatValue function
                fullParamText = keywordText + '(' + formattedValue + ')';
            } else {
                fullParamText = isPositional ? firstValueLine : keywordText + '(' + firstValueLine + ')';
            }

            const isAtomicElem = isElemParameter && atomicValues.has(fullParamText);

            // Wrap if:
            // 1. We would exceed margin AND we're already wrapping, OR
            // 2. This is an atomic ELEM parameter that won't fit on current line
            if (wouldExceedMargin && (wrapped || isAtomicElem)) {
                // Would exceed margin - wrap to new line
                linesOut.push(currentLine + ' ' + continuationChar);
                currentLine = ' '.repeat(CONT_LINE_COL - 1);
                justWrapped = true;
            }
        }

        // space between parameters
        // Don't add leading space if we just wrapped to a continuation line (already at correct column)
        let parmText = '';
        if (firstParam) {
            parmText = parmStrFirstLine;
        } else if (justWrapped) {
            parmText = parmStrFirstLine;  // No space - already at continuation column
        } else {
            parmText = ' ' + parmStrFirstLine;  // Normal case - add space between params
        }

        console.log(`[formatCL_SEU] param ${idx}: parmText="${parmText}" (starts with space: ${parmText[0] === ' '})`);

        const result = appendWrappedCLLine(
            currentLine,
            parmText,
            linesOut,
            rightMargin,
            indentPos,
            continuationChar,
            atomicValues
        );
        // Simply use the result as-is - appendWrappedCLLine handles indentation correctly
        currentLine = result.currentLine;
        wrapped = result.lineWrap;

        // Handle continuation lines from multi-line values
        // These are already formatted with proper indentation by formatValue, so just add them directly
        for (let i = 1; i < valueLines.length; i++) {
            if (!valueLines[i].trim()) continue;

            // Push current line with continuation character (trim trailing spaces first)
            linesOut.push(currentLine.trimEnd() + ' ' + continuationChar);
            // Use the pre-formatted line as-is - it already has correct indentation
            currentLine = valueLines[i];
            wrapped = true;
        }

        // Only add closing paren for named parameters, not positional
        if (!isPositional) {
            currentLine += ')';
        }
        firstParam = false;
    }

    linesOut.push(currentLine);

    // Append trailing comment if present with proper wrapping
    if (node.comment) {
        const lastIdx = linesOut.length - 1;
        let lastLine = linesOut[lastIdx];

        // Extract comment content between /* and */
        const commentMatch = node.comment.match(/^\/\*\s*(.*?)\s*\*\/$/);
        if (!commentMatch) {
            // Malformed comment, just append as-is if it fits
            const testLine = lastLine + ' ' + node.comment;
            if (testLine.length <= rightMargin) {
                linesOut[lastIdx] = testLine;
            } else {
                // Doesn't fit - add continuation and put comment on next line
                linesOut[lastIdx] = lastLine + ' ' + continuationChar;
                linesOut.push(' '.repeat(CONT_LINE_COL - 1) + node.comment);
            }
        } else {
            const commentContent = commentMatch[1];
            const testLine = lastLine + ' /* ' + commentContent + ' */';

            // Check if it fits on the same line
            if (testLine.length <= rightMargin) {
                linesOut[lastIdx] = testLine;
            } else {
                // Need to wrap comment - add continuation char and put comment on next line
                linesOut[lastIdx] = lastLine + ' ' + continuationChar;

                // Format comment on continuation line(s)
                const commentIndent = ' '.repeat(CONT_LINE_COL - 1);
                const fullComment = '/* ' + commentContent + ' */';

                // Check if full comment fits on one continuation line
                if ((commentIndent + fullComment).length <= rightMargin) {
                    linesOut.push(commentIndent + fullComment);
                } else {
                    // Comment needs wrapping across multiple lines
                    const words = commentContent.split(/\s+/);
                    let currentContent = '';
                    let commentLines: string[] = [];

                    for (let i = 0; i < words.length; i++) {
                        const word = words[i];
                        const isLastWord = i === words.length - 1;
                        const testContent = currentContent ? currentContent + ' ' + word : word;
                        const suffix = isLastWord ? ' */' : ' +';
                        const prefix = commentLines.length === 0 ? '/* ' : '';

                        if ((commentIndent + prefix + testContent + suffix).length <= rightMargin) {
                            currentContent = testContent;
                            if (isLastWord) {
                                // Last word fits - close the comment
                                commentLines.push(commentIndent + prefix + currentContent + ' */');
                            }
                        } else {
                            // Word doesn't fit - push current content and start new line
                            if (currentContent) {
                                commentLines.push(commentIndent + prefix + currentContent + ' +');
                            }
                            currentContent = word;
                            if (isLastWord) {
                                // Last word on its own line
                                commentLines.push(commentIndent + currentContent + ' */');
                            }
                        }
                    }

                    linesOut.push(...commentLines);
                }
            }
        }
    }

    const eol = getEOL();
    return linesOut.join(eol);
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
            // Check if this is a quoted string
            const isQuoted = val.startsWith("'") && val.endsWith("'");

            // Always treat short quoted strings as atomic (up to 50 chars to be safe)
            // This prevents breaking strings like '*FROMFILE', '*YES', etc.
            if (isQuoted && val.length <= 50) {
                values.add(val);
            }
            // Also treat unquoted short strings as atomic
            else if (!isQuoted && val.length <= 10) {
                values.add(val);
            }

            // Always treat numbers as atomic
            if (/^\d+$/.test(val)) values.add(val);
            // *symbol, %func, &var (check after removing quotes if present)
            const unquoted = isQuoted ? val.slice(1, -1) : val;
            if (/^[*%&]/.test(unquoted)) {
                values.add(val);
                console.log(`[collectAtomicValues] Added atomic value: ${val}`);
            }
        } else if (Array.isArray(val)) {
            val.forEach(walk);
        } else if ('function' in val) {
            val.args.forEach(walk);
        } else if ('type' in val && val.type === 'expression') {
            // Check if expression contains a variable token
            const hasVariable = val.tokens.some(t =>
                t.type === 'variable' ||
                (t.type === 'value' && CL_VARIABLE_PATTERN.test(t.value))
            );

            // Check if expression has operators or keywords
            const hasOperatorOrKeyword = val.tokens.some(t =>
                t.type === 'keyword' ||
                t.type === 'symbolic_value' ||
                (t.type === 'value' && /^[*%]/.test(t.value))
            );

            // ONLY treat simple variable expressions as atomic (no operators/keywords)
            // E.g., &LONGVAR_FIELDNAME is atomic, but &VAR *EQ '*FROM' is NOT
            if (hasVariable && !hasOperatorOrKeyword) {
                // This is a simple variable expression - keep it atomic
                const fullExpression = val.tokens.map(t => t.value).join('');
                values.add(fullExpression);
                console.log(`[collectAtomicValues] Added atomic value from simple variable expression: ${fullExpression}`);
            } else {
                // Complex expression or no variables - add individual atomic components
                // Add short quoted strings, numbers, and keywords as atomic
                for (const t of val.tokens) {
                    if (t.type === 'string' && t.value.length <= 50) {
                        // Quoted strings up to 50 chars are atomic
                        values.add(t.value);
                        console.log(`[collectAtomicValues] Added atomic quoted string: ${t.value}`);
                    } else if (t.type === 'value' && /^\d+$/.test(t.value)) {
                        values.add(t.value);
                    } else if (t.type === 'symbolic_value' || (t.type === 'value' && /^[*%]/.test(t.value))) {
                        // Keywords (*YES), built-in functions (%FUNC)
                        values.add(t.value);
                        console.log(`[collectAtomicValues] Added atomic symbolic value: ${t.value}`);
                    }
                }
            }
        } else if ('type' in val && val.type === 'command_call') {
            val.parameters.forEach(p => walk(p.value));
        }
    }

    walk(node);
    console.log(`[collectAtomicValues] Total atomic values collected: ${values.size}`);
    console.log(`[collectAtomicValues] Atomic values:`, Array.from(values));
    return values;
}

// ...existing code...

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
  let wrappedLine = false;
  let processedLength = 0; // Track how much of original text we've processed
  let continuingInsideQuote = false; // Track if we're continuing inside a quoted string from previous line

  const padTo = (col: number, fill = 0) =>
    (currentLine.length >= col ? '' : ' '.repeat(col - currentLine.length + fill));

  const lastNonSpaceChar = (s: string): string => {
    for (let i = s.length - 1; i >= 0; i--) {
      const ch = s[i];
      if (ch !== ' ' && ch !== '\t') return ch;
    }
    return '';
  };

  // Insert one boundary space when needed before appending remaining to currentLine
  const ensureBoundarySpace = (): void => {
    const tail = lastNonSpaceChar(currentLine);
    const head = remaining[0];
    if (!head) return;
    // Don’t add space at line start, after '(', or if a space already exists
    if (!tail || tail === '(' || tail === ' ' || head === ' ') return;
    remaining = ' ' + remaining;
  };

  // Helper to check if a position in the ORIGINAL text is inside a quoted string
  const isInsideQuotedString = (posInOriginal: number): boolean => {
    let quoteCount = 0;
    for (let i = 0; i < posInOriginal && i < text.length; i++) {
      if (text[i] === "'") {
        // Check for escaped quote ''
        if (i + 1 < text.length && text[i + 1] === "'") {
          i++; // Skip the escaped quote pair
        } else {
          quoteCount++;
        }
      }
    }
    return (quoteCount % 2 === 1);
  };

  // Before we start appending this chunk, normalize the boundary
  ensureBoundarySpace();

  while (remaining.length > 0) {
    const remainingLengthBefore = remaining.length; // Safety check for infinite loop
    const available = rightMargin - currentLine.length;

    // If it fits completely, append whole chunk
    if (remaining.length <= available) {
      currentLine += remaining;
      remaining = '';
      break;
    }

    // Check if we need to wrap due to continuation character
    // If the remaining text would fit but adding " +" would exceed the margin, wrap it
    if (remaining.length <= available - 2) { // -2 for " +"
      currentLine += remaining;
      remaining = '';
      break;
    }

    // Find last space within width, accounting for continuation character
    let breakAt = remaining.lastIndexOf(' ', available - 2); // -2 for " +"

    // FIRST: Check atomic values - they take precedence over everything else
    // Don't break inside atomic values - check if we're about to split an atomic parameter
    if (breakAt >= 0) {
      // Look for atomic values that would be split by this break
      // Sort by length (longest first) to match full expressions before their components
      const sortedAtomicValues = Array.from(atomicValues).sort((a, b) => b.length - a.length);
      console.log(`[tokenizeCL-wrap] Checking breakAt=${breakAt}, remaining="${remaining.substring(0, 60)}..."`);
      console.log(`[tokenizeCL-wrap] atomicValues in set:`, sortedAtomicValues);
      for (const atomicVal of sortedAtomicValues) {
        // Find where this atomic value starts in the remaining text
        const atomicStart = remaining.indexOf(atomicVal);
        if (atomicStart !== -1) {
          const atomicEnd = atomicStart + atomicVal.length;
          console.log(`[tokenizeCL-wrap] Checking atomic "${atomicVal.substring(0, 30)}..." at pos ${atomicStart}-${atomicEnd}`);

          // Special handling for wrapped ELEM expressions like (*KEYWORD 'long string')
          // These can be broken inside the quoted string if the string is long
          const isWrappedElem = atomicVal.match(/^\(\*[A-Z]+\s+'.*'\)$/);
          if (isWrappedElem && breakAt > atomicStart && breakAt < atomicEnd) {
            // Find where the quoted string starts within the atomic value
            const quoteStartInAtomic = atomicVal.indexOf("'");
            const quoteEndInAtomic = atomicVal.lastIndexOf("'");
            const stringLength = quoteEndInAtomic - quoteStartInAtomic + 1;

            // Calculate absolute position in remaining text
            const absoluteQuoteStart = atomicStart + quoteStartInAtomic;
            const absoluteQuoteEnd = atomicStart + quoteEndInAtomic;

            console.log(`[tokenizeCL] Wrapped ELEM detected, string length=${stringLength}, breakAt=${breakAt}, quoteRange=${absoluteQuoteStart}-${absoluteQuoteEnd}`);

            if (breakAt > absoluteQuoteStart && breakAt < absoluteQuoteEnd) {
              // Break is inside the quoted string - allow it
              // For wrapped ELEM, we allow breaking inside the string regardless of length
              // because keeping the keyword with the opening quote is more important
              console.log(`[tokenizeCL] Allowing break inside quoted string within wrapped ELEM at position ${breakAt}`);
              // breakAt stays as is - stop checking other atomic values
              break;
            } else if (breakAt <= absoluteQuoteStart) {
              // Break is before the string - don't allow breaking between keyword and string
              console.log(`[tokenizeCL] Break would separate keyword from string in wrapped ELEM`);
              if (atomicStart > 0) {
                const spaceBeforeAtomic = remaining.lastIndexOf(' ', atomicStart - 1);
                if (spaceBeforeAtomic >= 0) {
                  console.log(`[tokenizeCL] Moving breakAt from ${breakAt} to ${spaceBeforeAtomic} (before wrapped ELEM)`);
                  breakAt = spaceBeforeAtomic;
                } else {
                  breakAt = -1;
                }
              } else {
                breakAt = -1;
              }
              break;
            }
            // If breakAt is after the string (between closing quote and closing paren),
            // fall through to regular atomic value handling
          }

          // Regular atomic value handling (not wrapped ELEM or short wrapped ELEM)
          if (breakAt > atomicStart && breakAt < atomicEnd) {
            console.log(`[tokenizeCL] Preventing break inside atomic value: "${atomicVal}"`);
            console.log(`[tokenizeCL] atomicStart=${atomicStart}, atomicEnd=${atomicEnd}, breakAt=${breakAt}`);
            console.log(`[tokenizeCL] remaining text: "${remaining.substring(0, 50)}..."`);
            // Try to find a space before this atomic value
            if (atomicStart > 0) {
              const spaceBeforeAtomic = remaining.lastIndexOf(' ', atomicStart - 1);
              if (spaceBeforeAtomic >= 0) {
                console.log(`[tokenizeCL] Moving breakAt from ${breakAt} to ${spaceBeforeAtomic} (space before atomic)`);
                breakAt = spaceBeforeAtomic;
              } else {
                console.log(`[tokenizeCL] No space before atomic value, setting breakAt=-1`);
                // No space before - wrap entire remaining text to next line
                breakAt = -1;
              }
            } else {
              console.log(`[tokenizeCL] Atomic value at start, setting breakAt=-1`);
              // Atomic value is at start of remaining - can't break it
              breakAt = -1;
            }
            break;
          }
        }
      }
    }

    // SECOND: Check if break point would split a quoted string (but only if not already inside atomic value)
    // Scan remaining text for quoted strings and protect ALL of them (not just <= 10 chars)
    if (breakAt >= 0) {
      let inQuote = false;
      let quoteStart = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i] === "'") {
          if (!inQuote) {
            inQuote = true;
            quoteStart = i;
          } else {
            // Check if it's an escaped quote ''
            if (i + 1 < remaining.length && remaining[i + 1] === "'") {
              i++; // Skip the escaped quote
            } else {
              // End of quoted string - check if breakAt would split it
              const quoteEnd = i; // Position of closing quote
              const stringLength = quoteEnd - quoteStart + 1;

              if (breakAt > quoteStart && breakAt <= quoteEnd) {
                // Break point is inside this quoted string
                console.log(`[tokenizeCL] Break inside quoted string: breakAt=${breakAt}, quoteStart=${quoteStart}, quoteEnd=${quoteEnd}, length=${stringLength}`);

                // If it's a LONG string (>= 50 chars), allow breaking at the space inside it
                if (stringLength >= 50) {
                  console.log(`[tokenizeCL] Long string - allowing break at space inside quote at position ${breakAt}`);
                  // breakAt stays as is - we'll break at this space inside the string
                } else {
                  // Short string - try to keep it atomic by moving break before it
                  console.log(`[tokenizeCL] Short string - moving break before quote`);
                  if (quoteStart > 0) {
                    const spaceBeforeQuote = remaining.lastIndexOf(' ', quoteStart - 1);
                    if (spaceBeforeQuote >= 0) {
                      breakAt = spaceBeforeQuote;
                      console.log(`[tokenizeCL] Moved breakAt before quote to position ${breakAt}`);
                    } else {
                      breakAt = -1; // No space before quote, wrap entire line
                      console.log(`[tokenizeCL] No space before quote, setting breakAt=-1`);
                    }
                  } else {
                    breakAt = -1; // Quote at start, can't break it
                    console.log(`[tokenizeCL] Quote at start, setting breakAt=-1`);
                  }
                }
                break; // Stop scanning
              }
              inQuote = false;
            }
          }
        }
      }
    }

    // Avoid breaking immediately after KEYWORD(
    for (const val of atomicValues) {
      if (!val.endsWith('(')) continue;
      const idx = remaining.indexOf(val);
      if (idx !== -1 && breakAt === idx + val.length - 1) {
        // emit line and continue on next
        linesOut.push(currentLine + ' ' + continuationChar);
        currentLine = ' '.repeat(indentCol - 1);
        wrappedLine = true;
        ensureBoundarySpace();
        breakAt = -2; // signal to continue
        break;
      }
    }
    if (breakAt === -2) continue;

    // If no safe space found, handle carefully to avoid infinite loops
    if (breakAt === -1 || breakAt === 0) {
      if (breakAt === 0) {
        // Leading space found
        // If currentLine is empty (at line start), skip the space
        // Otherwise, we need to keep the space for proper separation
        if (currentLine.trim().length === 0) {
          // At line start - skip leading space
          processedLength += 1;
          remaining = remaining.slice(1);
          continue;
        } else {
          // Not at line start - append the space and continue looking for next break
          currentLine += ' ';
          processedLength += 1;
          remaining = remaining.slice(1);
          continue;
        }
      }

      // breakAt === -1: No space found for safe breaking
      // This means the entire remaining text is atomic or has no spaces
      // We MUST make progress to avoid infinite loop

      // If remaining text will fit on a fresh line, wrap now
      const freshLineAvailable = rightMargin - indentCol;
      if (remaining.length <= freshLineAvailable) {
        // Text fits on next line - wrap current line and continue
        // Use space before continuation since we haven't broken mid-word
        linesOut.push(currentLine + ' ' + continuationChar);
        currentLine = ' '.repeat(indentCol - 1);
        wrappedLine = true;
        // Remove any leading space from remaining to prevent extra indentation
        remaining = remaining.trimStart();
        // DON'T call ensureBoundarySpace() here - it can add a space to remaining
        // which causes infinite loop. Fresh line doesn't need boundary space.
        continue;
      }

      // Remaining won't fit even on fresh line - this is a problem
      // We must force progress by taking what we can
      // This handles extremely long atomic values (like very long quoted strings)

      // CRITICAL: Don't break short quoted strings
      // Check if remaining text starts with a quoted string
      let quotedStringAtStart = null;
      if (remaining[0] === "'") {
        let i = 1;
        let stringContent = "'";
        while (i < remaining.length) {
          stringContent += remaining[i];
          if (remaining[i] === "'") {
            // Check if escaped
            if (i + 1 < remaining.length && remaining[i + 1] === "'") {
              stringContent += remaining[i + 1];
              i += 2;
            } else {
              // End of string
              i++;
              break;
            }
          } else {
            i++;
          }
        }
        quotedStringAtStart = { content: stringContent, length: i };
      }

      // If we have a short quoted string (< 30 chars) at the start, keep it atomic
      // Wrap to next line to avoid breaking it
      if (quotedStringAtStart && quotedStringAtStart.length < 30) {
        // Check if the string fits on a fresh line
        if (quotedStringAtStart.length <= freshLineAvailable) {
          // This quoted string is short enough to keep atomic
          // Wrap to next line and continue with the full string
          console.log(`[tokenizeCL] Wrapping short quoted string to next line: ${quotedStringAtStart.content}`);
          linesOut.push(currentLine + ' ' + continuationChar);
          currentLine = ' '.repeat(indentCol - 1);
          wrappedLine = true;
          // Remove any leading space from remaining to prevent extra indentation
          remaining = remaining.trimStart();
          continue;
        }
      }

      let mustTake = Math.max(1, available - 2); // Leave room for " +"

      // CRITICAL: Don't slice through a quoted string without spaces
      // Check if mustTake position is inside a quoted string
      let inQuote = false;
      let quoteStart = -1;
      for (let i = 0; i < mustTake && i < remaining.length; i++) {
        if (remaining[i] === "'") {
          if (!inQuote) {
            inQuote = true;
            quoteStart = i;
          } else {
            // Check if it's an escaped quote ''
            if (i + 1 < remaining.length && remaining[i + 1] === "'") {
              i++; // Skip the escaped quote
            } else {
              // End of quoted string
              inQuote = false;
            }
          }
        }
      }

      // If we're about to cut inside a quoted string, break mid-string
      // IBM i CL continuation inside quoted strings: NO space before +
      if (inQuote) {
        currentLine += remaining.slice(0, mustTake);
        processedLength += mustTake;
        remaining = remaining.slice(mustTake);
        // Mid-string break: append + WITHOUT space (CL string continuation syntax)
        linesOut.push(currentLine + continuationChar);
        currentLine = ' '.repeat(indentCol - 1);
        wrappedLine = true;
        continuingInsideQuote = true; // Mark that next line continues inside the same string
        // DON'T trim - we're inside a quoted string and spaces are significant content
        // Don't call ensureBoundarySpace() - we're continuing inside a string
        continue;
      }

      // Check if we're continuing from a previous line that was inside a quoted string
      if (continuingInsideQuote) {
        // Check if this chunk ends the quoted string
        let foundClosingQuote = false;
        for (let i = 0; i < mustTake && i < remaining.length; i++) {
          if (remaining[i] === "'") {
            // Check if it's an escaped quote ''
            if (i + 1 < remaining.length && remaining[i + 1] === "'") {
              i++; // Skip the escaped quote
            } else {
              // Found closing quote
              foundClosingQuote = true;
              continuingInsideQuote = false; // String ends in this chunk
              break;
            }
          }
        }

        // If we're still inside the string, use + without space
        currentLine += remaining.slice(0, mustTake);
        processedLength += mustTake;
        remaining = remaining.slice(mustTake);
        linesOut.push(currentLine + continuationChar);
        currentLine = ' '.repeat(indentCol - 1);
        wrappedLine = true;
        // If we didn't find the closing quote, we're still inside the string
        // continuingInsideQuote remains true
        // DON'T trim - we're inside a quoted string and spaces are significant content
        continue;
      }

      // Normal force-wrap when no space found and text won't fit on fresh line
      // (NOT inside quoted string - that case was handled above)
      // Use space before continuation for non-string breaks
      currentLine += remaining.slice(0, mustTake);
      processedLength += mustTake;
      remaining = remaining.slice(mustTake);
      linesOut.push(currentLine + ' ' + continuationChar);  // Space before + is IBM i standard
      currentLine = ' '.repeat(indentCol - 1);
      wrappedLine = true;
      // Remove any leading space from remaining to prevent extra indentation
      remaining = remaining.trimStart();
      // Don't call ensureBoundarySpace() here - it will be called at top of loop
      continue;
    }

    // Normal break at a space
    // Check if we're breaking inside a quoted string (string with embedded spaces)
    // Count quotes up to the break point
    let quoteCount = 0;
    for (let i = 0; i < breakAt; i++) {
      if (remaining[i] === "'") {
        // Check for escaped quote ''
        if (i + 1 < remaining.length && remaining[i + 1] === "'") {
          i++; // Skip the escaped quote pair
        } else {
          quoteCount++;
        }
      }
    }
    const breakingInsideQuote = (quoteCount % 2 === 1);

    if (breakingInsideQuote) {
      // Breaking inside a quoted string at a space
      // The space is part of the string content, so keep it before the +
      const chunk = remaining.slice(0, breakAt + 1);     // Include the space
      currentLine += chunk;
      linesOut.push(currentLine + continuationChar);     // No extra space before +
      remaining = remaining.slice(breakAt + 1);           // Skip the space we included
      continuingInsideQuote = true;
    } else {
      // Breaking between tokens at a space
      // The space is a separator, so use it for spacing before +
      const chunk = remaining.slice(0, breakAt);         // Don't include the space
      currentLine += chunk;
      linesOut.push(currentLine + ' ' + continuationChar); // Add space before +
      remaining = remaining.slice(breakAt + 1);           // Skip the separator space
      continuingInsideQuote = false;
    }
    wrappedLine = true;

    // Start next line - use indentCol directly for consistent alignment
    currentLine = ' '.repeat(indentCol - 1);

    // Update position in original text
    processedLength += breakAt + 1;
    // Note: remaining was already sliced in the if/else block above, don't slice again!

    // When breaking at a space between tokens, ensure boundary spacing
    // When breaking inside quotes, don't call this (continuingInsideQuote is true)
    if (!continuingInsideQuote) {
      ensureBoundarySpace();
    }

    // Safety check: ensure we made progress to prevent infinite loop
    if (remaining.length >= remainingLengthBefore) {
      console.error('[tokenizeCL] INFINITE LOOP DETECTED: remaining.length did not decrease');
      console.error('  remainingBefore:', remainingLengthBefore);
      console.error('  remainingAfter:', remaining.length);
      console.error('  remaining text:', remaining.substring(0, 50));
      // Force progress by taking at least 1 character
      processedLength += 1;
      remaining = remaining.slice(1);
    }
  }

  return { currentLine, lineWrap: wrappedLine };
}

// Quote-aware scan for KWD(...), skipping matches inside quoted strings and
// balancing parentheses so ')' inside strings don’t terminate the argument.
export function safeExtractKwdArg(cmd: string, kwd: string): string | null {
  const s = String(cmd ?? '');
  const kwdUpper = kwd.toUpperCase();

  // Walk once to find KWD( outside of quotes
  let inStr = false;
  let quote: "'" | '"' | '' = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    // Handle CL quoting: single quotes double to escape inside single-quoted strings
    if (inStr) {
      if (ch === quote) {
        // For single quotes, a doubled '' stays inside string
        if (quote === "'" && s[i + 1] === "'") {
          i++; // skip the escaped quote
        } else {
          inStr = false;
          quote = '';
        }
      }
      continue;
    } else {
      if (ch === "'" || ch === '"') {
        inStr = true;
        quote = ch as "'" | '"';
        continue;
      }
    }

    // Try to match KWD (case-insensitive) at this position, outside of strings
    if (ch.toUpperCase() === kwdUpper[0]) {
      let k = 0;
      while (k < kwdUpper.length && s[i + k] && s[i + k].toUpperCase() === kwdUpper[k]) k++;
      if (k === kwdUpper.length) {
        // Consume optional spaces then require '('
        let j = i + k;
        while (j < s.length && (s[j] === ' ' || s[j] === '\t')) j++;
        if (s[j] === '(') {
          // Extract balanced argument from j+1 to matching ')', skipping ')' inside strings
          let depth = 1;
          inStr = false;
          quote = '';
          let p = j + 1;
          while (p < s.length && depth > 0) {
            const c = s[p];
            if (inStr) {
              if (c === quote) {
                if (quote === "'" && s[p + 1] === "'") {
                  p += 2; // skip doubled single-quote
                  continue;
                } else {
                  inStr = false;
                  quote = '';
                }
              }
            } else {
              if (c === "'" || c === '"') {
                inStr = true;
                quote = c as "'" | '"';
              } else if (c === '(') {
                depth++;
              } else if (c === ')') {
                depth--;
                if (depth === 0) {
                  const arg = s.slice(j + 1, p);
                  return arg;
                }
              }
            }
            p++;
          }
          // Unbalanced: give up
          return null;
        }
      }
    }
  }
  return null;
}