import { collectCLCmdFromLine } from '../extractor';

type MockLine = { text: string };

type MockDoc = {
    lineCount: number;
    lineAt: (line: number) => MockLine;
};

function mockDocument(lines: string[]): MockDoc {
    return {
        lineCount: lines.length,
        lineAt: (line: number) => ({ text: lines[line] })
    };
}

function assertEqual(actual: string, expected: string): void {
    if (actual !== expected) {
        throw new Error(`Assertion failed.\nExpected: ${expected}\nActual:   ${actual}`);
    }
}

function run(): void {
    {
        const lines = [
            "             CHGVAR     VAR(&VALUE) VALUE('Corvette        Van        Explorer       Nova        Tesla')"
        ];
        const doc = mockDocument(lines);
        const result = collectCLCmdFromLine(doc as any, 0);

        assertEqual(
            result.command,
            "CHGVAR VAR(&VALUE) VALUE('Corvette        Van        Explorer       Nova        Tesla')"
        );
    }

    {
        const lines = [
            "             CHGVAR     VAR(&VALUE) VALUE('A''B        C')"
        ];
        const doc = mockDocument(lines);
        const result = collectCLCmdFromLine(doc as any, 0);

        assertEqual(
            result.command,
            "CHGVAR VAR(&VALUE) VALUE('A''B        C')"
        );
    }

    {
        const lines = [
            "             CHGVAR     VAR(&VALUE) VALUE('A''B        C  /* not comment */  D        E') /* real comment */"
        ];
        const doc = mockDocument(lines);
        const result = collectCLCmdFromLine(doc as any, 0);

        assertEqual(
            result.command,
            "CHGVAR VAR(&VALUE) VALUE('A''B        C  /* not comment */  D        E')"
        );

        assertEqual(
            result.comment || '',
            '/* real comment */'
        );
    }

    console.log('testQuotedWhitespacePreservation: all assertions passed');
}

run();
