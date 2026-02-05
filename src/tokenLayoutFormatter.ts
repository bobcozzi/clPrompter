/**
 * Token-based layout formatter for CL commands
 * 
 * Architecture:
 * 1. Parse command into atomic layout tokens
 * 2. Lay out tokens on lines respecting margins
 * 3. Simple rule: can break after '(' or ' ', never inside atomic tokens
 * 
 * Atomic tokens:
 * - Quoted strings: 'value'
 * - Keywords: KEYWORD
 * - Symbolic values: *VALUE
 * - Numbers: 123, 4.5
 * - Operators: + - * / = < > | &
 * - Opening parens WITH preceding keyword: KEYWORD(
 * - Closing parens: )
 * - Spaces: ' '
 * - Wrapped expressions: (*KEYWORD 'value')
 */

import { CLNode, CLToken, CLValue } from './types';

/**
 * A layout token is an atomic unit that cannot be broken during line wrapping
 */
interface LayoutToken {
    text: string;           // The actual text
    type: 'text' | 'space' | 'break-after';  // 'break-after' means can wrap after this token
    atomic: boolean;        // If true, this token must not be broken internally
}

/**
 * Layout configuration
 */
interface LayoutConfig {
    leftMargin: number;     // Starting column for command name (0-based)
    rightMargin: number;    // Maximum line length
    contIndent: number;     // Continuation line indent
    continuationChar: string; // Usually '+'
}

const DEFAULT_CONFIG: LayoutConfig = {
    leftMargin: 15,
    rightMargin: 80,
    contIndent: 26,
    continuationChar: '+'
};

/**
 * Convert a CL value into layout tokens
 */
function valueToLayoutTokens(value: CLValue, context: { inWrappedExpr?: boolean } = {}): LayoutToken[] {
    const tokens: LayoutToken[] = [];

    if (typeof value === 'string') {
        // Simple string value
        tokens.push({ text: value, type: 'text', atomic: true });
        return tokens;
    }

    if (Array.isArray(value)) {
        // Array of values
        // Check if all are wrapped expressions (multi-instance ELEM)
        const allWrapped = value.every((v: any) => 
            typeof v === 'object' && v !== null && 'wrapped' in v && v.wrapped === true
        );

        if (allWrapped && value.length > 1) {
            // Multi-instance ELEM: format each wrapped expression
            for (let i = 0; i < value.length; i++) {
                const v = value[i] as any;
                // Add opening paren
                tokens.push({ text: '(', type: 'text', atomic: false });
                // Add expression tokens (from the expression's tokens array)
                for (const tok of v.tokens) {
                    if (tok.type === 'space') {
                        tokens.push({ text: ' ', type: 'space', atomic: false });
                    } else {
                        tokens.push({ text: tok.value, type: 'text', atomic: true });
                    }
                }
                // Add closing paren
                tokens.push({ text: ')', type: 'break-after', atomic: false });
                
                // Add space between instances (except after last)
                if (i < value.length - 1) {
                    tokens.push({ text: ' ', type: 'space', atomic: false });
                }
            }
            return tokens;
        }

        // Regular array - join with spaces
        for (let i = 0; i < value.length; i++) {
            tokens.push(...valueToLayoutTokens(value[i], context));
            if (i < value.length - 1) {
                tokens.push({ text: ' ', type: 'space', atomic: false });
            }
        }
        return tokens;
    }

    if ('type' in value && value.type === 'expression') {
        // Expression: convert tokens
        const expr = value as any;
        const exprTokens = expr.tokens as CLToken[];
        
        for (const tok of exprTokens) {
            if (tok.type === 'space') {
                tokens.push({ text: ' ', type: 'space', atomic: false });
            } else if (tok.type === 'string') {
                // Quoted string - atomic
                tokens.push({ text: tok.value, type: 'text', atomic: true });
            } else if (tok.type === 'paren_open') {
                tokens.push({ text: tok.value, type: 'text', atomic: false });
            } else if (tok.type === 'paren_close') {
                // Can break after closing paren
                tokens.push({ text: tok.value, type: 'break-after', atomic: false });
            } else {
                // Keyword, symbolic value, number, etc. - atomic
                tokens.push({ text: tok.value, type: 'text', atomic: true });
            }
        }
        return tokens;
    }

    // Fallback: convert to string
    tokens.push({ text: String(value), type: 'text', atomic: true });
    return tokens;
}

/**
 * Convert a command parameter to layout tokens
 */
function parameterToLayoutTokens(name: string, value: CLValue): LayoutToken[] {
    const tokens: LayoutToken[] = [];
    
    // Parameter name with opening paren - keep together
    tokens.push({ 
        text: name + '(', 
        type: 'text', 
        atomic: true 
    });
    
    // Parameter value
    tokens.push(...valueToLayoutTokens(value));
    
    // Closing paren - can break after
    tokens.push({ 
        text: ')', 
        type: 'break-after', 
        atomic: false 
    });
    
    return tokens;
}

/**
 * Lay out tokens on lines
 */
function layoutTokens(tokens: LayoutToken[], config: LayoutConfig): string[] {
    const lines: string[] = [];
    let currentLine = '';
    let currentCol = 0;
    
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const nextToken = i + 1 < tokens.length ? tokens[i + 1] : null;
        
        // Calculate if token fits on current line
        const tokenLen = token.text.length;
        const needsContinuation = currentLine.length > 0;
        const continuationSpace = needsContinuation ? 2 : 0; // " +"
        
        // Check if we need to wrap
        if (currentCol > 0 && currentCol + tokenLen + continuationSpace > config.rightMargin) {
            // Token doesn't fit - wrap to next line
            if (currentLine.trim().length > 0) {
                lines.push(currentLine.trimEnd() + ' ' + config.continuationChar);
                currentLine = ' '.repeat(config.contIndent - 1);
                currentCol = config.contIndent - 1;
            }
        }
        
        // Add token to current line
        currentLine += token.text;
        currentCol += tokenLen;
        
        // Handle spaces
        if (token.type === 'space' || (token.type === 'break-after' && nextToken && nextToken.type !== 'space')) {
            // Add space after token (unless next is already a space)
            if (nextToken && nextToken.type !== 'space') {
                currentLine += ' ';
                currentCol += 1;
            }
        }
    }
    
    // Add final line
    if (currentLine.trim().length > 0) {
        lines.push(currentLine.trimEnd());
    }
    
    return lines;
}

/**
 * Format a CL command using token-based layout
 */
export function formatCLCommand_v2(node: CLNode, label?: string, config: Partial<LayoutConfig> = {}): string {
    const finalConfig = { ...DEFAULT_CONFIG, ...config };
    const tokens: LayoutToken[] = [];
    
    // Command name with label
    const cmdStart = label ? `${label}: ${node.name}` : node.name;
    const leftPad = ' '.repeat(Math.max(0, finalConfig.leftMargin - cmdStart.length));
    
    tokens.push({ 
        text: leftPad + cmdStart + ' ', 
        type: 'text', 
        atomic: true 
    });
    
    // Parameters
    for (let i = 0; i < node.parameters.length; i++) {
        const param = node.parameters[i];
        
        // Add space before parameter (except first)
        if (i > 0) {
            tokens.push({ text: ' ', type: 'space', atomic: false });
        }
        
        tokens.push(...parameterToLayoutTokens(param.name, param.value));
    }
    
    // Lay out tokens
    const lines = layoutTokens(tokens, finalConfig);
    
    // Add comment if present
    if (node.comment) {
        if (lines.length === 1 && lines[0].length + node.comment.length + 1 <= finalConfig.rightMargin) {
            // Comment fits on same line
            lines[0] += ' ' + node.comment;
        } else {
            // Comment on next line
            const commentIndent = ' '.repeat(finalConfig.contIndent - 1);
            lines.push(commentIndent + node.comment);
        }
    }
    
    return lines.join('\n');
}
