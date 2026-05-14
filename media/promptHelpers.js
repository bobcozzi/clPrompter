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
// Split a string into top-level parenthesized groups, preserving all content inside each group
// Example: INCREL((*IF IMDEL *EQ 'A') (*OR IMDEL *EQ ' ')) => ["(*IF IMDEL *EQ 'A')", "(*OR IMDEL *EQ ' ')"]
export function splitTopLevelParenGroups(str) {
    const groups = [];
    let current = '';
    let depth = 0;
    let inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'" && !inDouble)
            inSingle = !inSingle;
        else if (c === '"' && !inSingle)
            inDouble = !inDouble;
        if (!inSingle && !inDouble) {
            if (c === '(') {
                if (depth === 0 && current.trim().length > 0) {
                    groups.push(current.trim());
                    current = '';
                }
                depth++;
            }
            else if (c === ')') {
                depth--;
            }
        }
        current += c;
        if (depth === 0 && (c === ')' || (i === str.length - 1 && current.trim().length > 0))) {
            groups.push(current.trim());
            current = '';
        }
    }
    return groups.filter(g => g.length > 0);
}
// ✅ Valid IBM i CL parameter data types
export const CL_DATA_TYPES = [
    'DEC', 'LGL', 'CHAR', 'INT2', 'INT4', 'UINT2', 'UINT4', 'NAME', 'GENERIC', 'VARNAME',
    'DATE', 'TIME', 'CMD', 'X', 'ZEROELEM', 'NULL', 'CMDSTR', 'PNAME', 'SNAME', 'CNAME'
];
// ✅ Container/structure Types (not actual data types)
export const CL_CONTAINER_TYPES = [
    'ELEM', 'QUAL'
];
// ✅ Check if a type is a valid data type
export function isValidDataType(type) {
    return CL_DATA_TYPES.includes((type || '').toUpperCase());
}
// ✅ Check if a type is a container type
export function isContainerType(type) {
    return CL_CONTAINER_TYPES.includes((type || '').toUpperCase());
}
// ✅ Check if a type needs special handling
export function getTypeCategory(type) {
    const upperType = (type || '').toUpperCase();
    if (CL_DATA_TYPES.includes(upperType)) {
        return 'DATA_TYPE';
    }
    else if (CL_CONTAINER_TYPES.includes(upperType)) {
        return 'CONTAINER';
    }
    else {
        return 'UNKNOWN';
    }
}
export function splitUnquotedSlash(str) {
    const result = [];
    let current = '';
    let inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'" && !inDouble)
            inSingle = !inSingle;
        else if (c === '"' && !inSingle)
            inDouble = !inDouble;
        else if (c === '/' && !inSingle && !inDouble) {
            result.push(current);
            current = '';
            continue;
        }
        current += c;
    }
    result.push(current);
    return result;
}
export function splitCLQual(val) {
    const parts = [];
    let current = '';
    let inSingle = false, inDouble = false, parenDepth = 0;
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        if (c === "'" && !inDouble) {
            inSingle = !inSingle;
        }
        else if (c === '"' && !inSingle) {
            inDouble = !inDouble;
        }
        else if (!inSingle && !inDouble) {
            if (c === '(') {
                parenDepth++;
            }
            else if (c === ')') {
                if (parenDepth > 0)
                    parenDepth--;
            }
        }
        if (c === '/' && !inSingle && !inDouble && parenDepth === 0) {
            parts.push(current.trim());
            current = '';
        }
        else {
            current += c;
        }
    }
    if (current.length > 0) {
        parts.push(current.trim());
    }
    return parts;
}
// Default field lengths for IBM i CL data types (when no Len= attribute is present)
export const CL_TYPE_DEFAULT_LENGTHS = {
    'DEC': 15,
    'LGL': 80, // Logical expressions can be complex, default to 80
    'CHAR': 32,
    'NAME': 10,
    'SNAME': 10,
    'CNAME': 10,
    'PNAME': 32,
    'GENERIC': 10,
    'HEX': 1,
    'X': 15,
    'VARNAME': 11,
    'CMD': 256,
    'CMDSTR': 256
};
// Get the default field length for a CL type (if no Len= attribute)
export function getDefaultLengthForType(type) {
    if (!type)
        return 10;
    const upper = type.replace('*', '').toUpperCase();
    return CL_TYPE_DEFAULT_LENGTHS[upper] || 10;
}
// ✅ Get CSS width class based on effective length
export function getLengthClass(effectiveLen) {
    if (effectiveLen <= 6)
        return 'input-xs';
    if (effectiveLen <= 12)
        return 'input-sm';
    if (effectiveLen <= 25)
        return 'input-md';
    if (effectiveLen <= 50)
        return 'input-lg';
    if (effectiveLen <= 80)
        return 'input-xl';
    return 'input-full';
}
// --- CL Prompter formatting settings ---
// These should be settable in the extension's config UI and used in formatCL.ts
export function getCLPrompterFormatSettings() {
    // Default settings; extension can send updates via webview messages
    return {
        formatLabelPosition: 2,
        formatCmdPosition: 14,
        formatKwdPosition: 25,
        formatContinuePosition: 27,
        formatRightMargin: 72
    };
}
// Flatten parameter value (for QUAL nodes)
export function flattenParmValue(val) {
    if (typeof val === "string") {
        return [val];
    }
    if (Array.isArray(val)) {
        if (val.length > 0 && Array.isArray(val[0])) {
            return val.map(sub => Array.isArray(sub) ? sub.join("/") : sub);
        }
        return val;
    }
    return [];
}
// Parse a space-separated string, respecting quoted substrings
export function parseSpaceSeparatedValues(str) {
    const values = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (!inQuotes && (char === "'" || char === '"')) {
            inQuotes = true;
            quoteChar = char;
            current += char;
        }
        else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            current += char;
        }
        else if (!inQuotes && /\s/.test(char)) {
            if (current.trim()) {
                values.push(current.trim());
                current = '';
            }
        }
        else {
            current += char;
        }
    }
    if (current.trim()) {
        values.push(current.trim());
    }
    return values;
}
/**
 * Parse ELEM values, respecting parentheses and quotes.
 * For simple values like "0 0 *SECLVL", splits on spaces.
 * For nested values like "(*BEFORE 'text') (*AFTER 'text')", preserves groups.
 *
 * Uses independent SQ/DQ boolean flags so that a single quote inside a
 * double-quoted string (and vice versa) does not toggle the opposing quote
 * state — consistent with IBM i CL quoting rules.
 */
export function parseElemValues(str) {
    const values = [];
    let current = '';
    let parenDepth = 0;
    let inSQ = false; // inside single-quoted string
    let inDQ = false; // inside double-quoted string
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        // Track quote state independently for each quote type.
        // A single quote inside a double-quoted string (and vice versa) does NOT toggle state.
        if (char === "'" && !inDQ) {
            inSQ = !inSQ;
            current += char;
            continue;
        }
        if (char === '"' && !inSQ) {
            inDQ = !inDQ;
            current += char;
            continue;
        }
        const inQuotes = inSQ || inDQ;
        // Track parentheses depth (only when not in quotes)
        if (!inQuotes && char === '(') {
            parenDepth++;
            current += char;
            continue;
        }
        if (!inQuotes && char === ')') {
            parenDepth--;
            current += char;
            continue;
        }
        // Split on whitespace only when not in quotes and at top-level depth
        if (!inQuotes && parenDepth === 0 && /\s/.test(char)) {
            if (current.trim()) {
                values.push(current.trim());
                current = '';
            }
            continue;
        }
        current += char;
    }
    if (current.trim()) {
        values.push(current.trim());
    }
    return values;
}
/**
 * Parse the content inside parentheses for nested ELEM groups.
 * E.g., "(*BEFORE 'text')" -> ["*BEFORE", "'text'"]
 * Strips outer parens and splits on spaces respecting quotes.
 */
export function parseParenthesizedContent(str) {
    let trimmed = str.trim();
    // Strip outer parentheses if present
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        trimmed = trimmed.substring(1, trimmed.length - 1).trim();
    }
    // Now split on spaces, respecting quotes
    return parseElemValues(trimmed);
}
// parseCLCmd has been removed — it was dead code (exported but never called).
// All CL command parsing is handled by parseCLParms() in parseCL.ts which correctly
// handles QUAL, ELEM, nested structures, multi-instance parameters, and quoted values.
//# sourceMappingURL=promptHelpers.js.map