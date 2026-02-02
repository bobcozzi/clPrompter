// Split a string into top-level parenthesized groups, preserving all content inside each group
// Example: INCREL((*IF IMDEL *EQ 'A') (*OR IMDEL *EQ ' ')) => ["(*IF IMDEL *EQ 'A')", "(*OR IMDEL *EQ ' ')"]
export function splitTopLevelParenGroups(str: string): string[] {
    const groups: string[] = [];
    let current = '';
    let depth = 0;
    let inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
        if (!inSingle && !inDouble) {
            if (c === '(') {
                if (depth === 0 && current.trim().length > 0) {
                    groups.push(current.trim());
                    current = '';
                }
                depth++;
            } else if (c === ')') {
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
export const CL_DATA_TYPES: string[] = [
    'DEC', 'LGL', 'CHAR', 'INT2', 'INT4', 'UINT2', 'UINT4', 'NAME', 'GENERIC', 'VARNAME',
    'DATE', 'TIME', 'CMD', 'X', 'ZEROELEM', 'NULL', 'CMDSTR', 'PNAME', 'SNAME', 'CNAME'
];

// ✅ Container/structure Types (not actual data types)
export const CL_CONTAINER_TYPES: string[] = [
    'ELEM', 'QUAL'
];

// ✅ Check if a type is a valid data type
export function isValidDataType(type: string | null | undefined): boolean {
    return CL_DATA_TYPES.includes((type || '').toUpperCase());
}

// ✅ Check if a type is a container type
export function isContainerType(type: string | null | undefined): boolean {
    return CL_CONTAINER_TYPES.includes((type || '').toUpperCase());
}

// ✅ Check if a type needs special handling
export function getTypeCategory(type: string | null | undefined): 'DATA_TYPE' | 'CONTAINER' | 'UNKNOWN' {
    const upperType = (type || '').toUpperCase();
    if (CL_DATA_TYPES.includes(upperType)) {
        return 'DATA_TYPE';
    } else if (CL_CONTAINER_TYPES.includes(upperType)) {
        return 'CONTAINER';
    } else {
        return 'UNKNOWN';
    }
}

export function splitUnquotedSlash(str: string): string[] {
    const result: string[] = [];
    let current = '';
    let inSingle = false, inDouble = false;
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        if (c === "'" && !inDouble) inSingle = !inSingle;
        else if (c === '"' && !inSingle) inDouble = !inDouble;
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

export function splitCLQual(val: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingle = false, inDouble = false, parenDepth = 0;
    for (let i = 0; i < val.length; i++) {
        const c = val[i];
        if (c === "'" && !inDouble) {
            inSingle = !inSingle;
        } else if (c === '"' && !inSingle) {
            inDouble = !inDouble;
        } else if (!inSingle && !inDouble) {
            if (c === '(') {
                parenDepth++;
            } else if (c === ')') {
                if (parenDepth > 0) parenDepth--;
            }
        }
        if (c === '/' && !inSingle && !inDouble && parenDepth === 0) {
            parts.push(current.trim());
            current = '';
        } else {
            current += c;
        }
    }
    if (current.length > 0) {
        parts.push(current.trim());
    }
    return parts;
}

// Default field lengths for IBM i CL data types (when no Len= attribute is present)
export const CL_TYPE_DEFAULT_LENGTHS: Record<string, number> = {
    'DEC': 15,
    'LGL': 80,  // Logical expressions can be complex, default to 80
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
export function getDefaultLengthForType(type: string | null | undefined): number {
    if (!type) return 10;
    const upper = type.replace('*', '').toUpperCase();
    return CL_TYPE_DEFAULT_LENGTHS[upper] || 10;
}

// ✅ Get CSS width class based on effective length
export function getLengthClass(effectiveLen: number): string {
    if (effectiveLen <= 6) return 'input-xs';
    if (effectiveLen <= 12) return 'input-sm';
    if (effectiveLen <= 25) return 'input-md';
    if (effectiveLen <= 50) return 'input-lg';
    if (effectiveLen <= 80) return 'input-xl';
    return 'input-full';
}

// --- CL Prompter formatting settings ---
// These should be settable in the extension's config UI and used in formatCL.ts
export function getCLPrompterFormatSettings(): {
    formatLabelPosition: number;
    formatCmdPosition: number;
    formatKwdPosition: number;
    formatContinuePosition: number;
    formatRightMargin: number;
} {
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
export function flattenParmValue(val: any): string[] {
    if (typeof val === "string") {
        return [val];
    }
    if (Array.isArray(val)) {
        if (val.length > 0 && Array.isArray(val[0])) {
            return val.map(sub =>
                Array.isArray(sub) ? sub.join("/") : sub
            );
        }
        return val;
    }
    return [];
}

// Parse a space-separated string, respecting quoted substrings
export function parseSpaceSeparatedValues(str: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        if (!inQuotes && (char === "'" || char === '"')) {
            inQuotes = true;
            quoteChar = char;
            current += char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            current += char;
        } else if (!inQuotes && /\s/.test(char)) {
            if (current.trim()) {
                values.push(current.trim());
                current = '';
            }
        } else {
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
 */
export function parseElemValues(str: string): string[] {
    const values: string[] = [];
    let current = '';
    let parenDepth = 0;
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
        const char = str[i];

        // Track quote state
        if (!inQuotes && (char === "'" || char === '"')) {
            inQuotes = true;
            quoteChar = char;
            current += char;
        } else if (inQuotes && char === quoteChar) {
            inQuotes = false;
            current += char;
        }
        // Track parentheses depth (only when not in quotes)
        else if (!inQuotes && char === '(') {
            parenDepth++;
            current += char;
        } else if (!inQuotes && char === ')') {
            parenDepth--;
            current += char;
        }
        // Split on space only when not in quotes and at depth 0
        else if (!inQuotes && parenDepth === 0 && /\s/.test(char)) {
            if (current.trim()) {
                values.push(current.trim());
                current = '';
            }
        } else {
            current += char;
        }
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
export function parseParenthesizedContent(str: string): string[] {
    let trimmed = str.trim();

    // Strip outer parentheses if present
    if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        trimmed = trimmed.substring(1, trimmed.length - 1).trim();
    }

    // Now split on spaces, respecting quotes
    return parseElemValues(trimmed);
}

export function parseCLCmd(cmd: string): Record<string, string[]> {
    // Remove command name
    const parts = cmd.trim().split(/\s+/);
    parts.shift();

    const result: Record<string, string[]> = {};
    let i = 0;
    while (i < parts.length) {
        let part = parts[i];
        const eqIdx = part.indexOf('(');
        if (eqIdx > 0) {
            // Parameter with parenthesis value
            const param = part.substring(0, eqIdx);
            let val = part.substring(eqIdx);
            // If value is split across tokens, join until closing paren
            while (val.split('(').length > val.split(')').length && i + 1 < parts.length) {
                i++;
                val += ' ' + parts[i];
            }
            val = val.replace(/^\(/, '').replace(/\)$/, '');
            // Split by spaces, but keep quoted strings together
            const vals = val.match(/'[^']*'|"[^"]*"|\S+/g) || [];
            result[param] = vals.map(v => v.replace(/^['"]|['"]$/g, ''));
        } else if (part.includes('(')) {
            // Handles case where param and value are split
            const param = part.replace(/\(.*/, '');
            let val = part.substring(part.indexOf('('));
            while (val.split('(').length > val.split(')').length && i + 1 < parts.length) {
                i++;
                val += ' ' + parts[i];
            }
            val = val.replace(/^\(/, '').replace(/\)$/, '');
            const vals = val.match(/'[^']*'|"[^"]*"|\S+/g) || [];
            result[param] = vals.map(v => v.replace(/^['"]|['"]$/g, ''));
        } else if (part.includes('=')) {
            // Not standard CL, but just in case
            const [param, val] = part.split('=');
            result[param] = [val];
        } else {
            // Parameter with single value
            const param = part;
            if (i + 1 < parts.length && !parts[i + 1].includes('(') && !parts[i + 1].includes('=')) {
                i++;
                result[param] = [parts[i].replace(/^['"]|['"]$/g, '')];
            }
        }
        i++;
    }
    return result;
}