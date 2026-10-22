export const COMPONENT_SIGNATURE_LIBRARY_TOKEN = '__CLPROMPTER_COMPONENT_LIB__';

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalizes generated SQL so the component signature is stable regardless of
 * which IBM i library the UDTF ultimately gets installed into. The library name
 * is an installation detail, not a functional change to the component itself.
 */
export function normalizeComponentSqlForSignature(sql: string, library?: string): string {
    let normalized = sql;

    const targetLibrary = (library ?? '').trim();
    if (targetLibrary) {
        normalized = normalized.replace(new RegExp(escapeRegExp(targetLibrary), 'gi'), COMPONENT_SIGNATURE_LIBRARY_TOKEN);
    }

    return normalized
        .replace(/\bSQLTOOLS\b/gi, COMPONENT_SIGNATURE_LIBRARY_TOKEN)
        .replace(/\$\{functionLibrary\}/gi, COMPONENT_SIGNATURE_LIBRARY_TOKEN);
}
