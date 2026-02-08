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
    leftMargin: number;     // Starting column for command name (1-based, e.g., 14 = column 14)
    rightMargin: number;    // Maximum line length
    contIndent: number;     // Continuation line indent (1-based)
    continuationChar: string; // Usually '+'
    labelPosition?: number; // Optional: position for labels (1-based)
    kwdPosition?: number;   // Optional: position for first parameter (1-based). If 0, use one space after command
}

const DEFAULT_CONFIG: LayoutConfig = {
    leftMargin: 15,
    rightMargin: 80,
    contIndent: 25,
    continuationChar: '+'
};



/**
 * Convert a CL value into layout tokens
 */
function valueToLayoutTokens(value: CLValue, context: { inWrappedExpr?: boolean } = {}): LayoutToken[] {
    const tokens: LayoutToken[] = [];

    if (typeof value === 'string') {
        // Check if it's a long qualified name (contains / and is not quoted)
        const isQualifiedName = value.includes('/') && !value.startsWith("'") && !value.startsWith('"');

        if (isQualifiedName && value.length > 50) {
            // Long qualified name - split at slashes to allow breaking
            const parts = value.split('/');
            for (let i = 0; i < parts.length; i++) {
                const isLast = i === parts.length - 1;
                if (isLast) {
                    // Last part - just add it
                    tokens.push({ text: parts[i], type: 'text', atomic: true });
                } else {
                    // Not last - add part + slash as one unit with break-after
                    tokens.push({ text: parts[i] + '/', type: 'break-after', atomic: true });
                }
            }
            return tokens;
        }

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
                // Combine opening paren with first keyword to keep them together
                let firstToken = true;
                const exprTokens: LayoutToken[] = [];

                // Add expression tokens (from the expression's tokens array)
                for (const tok of v.tokens) {
                    if (tok.type === 'space') {
                        exprTokens.push({ text: ' ', type: 'space', atomic: false });
                        firstToken = false;
                    } else if (firstToken) {
                        // First token - combine with opening paren
                        exprTokens.push({ text: '(' + tok.value, type: 'text', atomic: true });
                        firstToken = false;
                    } else {
                        exprTokens.push({ text: tok.value, type: 'text', atomic: true });
                    }
                }

                // Combine closing paren with last token if it's a text token
                if (exprTokens.length > 0) {
                    const lastToken = exprTokens[exprTokens.length - 1];
                    if (lastToken.type === 'text' && lastToken.atomic) {
                        // Append closing paren to last token
                        lastToken.text += ')';
                        lastToken.type = 'break-after';
                    } else {
                        // Add closing paren separately
                        exprTokens.push({ text: ')', type: 'break-after', atomic: false });
                    }
                } else {
                    // Empty expression, just add closing paren
                    exprTokens.push({ text: ')', type: 'break-after', atomic: false });
                }

                tokens.push(...exprTokens);

                // Add space between instances (except after last)
                if (i < value.length - 1) {
                    tokens.push({ text: ' ', type: 'space', atomic: false });
                }
            }
            return tokens;
        }

        // Regular array - join with spaces, but check each item for wrapped flag
        for (let i = 0; i < value.length; i++) {
            const v = value[i];
            const isWrapped = typeof v === 'object' && v !== null && 'wrapped' in v && v.wrapped === true;

            // Add space before this item if:
            // - It's not the first item AND
            // - It's NOT a wrapped expression (wrapped expressions should directly follow the previous token)
            if (i > 0 && !isWrapped) {
                tokens.push({ text: ' ', type: 'space', atomic: false });
            }

            // Check if this specific item is a wrapped expression
            if (isWrapped) {
                // This item was wrapped in parens - output with parens
                const exprTokens: LayoutToken[] = [];
                let firstToken = true;

                // Add expression tokens (from the expression's tokens array)
                for (const tok of (v as any).tokens) {
                    if (tok.type === 'space') {
                        exprTokens.push({ text: ' ', type: 'space', atomic: false });
                        firstToken = false;
                    } else if (firstToken) {
                        // First token - combine with opening paren
                        exprTokens.push({ text: '(' + tok.value, type: 'text', atomic: true });
                        firstToken = false;
                    } else {
                        exprTokens.push({ text: tok.value, type: 'text', atomic: true });
                    }
                }

                // Combine closing paren with last token if it's a text token
                if (exprTokens.length > 0) {
                    const lastToken = exprTokens[exprTokens.length - 1];
                    if (lastToken.type === 'text' && lastToken.atomic) {
                        // Append closing paren to last token
                        lastToken.text += ')';
                    } else {
                        // Add closing paren separately
                        exprTokens.push({ text: ')', type: 'text', atomic: false });
                    }
                } else {
                    // Empty expression, just add closing paren
                    exprTokens.push({ text: ')', type: 'text', atomic: false });
                }

                tokens.push(...exprTokens);

                // Add space AFTER wrapped expression (except if it's the last item)
                if (i < value.length - 1) {
                    tokens.push({ text: ' ', type: 'space', atomic: false });
                }
            } else {
                // Not wrapped - output normally
                tokens.push(...valueToLayoutTokens(v, context));
            }
        }
        return tokens;
    }

    if ('type' in value && value.type === 'expression') {
        // Expression: convert tokens
        const expr = value as any;
        const exprTokens = expr.tokens as CLToken[];
        const layoutTokens: LayoutToken[] = [];

        for (let idx = 0; idx < exprTokens.length; idx++) {
            const tok = exprTokens[idx];

            if (tok.type === 'space') {
                layoutTokens.push({ text: '', type: 'space', atomic: false });
            } else if (tok.type === 'string') {
                // Quoted string - atomic
                layoutTokens.push({ text: tok.value, type: 'text', atomic: true });
            } else if (tok.type === 'paren_open') {
                layoutTokens.push({ text: tok.value, type: 'text', atomic: false });
            } else if (tok.type === 'paren_close') {
                // Try to combine with previous token if it's text
                if (layoutTokens.length > 0) {
                    const prevToken = layoutTokens[layoutTokens.length - 1];
                    if (prevToken.type === 'text' && prevToken.atomic) {
                        prevToken.text += tok.value;
                        prevToken.type = 'break-after';
                    } else {
                        layoutTokens.push({ text: tok.value, type: 'break-after', atomic: false });
                    }
                } else {
                    layoutTokens.push({ text: tok.value, type: 'break-after', atomic: false });
                }
            } else {
                // Keyword, symbolic value, number, operator, etc. - atomic
                layoutTokens.push({ text: tok.value, type: 'text', atomic: true });
            }
        }
        tokens.push(...layoutTokens);
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

    // For simple short string values, keep the entire parameter atomic
    if (typeof value === 'string' && value.length <= 40) {
        // Keep KEYWORD(value) together as one atomic unit
        tokens.push({
            text: name + '(' + value + ')',
            type: 'break-after',
            atomic: true
        });
        return tokens;
    }

    // For complex or long values, tokenize separately
    // Parameter name with opening paren - keep together
    tokens.push({
        text: name + '(',
        type: 'text',
        atomic: true
    });

    // Parameter value
    const valueTokens = valueToLayoutTokens(value);
    tokens.push(...valueTokens);

    // Closing paren - try to combine with last value token if possible
    if (valueTokens.length > 0) {
        const lastToken = valueTokens[valueTokens.length - 1];
        if (lastToken.type === 'text' && lastToken.atomic) {
            // Append closing paren to last token
            lastToken.text += ')';
            lastToken.type = 'break-after';
        } else {
            // Add closing paren separately
            tokens.push({
                text: ')',
                type: 'break-after',
                atomic: false
            });
        }
    } else {
        // No value tokens, just add closing paren
        tokens.push({
            text: ')',
            type: 'break-after',
            atomic: false
        });
    }

    return tokens;
}

/**
 * Check if a string is a quoted string literal, possibly with trailing closing parens
 * Returns the quoted part (without trailing parens) or null if not a quoted string
 */
function getQuotedStringPart(text: string): { quotedPart: string, suffix: string } | null {
    if (!text.startsWith("'") && !text.startsWith('"')) {
        return null;
    }

    const quote = text[0];
    // Find where the quoted part ends (last matching quote before any trailing parens)
    let lastQuotePos = -1;
    for (let i = text.length - 1; i >= 1; i--) {
        if (text[i] === quote) {
            lastQuotePos = i;
            break;
        }
        // If we hit something other than ), we didn't find the quote
        if (text[i] !== ')') {
            return null;
        }
    }

    if (lastQuotePos === -1) {
        return null;
    }

    return {
        quotedPart: text.substring(0, lastQuotePos + 1),
        suffix: text.substring(lastQuotePos + 1)
    };
}

/**
 * Check if a string is a quoted string literal
 */
function isQuotedString(text: string): boolean {
    return getQuotedStringPart(text) !== null;
}

/**
 * Find the best position to break a quoted string at a space
 */
function findStringBreakPoint(text: string, maxLen: number): number {
    // text is like "'some long string'"
    // We want to break at a space, but keep the opening quote
    // maxLen is how much we can fit

    if (maxLen <= 2) return -1; // Can't break a string that small

    // Search backwards from maxLen for a space
    for (let i = Math.min(maxLen - 1, text.length - 2); i >= 2; i--) {
        if (text[i] === ' ') {
            return i;
        }
    }

    // No space found, break at maxLen if possible
    if (maxLen < text.length - 1) {
        return maxLen;
    }

    return -1;
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
        let tokenText = token.text;
        const tokenLen = tokenText.length;

        // Look ahead - if upcoming tokens are just closing parens, include them in fit check
        // This prevents breaking before closing parens (keep "))" together with content)
        let lookaheadLen = tokenLen;
        let j = i + 1;
        while (j < tokens.length && tokens[j].text === ')') {
            lookaheadLen += tokens[j].text.length;
            j++;
        }

        // Check if a space will be added after current token
        let willAddSpace = false;
        if (token.type === 'space' || (token.type === 'break-after' && nextToken && nextToken.type !== 'space')) {
            const nextIsNoSpace = nextToken && nextToken.text === ')';
            if (nextToken && nextToken.type !== 'space' && !nextIsNoSpace && token.text.length === 0) {
                willAddSpace = true;
            }
        }
        const spaceLen = willAddSpace ? 1 : 0;

        // Special handling for parameter openings: if token ends with '(' and is atomic,
        // require room for at least some value content (10 chars buffer)
        // This prevents orphaned "KEYWORD( +" with values on next line
        let minRequired = lookaheadLen + spaceLen;
        if (token.atomic && tokenText.endsWith('(')) {
            // Skip over any space tokens to find the actual value token
            let k = i + 1;
            while (k < tokens.length && tokens[k].type === 'space') {
                k++;
            }
            // If there's a value token after the space(s), require room for it
            if (k < tokens.length) {
                minRequired = lookaheadLen + spaceLen + 10;
            }
        }

        const needsContinuation = currentLine.length > 0;
        // Only reserve continuation space if there are more tokens after our lookahead
        const hasMoreTokens = j < tokens.length;
        const continuationSpace = (needsContinuation && hasMoreTokens) ? 2 : 0; // " +"

        // Check if token is a quoted string that could be broken
        const isString = isQuotedString(tokenText);
        // For strings, check actual token length (not minRequired with lookahead)
        const actualTokenFits = currentCol + tokenLen + spaceLen + continuationSpace <= config.rightMargin;
        const tokenFits = currentCol + minRequired + continuationSpace <= config.rightMargin;

        // Decide if we need to do something (break string or wrap)
        let needsAction = false;
        if (isString) {
            // For strings, check if the actual token fits
            needsAction = currentCol > 0 && !actualTokenFits;
        } else {
            // For non-strings, check with minRequired (to avoid orphaning)
            needsAction = currentCol > 0 && !tokenFits;
        }

        if (needsAction) {
            // Token doesn't fit - check if we can break it (if it's a quoted string)
            const quotedInfo = getQuotedStringPart(tokenText);
            if (quotedInfo && quotedInfo.quotedPart.length > 10) {
                // Break the string across multiple lines if needed
                let remainingString = quotedInfo.quotedPart;
                const suffix = quotedInfo.suffix; // Save suffix (closing parens) to add at the very end
                let suffixAdded = false;

                // Loop to handle very long strings that need multiple breaks
                while (remainingString.length > 0) {
                    const availableSpace = config.rightMargin - currentCol - 1; // -1 for continuation char "+"

                    // If remaining string fits on current line, we're done with breaks
                    if (currentCol + remainingString.length + suffix.length <= config.rightMargin) {
                        tokenText = remainingString + suffix; // Add suffix on last part
                        suffixAdded = true;
                        break;
                    }

                    // Need to break - find break point
                    const breakPoint = findStringBreakPoint(remainingString, availableSpace);

                    if (breakPoint > 0) {
                        // Check if break point is at a space
                        const charAtBreak = remainingString[breakPoint];
                        const breakAtSpace = charAtBreak === ' ';

                        let firstPart;
                        if (breakAtSpace) {
                            // Include the space in first part
                            firstPart = remainingString.substring(0, breakPoint + 1);
                            remainingString = remainingString.substring(breakPoint + 1);
                        } else {
                            // Break mid-word
                            firstPart = remainingString.substring(0, breakPoint);
                            remainingString = remainingString.substring(breakPoint);
                        }

                        // Add first part and continue
                        currentLine += firstPart;
                        lines.push(currentLine + config.continuationChar);

                        // Start new line with continuation indent
                        currentLine = ' '.repeat(config.contIndent - 1);
                        currentCol = config.contIndent - 1;
                    } else {
                        // Can't break string further, wrap entire remaining part to next line
                        if (currentLine.trim().length > 0) {
                            lines.push(currentLine.trimEnd() + ' ' + config.continuationChar);
                            currentLine = ' '.repeat(config.contIndent - 1);
                            currentCol = config.contIndent - 1;
                        }
                        tokenText = remainingString + suffix;
                        suffixAdded = true;
                        break;
                    }
                }

                // Safety check: ensure suffix was added
                if (!suffixAdded && remainingString.length === 0) {
                    tokenText = suffix;
                } else if (!suffixAdded) {
                    // This shouldn't happen, but just in case
                    tokenText = remainingString + suffix;
                }
            } else {
                // Not a breakable string, wrap to next line
                if (currentLine.trim().length > 0) {
                    lines.push(currentLine.trimEnd() + ' ' + config.continuationChar);
                    currentLine = ' '.repeat(config.contIndent - 1);
                    currentCol = config.contIndent - 1;
                }
            }
        }

        // Add token (or remaining part) to current line
        currentLine += tokenText;
        currentCol += tokenText.length;

        // Handle spaces
        if (token.type === 'space' || (token.type === 'break-after' && nextToken && nextToken.type !== 'space')) {
            // Don't add space before closing paren
            const nextIsNoSpace = nextToken && nextToken.text === ')';

            // Add space after token (unless next is already a space or shouldn't have space)
            // But only if the token itself doesn't already contain text (positioning spaces have text)
            if (nextToken && nextToken.type !== 'space' && !nextIsNoSpace && token.text.length === 0) {
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
    let cmdStart: string;
    let leftPad: string;

    if (label) {
        // Position label at labelPosition, command at leftMargin
        const labelPos = finalConfig.labelPosition || 2;
        const labelPad = ' '.repeat(Math.max(0, labelPos - 1));
        // For label-only lines (empty cmdName and no parameters), don't add padding
        const cmdPad = (node.name === '' && node.parameters.length === 0)
            ? ''
            : ' '.repeat(Math.max(0, finalConfig.leftMargin - (labelPos + label.length + 1)));
        cmdStart = `${labelPad}${label}:${cmdPad}${node.name}`;
        leftPad = '';
    } else {
        // No label, just position command at leftMargin
        cmdStart = node.name;
        leftPad = ' '.repeat(Math.max(0, finalConfig.leftMargin - 1));
    }

    // Add command name WITHOUT trailing space (we'll position first param explicitly)
    tokens.push({
        text: leftPad + cmdStart,
        type: 'text',
        atomic: true
    });

    // Parameters
    for (let i = 0; i < node.parameters.length; i++) {
        const param = node.parameters[i];

        if (i === 0) {
            // First parameter: position at kwdPosition (or 1 space after command if kwdPosition=0)
            const kwdPos = finalConfig.kwdPosition || 0;
            if (kwdPos === 0) {
                // One space after command name
                tokens.push({ text: ' ', type: 'space', atomic: false });
            } else {
                // Calculate spacing to reach kwdPosition
                // Token text is leftPad + cmdStart, after that the next char is at position (length + 1)
                const tokenLength = (leftPad + cmdStart).length;
                const nextCharPos = tokenLength + 1;
                const spacesNeeded = Math.max(1, kwdPos - nextCharPos);
                tokens.push({ text: ' '.repeat(spacesNeeded), type: 'space', atomic: false });
            }
        } else {
            // Subsequent parameters: just add a space
            tokens.push({ text: '', type: 'space', atomic: false });
        }

        tokens.push(...parameterToLayoutTokens(param.name, param.value));
    }

    // Lay out tokens
    const lines = layoutTokens(tokens, finalConfig);

    // Add comment if present
    if (node.comment) {
        const lastLineIdx = lines.length - 1;
        const lastLine = lines[lastLineIdx];
        const trimmedLine = lastLine.trimEnd();
        const commentWithSpace = ' ' + node.comment;

        // Check if comment fits on the same line (use trimmed line for accurate length)
        if (trimmedLine.length + commentWithSpace.length <= finalConfig.rightMargin) {
            // Comment fits on same line
            lines[lastLineIdx] = trimmedLine + commentWithSpace;
        } else {
            // Comment doesn't fit entirely - need to analyze further
            const commentIndent = ' '.repeat(finalConfig.contIndent - 1);

            // Extract comment text (strip opening and closing markers)
            const commentText = node.comment.replace(/^\/\*\s*/, '').replace(/\s*\*\/$/, '').trim();

            // Check if reconstructing comment with proper spacing would fit
            const openMarker = ' /* ';
            const closeMarker = ' */';
            const fullCommentOneLine = trimmedLine + openMarker + commentText + closeMarker;

            if (fullCommentOneLine.length <= finalConfig.rightMargin) {
                // Comment fits entirely on the line with proper spacing
                lines[lastLineIdx] = fullCommentOneLine;
            } else {
                // Try to start comment on same line with command, wrapping remainder
                const contMarker = ' +';
                const availableOnFirstLine = finalConfig.rightMargin - trimmedLine.length - openMarker.length - contMarker.length;

                if (availableOnFirstLine > 10) {
                    // Enough room to start comment on same line

                    // Find break point in comment text
                    let breakPoint = commentText.lastIndexOf(' ', availableOnFirstLine);
                    if (breakPoint <= 0) {
                        breakPoint = Math.min(availableOnFirstLine, commentText.length);
                    }

                    const firstPart = commentText.substring(0, breakPoint).trim();
                    const remainingText = commentText.substring(breakPoint).trim();

                    if (remainingText.length === 0) {
                        // All comment fits on first line
                        lines[lastLineIdx] = trimmedLine + openMarker + firstPart + closeMarker;
                    } else {
                        // Comment spans multiple lines
                        lines[lastLineIdx] = trimmedLine + openMarker + firstPart + contMarker;

                    // Wrap remaining comment text
                    let textToWrap = remainingText;
                    while (textToWrap.length > 0) {
                        const closeMarker = ' */';
                        const contMarker = ' +';
                        const suffix = textToWrap.length <= finalConfig.rightMargin - commentIndent.length - 3 ? closeMarker : contMarker;
                        const availableSpace = finalConfig.rightMargin - commentIndent.length - suffix.length;

                        if (textToWrap.length <= availableSpace) {
                            // Remaining text fits
                            lines.push(commentIndent + textToWrap + closeMarker);
                            break;
                        }

                        // Find break point
                        let bp = textToWrap.lastIndexOf(' ', availableSpace);
                        if (bp <= 0) {
                            bp = availableSpace;
                        }

                        const line = textToWrap.substring(0, bp).trim();
                        textToWrap = textToWrap.substring(bp).trim();
                        lines.push(commentIndent + line + ' +');
                    }
                }
                } else {
                    // Not enough room to start comment on same line - check if continuation fits
                    if (trimmedLine.length + 2 > finalConfig.rightMargin) {
                        // Need to break line before adding continuation
                        const maxLen = finalConfig.rightMargin - 2;
                            let breakPoint = trimmedLine.lastIndexOf(' ', maxLen);

                        if (breakPoint > finalConfig.contIndent) {
                            const firstPart = trimmedLine.substring(0, breakPoint);
                            const secondPart = trimmedLine.substring(breakPoint + 1);

                            lines[lastLineIdx] = firstPart + ' ' + finalConfig.continuationChar;
                            lines.push(commentIndent + secondPart + ' ' + finalConfig.continuationChar);
                        } else {
                            lines[lastLineIdx] = trimmedLine + ' ' + finalConfig.continuationChar;
                        }
                    } else {
                        lines[lastLineIdx] = trimmedLine + ' ' + finalConfig.continuationChar;
                    }

                    // Add comment on next line(s)
                    const commentLine = commentIndent + node.comment;
                    if (commentLine.length > finalConfig.rightMargin) {
                        // Wrap comment across multiple lines
                        let textToWrap = commentText;
                        let isFirstCommentLine = true;

                        while (textToWrap.length > 0) {
                            const prefix = isFirstCommentLine ? '/* ' : '';
                            const availableSpace = finalConfig.rightMargin - commentIndent.length - prefix.length - 3; // -3 for closing marker or continuation

                            if (textToWrap.length + prefix.length + 3 <= availableSpace) {
                                lines.push(commentIndent + prefix + textToWrap + ' */');
                                break;
                            }

                            let bp = textToWrap.lastIndexOf(' ', availableSpace);
                            if (bp <= 0) {
                                bp = availableSpace;
                            }

                            const line = textToWrap.substring(0, bp).trim();
                            textToWrap = textToWrap.substring(bp).trim();

                            if (isFirstCommentLine) {
                                lines.push(commentIndent + '/* ' + line + ' +');
                                isFirstCommentLine = false;
                            } else {
                                const ending = textToWrap.length > 0 ? ' +' : ' */';
                                lines.push(commentIndent + line + ending);
                            }
                        }
                    } else {
                        lines.push(commentLine);
                    }
                }
            }
        }
    }

    return lines.join('\n');
}

