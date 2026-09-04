export type CommandExecutionMode = '*RUN' | '*LIMIT';
export type CommandMessageKind = 'info' | 'warning' | 'error';

export interface CommandMessage {
    ordinalPosition: number;
    messageId: string;
    severity: number;
    type: string;
    text: string;
    sentTimestamp: string;
    sentFromProgram: string;
    sentFromStmt: string;
    sentFromModule: string;
    sentFromProcedure: string;
    sentToProgram: string;
    sentToStmt: string;
    sentToModule: string;
    sentToProcedure: string;
    secondLevelText: string;
    firstLevelExpanded?: boolean;
    kind: CommandMessageKind;
}

export interface CommandExecution {
    id: string;
    command: string;
    mode: CommandExecutionMode;
    startedAt: string;
    elapsedMs: number;
    outcome: 'success' | 'warning' | 'error';
    messages: CommandMessage[];
    failure?: string;
    sqlResult?: SqlResultPayload;
}

export interface SqlColumnMetadata {
    name: string;
    label?: string;
    typeName?: string;
    displaySize?: number;
    scale?: number;
    textDescription?: string;
    ddsType?: string;
    isIdentity?: boolean;
    schema?: string;
    table?: string;
}

export interface SqlResultPayload {
    statement: string;
    columns: string[];
    columnMetadata?: SqlColumnMetadata[];
    rows: Record<string, unknown>[];
    rowCount: number;
    displayedRowCount: number;
    truncated: boolean;
    sessionId?: string;
    hasMoreRows?: boolean;
    fetchSize?: number;
    prefetchSize?: number;
}

export interface CommandEntryHistory {
    command: string;
    mode: CommandExecutionMode;
    isSql?: boolean;
}

export function classifyMessage(severity: number, type: string): CommandMessageKind {
    const normalizedType = type.trim().toUpperCase();
    // Keep visual emphasis minimal: hard errors are highlighted red, diagnostics are highlighted yellow.
    if (/ESCAPE|ERROR/.test(normalizedType)) { return 'error'; }
    if (/DIAG|WARNING/.test(normalizedType)) { return 'warning'; }
    return 'info';
}

export function mapCommandMessages(rows: Record<string, unknown>[]): CommandMessage[] {
    return rows.map(row => {
        const value = (name: string) => row[name] ?? row[name.toLowerCase()] ?? '';
        const textValue = (name: string) => {
            const raw = value(name);
            return raw == null ? '' : String(raw).trim();
        };
        const severity = Number(value('MSGSEV')) || 0;
        const type = String(value('MSGTYPE'));
        return {
            ordinalPosition: Number(value('ORDINAL_POSITION')) || 0,
            messageId: String(value('MSGID')),
            severity,
            type,
            text: String(value('MSGTEXT')),
            sentTimestamp: textValue('SENT_TIMESTAMP'),
            sentFromProgram: textValue('SENT_FROM_PGM'),
            sentFromStmt: textValue('SENT_FROM_STMT'),
            sentFromModule: textValue('SENT_FROM_MOD'),
            sentFromProcedure: textValue('SENT_FROM_PROC'),
            sentToProgram: textValue('SENT_TO_PGM'),
            sentToStmt: textValue('SENT_TO_STMT'),
            sentToModule: textValue('SENT_TO_MOD'),
            sentToProcedure: textValue('SENT_TO_PROC'),
            secondLevelText: String(value('SECLVLMSG')),
            kind: classifyMessage(severity, type)
        };
    }).sort((a, b) => a.ordinalPosition - b.ordinalPosition);
}

export function determineOutcome(messages: CommandMessage[]): CommandExecution['outcome'] {
    if (messages.some(message => message.kind === 'error')) { return 'error'; }
    if (messages.some(message => message.kind === 'warning')) { return 'warning'; }
    return 'success';
}
