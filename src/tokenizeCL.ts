import * as vscode from 'vscode';
import { CLToken, CLNode, CLParsedParm, CLValue } from './types';

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

        // For ELEM parameters (expression objects), add the complete keyword+value as atomic to prevent internal breaks
        // ELEM parameters are stored as expression objects with tokens, not arrays
        if (typeof parm.value === 'object' && parm.value !== null && 'type' in parm.value &&
            (parm.value as any).type === 'expression' && 'tokens' in parm.value) {
            // Expression object - extract non-space token values and join them
            const tokens = (parm.value as any).tokens as Array<{type: string, value: string}>;
            const values = tokens.filter(t => t.type !== 'space').map(t => t.value);
            const valueText = values.join(' ');
            const withoutParen = applyCase(parm.name, keywordCase) + '(' + valueText;
            const withParen = withoutParen + ')';
            // Add both with and without closing paren (since appendWrappedCLLine gets text without closing paren)
            atomicValues.add(withoutParen);
            atomicValues.add(withParen);
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
                        const formatted = wrapped ? `(${inner})` : inner;

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
            // Legacy: array of arrays (Max>1 ELEM as nested arrays)
            if (value.length > 0 && Array.isArray(value[0])) {
                return value.map((v) => '(' + formatValue(v, indentPos + 1) + ')').join(' ');
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
                const valueText = values.join(' ');
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
                // Extract values from array
                const elements = (parm.value as Array<string | number | boolean>).map(v => typeof v === 'string' ? v : String(v));
                const valueText = elements.join(' ');
                fullParamText = keywordText + '(' + valueText + ')';
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
            // Malformed comment, just append as-is
            linesOut[lastIdx] = lastLine + ' ' + node.comment;
        } else {
            const commentContent = commentMatch[1];
            const testLine = lastLine + ' /* ' + commentContent + ' */';

            // Check if it fits on the same line
            if (testLine.length <= rightMargin) {
                linesOut[lastIdx] = testLine;
            } else {
                // Need to wrap comment to continuation lines
                const commentIndent = ' '.repeat(Math.max(0, CONT_LINE_COL - 1));
                const words = commentContent.split(/\s+/);

                // Try to fit some words on the last line
                const availableOnLastLine = rightMargin - lastLine.length - 4; // -4 for ' /* '

                if (availableOnLastLine > 10) {
                    // Start comment on this line
                    let firstLineContent = '';
                    let remainingWords: string[] = [];

                    for (let i = 0; i < words.length; i++) {
                        const word = words[i];
                        const testContent = firstLineContent ? firstLineContent + ' ' + word : word;
                        const isLastWord = i === words.length - 1;

                        // If this is the last word, check if it fits with */
                        // Otherwise, check if it fits with +
                        const suffix = isLastWord ? ' */' : ' +';
                        if ((' /* ' + testContent + suffix).length <= rightMargin - lastLine.length) {
                            firstLineContent = testContent;
                            if (!isLastWord) {
                                // Not the last word, so might have more
                                continue;
                            }
                        } else {
                            remainingWords = words.slice(i);
                            break;
                        }
                    }

                    if (remainingWords.length > 0) {
                        // Comment continues, don't close it yet
                        linesOut[lastIdx] = lastLine + ' /* ' + firstLineContent + ' +';

                        // Continue on next line(s)
                        let currentContent = '';
                        for (let i = 0; i < remainingWords.length; i++) {
                            const word = remainingWords[i];
                            const isLastWord = i === remainingWords.length - 1;
                            const testContent = currentContent ? currentContent + ' ' + word : word;
                            const suffix = isLastWord ? ' */' : ' +';

                            if ((commentIndent + testContent + suffix).length <= rightMargin) {
                                currentContent = testContent;
                                if (isLastWord) {
                                    // This is the last word and it fits - close comment
                                    linesOut.push(commentIndent + currentContent + ' */');
                                    break;
                                }
                            } else {
                                // Current content doesn't fit - output what we have and start fresh
                                if (currentContent) {
                                    linesOut.push(commentIndent + currentContent + ' +');
                                    currentContent = word;
                                    if (isLastWord) {
                                        // This word was too long for the previous line but is the last word
                                        linesOut.push(commentIndent + word + ' */');
                                        break;
                                    }
                                } else {
                                    // Even a single word is too long - just output it
                                    const suffix = isLastWord ? ' */' : ' +';
                                    linesOut.push(commentIndent + word + suffix);
                                    if (isLastWord) break;
                                }
                            }
                        }
                    } else {
                        // All content fit on first line
                        linesOut[lastIdx] = lastLine + ' /* ' + firstLineContent + ' */';
                    }
                } else {
                    // No room on last line, start fresh line
                    linesOut[lastIdx] = lastLine + ' +';

                    let currentContent = '';
                    for (let i = 0; i < words.length; i++) {
                        const word = words[i];
                        const isLastWord = i === words.length - 1;
                        const testContent = currentContent ? currentContent + ' ' + word : word;
                        const prefix = i === 0 ? '/* ' : '';
                        const suffix = isLastWord ? ' */' : ' +';

                        if ((commentIndent + prefix + testContent + suffix).length <= rightMargin) {
                            currentContent = testContent;
                            if (isLastWord) {
                                // This is the last word and it fits
                                linesOut.push(commentIndent + '/* ' + currentContent + ' */');
                                break;
                            }
                        } else {
                            // Current content doesn't fit - output what we have and start fresh
                            if (currentContent) {
                                const linePrefix = i <= 1 ? '/* ' : '';
                                linesOut.push(commentIndent + linePrefix + currentContent + ' +');
                                currentContent = word;
                                if (isLastWord) {
                                    // This word was too long for the previous line but is the last word
                                    linesOut.push(commentIndent + word + ' */');
                                    break;
                                }
                            } else {
                                // Even a single word is too long - just output it
                                const linePrefix = i === 0 ? '/* ' : '';
                                const suffix = isLastWord ? ' */' : ' +';
                                linesOut.push(commentIndent + linePrefix + word + suffix);
                                if (isLastWord) break;
                            }
                        }
                    }
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

  // Before we start appending this chunk, normalize the boundary
  ensureBoundarySpace();

  while (remaining.length > 0) {
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

    // Don't break inside atomic values - check if we're about to split an atomic parameter
    if (breakAt >= 0) {
      // Look for atomic values that would be split by this break
      for (const atomicVal of atomicValues) {
        // Find where this atomic value starts in the remaining text
        const atomicStart = remaining.indexOf(atomicVal);
        if (atomicStart !== -1) {
          const atomicEnd = atomicStart + atomicVal.length;
          // If the break point is inside this atomic value, move it before the atomic value
          if (breakAt > atomicStart && breakAt < atomicEnd) {
            // Try to find a space before this atomic value
            if (atomicStart > 0) {
              const spaceBeforeAtomic = remaining.lastIndexOf(' ', atomicStart - 1);
              if (spaceBeforeAtomic >= 0) {
                breakAt = spaceBeforeAtomic;
              } else {
                // No space before - wrap entire remaining text to next line
                breakAt = -1;
              }
            } else {
              // Atomic value is at start of remaining - can't break it
              breakAt = -1;
            }
            break;
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

    // If no safe space found, push current and continue
    if (breakAt === -1 || breakAt === 0) {
      // Hard wrap: push current line, continue building on next
      linesOut.push(currentLine + ' ' + continuationChar);
      currentLine = ' '.repeat(indentCol - 1);
      wrappedLine = true;
      // If breakAt was 0 (leading space), skip that space when continuing
      if (breakAt === 0) {
        remaining = remaining.slice(1); // Remove leading space
      }
      ensureBoundarySpace();
      continue;
    }

    // Normal break at a space
    const chunk = remaining.slice(0, breakAt);     // left side (no trailing space)
    currentLine += chunk;

    linesOut.push(currentLine + ' ' + continuationChar);
    wrappedLine = true;

    // Start next line - use indentCol directly for consistent alignment
    currentLine = ' '.repeat(indentCol - 1);

    // Keep remainder AFTER the split space, and ensure separation at boundary
    remaining = remaining.slice(breakAt + 1);
    ensureBoundarySpace();
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