/**
 * Applies common token substitutions for embedded SQL source templates.
 *
 * Replacements are intentionally limited to schema-qualified and external-name
 * token forms so plain mentions of SQLTOOLS in comments are untouched.
 */
export function applySqlSourceTokens(sqlTemplate: string, library: string, version: number): string {
    const targetLibrary = library.trim();

    return sqlTemplate
        .replace(/\\\$\{version\}/gi, String(version))
        .replace(/\$\{version\}/gi, String(version))
        .replace(/\bsqltools\./gi, `${targetLibrary}.`)
        .replace(/\bsqltools\//gi, `${targetLibrary}/`);
}
