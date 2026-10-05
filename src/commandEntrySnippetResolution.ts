export interface SnippetTemplateContext {
    sqlJobId?: string;
    sqlJobName?: string;
    sqlJobNumber?: string;
    sharedSqlJobId?: string;
    resultSqlJobId?: string;
    c4iJobId?: string;
    currentUser?: string;
    currentLibrary?: string;
    userSBSList?: string;
    funcLib?: string;
    customVariables?: Record<string, string>;
}

export function resolveSnippetTemplateValue(template: string, context: SnippetTemplateContext): { resolved: string; missing: string[] } {
    const builtInTokenValues: Record<string, string | undefined> = {
        sqlJobId: context.sqlJobId,
        sqlJobName: context.sqlJobName,
        sqlJobNumber: context.sqlJobNumber,
        sharedSqlJobId: context.sharedSqlJobId,
        resultSqlJobId: context.resultSqlJobId,
        c4iJobId: context.c4iJobId,
        currentUser: context.currentUser,
        currentLibrary: context.currentLibrary,
        userSBSList: context.userSBSList,
        funcLib: context.funcLib
    };
    const customTokenValues = context.customVariables ?? {};

    const missing = new Set<string>();
    const resolved = String(template ?? '').replace(/\$\{([A-Za-z0-9_]+)\}/g, (_all, tokenName: string) => {
        const key = String(tokenName || '').trim();
        const isBuiltIn = key in builtInTokenValues;
        const hasCustom = key in customTokenValues;
        if (!isBuiltIn && !hasCustom) {
            return `\${${key}}`;
        }

        const value = isBuiltIn
            ? builtInTokenValues[key]
            : customTokenValues[key];
        if (key === 'userSBSList' && isBuiltIn) {
            return String(value ?? '').replace(/'/g, "''");
        }
        if (!value || !String(value).trim()) {
            missing.add(key);
            return `\${${key}}`;
        }
        return String(value).replace(/'/g, "''");
    });

    return { resolved, missing: [...missing] };
}
