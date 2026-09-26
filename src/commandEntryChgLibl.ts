function normalizeLibraryName(value: string | undefined): string | undefined {
    const normalized = String(value ?? '').trim().toUpperCase();
    if (!normalized || normalized.length > 10) {
        return undefined;
    }
    return /^[A-Z0-9_$#@]+$/.test(normalized) ? normalized : undefined;
}

function parseLibraryListEntries(libraryList: Iterable<string> | string[] | undefined): {
    userLibraries: string[];
    currentLibraryFromList?: string;
} {
    const entries = Array.from(typeof libraryList === 'string' ? libraryList.split(/\s+/) : libraryList ?? [])
        .map(value => String(value ?? '').trim())
        .filter(value => value.length > 0)
        .map(value => value.replace(/^"|"$/g, ''))
        .filter(value => value.length > 0);

    const userLibraries: string[] = [];
    const seen = new Set<string>();
    let currentLibraryFromList: string | undefined;

    const addUserLibrary = (value: string | undefined): void => {
        const normalized = normalizeLibraryName(value);
        if (!normalized || seen.has(normalized)) {
            return;
        }
        seen.add(normalized);
        userLibraries.push(normalized);
    };

    for (const entry of entries) {
        const normalized = entry.trim().toUpperCase();

        const typePrefixedMatch = /^(CURRENT|USER)\s*[:=|\-]\s*([A-Z0-9_$#@]{1,10})$/.exec(normalized);
        if (typePrefixedMatch) {
            if (typePrefixedMatch[1] === 'CURRENT') {
                currentLibraryFromList = typePrefixedMatch[2];
            } else {
                addUserLibrary(typePrefixedMatch[2]);
            }
            continue;
        }

        const typeSuffixedMatch = /^([A-Z0-9_$#@]{1,10})\s*[:=|\-]\s*(CURRENT|USER)$/.exec(normalized);
        if (typeSuffixedMatch) {
            if (typeSuffixedMatch[2] === 'CURRENT') {
                currentLibraryFromList = typeSuffixedMatch[1];
            } else {
                addUserLibrary(typeSuffixedMatch[1]);
            }
            continue;
        }

        addUserLibrary(normalized);
    }

    return {
        userLibraries,
        currentLibraryFromList
    };
}

function resolveEffectiveCurrentLibrary(
    currentLibrary: string | undefined,
    libraryList: Iterable<string> | string[] | undefined
): string | undefined {
    const explicitCurrentLibrary = normalizeLibraryName(currentLibrary);
    if (explicitCurrentLibrary) {
        return explicitCurrentLibrary;
    }

    return parseLibraryListEntries(libraryList).currentLibraryFromList;
}

export function buildChgLiblCommandFromLibraryList(
    command: string,
    libraryList: Iterable<string> | string[] | undefined,
    currentLibrary?: string
): string | undefined {
    const text = String(command ?? '').trim();
    if (!text) {
        return undefined;
    }

    const withoutLeadingQuestion = text.startsWith('?') ? text.slice(1).trimStart() : text;
    const trimmed = withoutLeadingQuestion.trim();
    if (!/^CHGLIBL\b/i.test(trimmed)) {
        return undefined;
    }

    const remainder = trimmed.replace(/^CHGLIBL\b/i, '').trim();
    const hasLiblClause = /\bLIBL\s*\(/i.test(remainder);
    const hasCurrentLibraryClause = /\bCURLIB\s*\(/i.test(remainder);

    const { userLibraries } = parseLibraryListEntries(libraryList);
    const effectiveCurrentLibrary = resolveEffectiveCurrentLibrary(currentLibrary, libraryList);
    const appendLiblClause = !hasLiblClause && userLibraries.length > 0;
    const appendCurrentLibraryClause = !hasCurrentLibraryClause && Boolean(effectiveCurrentLibrary);

    if (!appendLiblClause && !appendCurrentLibraryClause) {
        return undefined;
    }

    const clauses: string[] = [];
    if (remainder) {
        clauses.push(remainder);
    }
    if (appendLiblClause) {
        clauses.push(`LIBL(${userLibraries.join(' ')})`);
    }
    if (appendCurrentLibraryClause) {
        clauses.push(`CURLIB(${effectiveCurrentLibrary})`);
    }

    return `CHGLIBL ${clauses.join(' ')}`.trim();
}

export function buildChgCurlibCommandFromCurrentLibrary(
    command: string,
    currentLibrary?: string,
    libraryList?: Iterable<string> | string[]
): string | undefined {
    const text = String(command ?? '').trim();
    if (!text) {
        return undefined;
    }

    const withoutLeadingQuestion = text.startsWith('?') ? text.slice(1).trimStart() : text;
    const trimmed = withoutLeadingQuestion.trim();
    if (!/^CHGCURLIB\b/i.test(trimmed)) {
        return undefined;
    }

    const remainder = trimmed.replace(/^CHGCURLIB\b/i, '').trim();
    const hasCurrentLibraryClause = /\bCURLIB\s*\(/i.test(remainder);
    if (hasCurrentLibraryClause) {
        return undefined;
    }

    const effectiveCurrentLibrary = resolveEffectiveCurrentLibrary(currentLibrary, libraryList);
    if (!effectiveCurrentLibrary) {
        return undefined;
    }

    const clauses: string[] = [];
    if (remainder) {
        clauses.push(remainder);
    }
    clauses.push(`CURLIB(${effectiveCurrentLibrary})`);

    return `CHGCURLIB ${clauses.join(' ')}`.trim();
}
