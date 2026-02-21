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
