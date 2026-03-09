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

/**
 * Mock vscode module for testing
 */

// Mock workspace configuration
const mockConfig = {
    get(key: string, defaultValue?: any): any {
        const defaults:any = {
            'formatRightMargin': 70,
            'convertCmdAndParmNameCase': '*UPPER',
            'formatLabelPosition': 2,
            'formatCmdPosition': 14,
            'formatKwdPosition': 25,
            'formatContinuePosition': 27
        };
        return key in defaults ? defaults[key] : defaultValue;
    }
};

export const workspace = {
    getConfiguration(section: string) {
        return mockConfig;
    }
};

// Export empty objects for other vscode APIs that might be imported
export const window = {};
export const commands = {};
export const languages = {};
export const Uri = {};
export const Range = {};
export const Position = {};
export const Location = {};
export const Diagnostic = {};
export const DiagnosticSeverity = {};
