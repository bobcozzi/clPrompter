export type CommandEntryPrefix = 'CL' | 'SQL' | undefined;

/**
 * Single source of truth for explicit Command Entry prefixes.
 */
export function detectCommandEntryPrefix(command: string): CommandEntryPrefix {
    const text = String(command ?? '');
    if (/^\s*cl\s*:/i.test(text)) {
        return 'CL';
    }
    if (/^\s*sql\s*:/i.test(text)) {
        return 'SQL';
    }
    return undefined;
}
