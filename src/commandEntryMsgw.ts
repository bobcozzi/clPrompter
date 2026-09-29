import IBMi from '@halcyontech/vscode-ibmi-types/api/IBMi';
import { CommandEntryJobManager } from './commandEntryJobManager';
import { getUDTFLibrary } from './components/hostFunctions';

const MSGW_REPLY_QUEUE = 'QSYSOPR';

export interface MsgwInquiryRow {
    ordinalPosition?: number;
    messageType?: string;
    messageId?: string;
    messageSeverity?: number;
    messageText?: string;
    messageKeyHex?: string;
    qualifiedJobName?: string;
    messageQueueName?: string;
    messageQueueLibrary?: string;
}

export interface MsgwStatusRow {
    qualifiedJobName?: string;
    jobStatus?: string;
    messageReply?: string;
}

export interface MsgwCheckDependencies {
    connection: IBMi;
    jobManager: CommandEntryJobManager;
    sqlJobId: string;
    showNotice: (message: string, severity?: 'info' | 'warning' | 'error') => void;
    log?: (message: string) => void;
    silentProbeNotices?: boolean;
}

function escapeSqlLiteral(value: string): string {
    return value.replace(/'/g, "''");
}

function formatMessageKeyHex(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        const hex = value.toString('hex').toUpperCase();
        return hex.length > 0 ? hex : undefined;
    }

    if (value instanceof Uint8Array) {
        const hex = Buffer.from(value).toString('hex').toUpperCase();
        return hex.length > 0 ? hex : undefined;
    }

    if (value instanceof ArrayBuffer) {
        const hex = Buffer.from(value).toString('hex').toUpperCase();
        return hex.length > 0 ? hex : undefined;
    }

    if (ArrayBuffer.isView(value)) {
        const view = value as ArrayBufferView;
        const hex = Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('hex').toUpperCase();
        return hex.length > 0 ? hex : undefined;
    }

    const text = String(value).trim();
    if (!text) {
        return undefined;
    }

    const normalizedText = text
        .replace(/^X'/i, '')
        .replace(/'$/i, '')
        .replace(/\s+/g, '')
        .replace(/^0x/i, '');

    if (/^[0-9A-Fa-f]+$/.test(normalizedText)) {
        return normalizedText.toUpperCase();
    }

    const bytes = Buffer.from(text, 'latin1');
    const hex = bytes.toString('hex').toUpperCase();
    return hex.length > 0 ? hex : undefined;
}

function formatMessageKeyHexLiteral(value: unknown): string | undefined {
    const hex = formatMessageKeyHex(value);
    if (!hex) {
        return undefined;
    }

    return `X'${hex.toLowerCase()}'`;
}

function normalizeMsgKeyHexColumn(value: unknown): string | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    const text = String(value).trim();
    if (!text) {
        return undefined;
    }

    const normalized = text
        .replace(/^X'/i, '')
        .replace(/'$/i, '')
        .replace(/\s+/g, '')
        .replace(/^0x/i, '')
        .toUpperCase();

    if (!/^[0-9A-F]+$/.test(normalized)) {
        return undefined;
    }

    return normalized;
}

export function buildMsgwStatusSql(sqlJobId: string): string {
    const normalizedJobId = String(sqlJobId || '').trim().toUpperCase();
    if (!normalizedJobId) {
        throw new Error('A valid SQL job ID is required to check for MSGW.');
    }

    const jobParts = normalizedJobId.split('/');
    const jobName = jobParts[2]?.trim();
    if (!jobName) {
        throw new Error('A valid SQL job ID is required to check for MSGW.');
    }

    return [
        "SELECT JOB_NAME, JOB_STATUS, MESSAGE_REPLY",
        "FROM TABLE(QSYS2.ACTIVE_JOB_INFO(DETAILED_INFO => 'NONE', CURRENT_USER_LIST_FILTER => USER, JOB_NAME_FILTER => '" + escapeSqlLiteral(jobName) + "')) X",
        `WHERE JOB_NAME = '${escapeSqlLiteral(normalizedJobId)}'`,
        'FETCH FIRST 1 ROW ONLY'
    ].join(' ');
}

export function buildMsgwInquiryRowSql(sqlJobId: string, messageTypes: string[] = ['INQUIRY', 'SENDER', '*INQ']): string {
    const escapedJobId = String(sqlJobId || '').trim().replace(/'/g, "''");
    if (!escapedJobId) {
        throw new Error('A valid SQL job ID is required to check for MSGW.');
    }

    const normalizedTypes = messageTypes
        .map((type) => String(type || '').trim().toUpperCase())
        .filter((type) => type.length > 0)
        .map((type) => `'${type.replace(/'/g, "''")}'`);

    const typeFilter = normalizedTypes.length > 0
        ? `WHERE MESSAGE_TYPE IN (${normalizedTypes.join(', ')})`
        : '';

    return [
        'SELECT MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TEXT, MESSAGE_KEY',
        `FROM TABLE(QSYS2.JOBLOG_INFO('${escapedJobId}'))`,
        typeFilter,
        'ORDER BY ORDINAL_POSITION DESC',
        'FETCH FIRST 1 ROW ONLY'
    ].filter((part) => part.length > 0).join(' ');
}

export function buildMsgwLatestRowSql(sqlJobId: string): string {
    return buildMsgwInquiryRowSql(sqlJobId);
}

function isMsgwCandidateType(messageType: string): boolean {
    const normalized = String(messageType || '').trim().toUpperCase();
    return normalized === 'INQUIRY' || normalized === 'SENDER' || normalized === '*INQ';
}

export function buildMsgwReplySql(replyCommand: string, udtfLibrary: string): string {
    const normalizedLibrary = String(udtfLibrary || '').trim();
    const normalizedReplyCommand = String(replyCommand || '').trim();

    if (!normalizedLibrary) {
        throw new Error('A valid UDTF library is required to send an MSGW response.');
    }

    if (!normalizedReplyCommand) {
        throw new Error('A valid reply command is required to send an MSGW response.');
    }

    const escapedReplyCommand = normalizedReplyCommand.replace(/'/g, "''");
    return [
        'SELECT ORDINAL_POSITION, MSGID, MSGSEV, MSGTYPE, SENT_TIMESTAMP, MSGTEXT,',
        'SENT_BY_USER, SENT_FROM_PGM, SENT_FROM_STMT, SENT_FROM_MOD, SENT_FROM_PROC,',
        'SENT_TO_PGM, SENT_TO_STMT, SENT_TO_MOD, SENT_TO_PROC, SECLVLMSG',
        `FROM TABLE(${normalizedLibrary}.CMD_RUN('${escapedReplyCommand}', '*RUN'))`,
        'ORDER BY ORDINAL_POSITION'
    ].join('\n');
}

export function buildMsgwReplyCommand(messageKeyHex: string, replyText: string, messageQueue: string = MSGW_REPLY_QUEUE): string {
    const normalizedMessageQueue = String(messageQueue || '').trim().toUpperCase();
    const normalizedMessageKey = String(messageKeyHex || '').trim();
    const normalizedReplyText = String(replyText || '').trim();

    if (!normalizedMessageQueue) {
        throw new Error('A valid reply message queue is required to send an MSGW response.');
    }

    if (!normalizedMessageKey) {
        throw new Error('A valid message key is required to send an MSGW response.');
    }

    if (!normalizedReplyText) {
        throw new Error('A valid reply text is required to send an MSGW response.');
    }

    const rawHex = formatMessageKeyHex(normalizedMessageKey) ?? normalizedMessageKey.replace(/[^0-9A-Fa-f]/g, '');
    const messageKeyLiteral = `X'${rawHex.toLowerCase()}'`;
    return `SNDRPY MSGQ(${normalizedMessageQueue}) MSGKEY(${messageKeyLiteral}) RPY('${normalizedReplyText.replace(/'/g, "''")}')`;
}

export function buildMsgwJobInfoSql(sqlJobId: string, udtfLibrary: string): string {
    const normalizedJobId = String(sqlJobId || '').trim().toUpperCase();
    const normalizedLibrary = String(udtfLibrary || '').trim().toUpperCase();

    if (!normalizedJobId) {
        throw new Error('A valid SQL job ID is required to check for MSGW.');
    }

    if (!normalizedLibrary) {
        throw new Error('A valid UDTF library is required to check for MSGW.');
    }

    return [
        'SELECT JOB, ACTIVE_JOB_STATUS, JOB_STATUS, MSGKEY_HEX, MSGKEY, MSGQ_NAME, MSGQ_LIB, MSGQ_LIB_ASP',
        `FROM TABLE(${normalizedLibrary}.JOB_INFO('${escapeSqlLiteral(normalizedJobId)}'))`,
        'FETCH FIRST 1 ROW ONLY'
    ].join(' ');
}

function buildMsgQueueQualifiedName(queueName: string, queueLibrary?: string): string {
    const normalizedName = String(queueName || '').trim().toUpperCase();
    const normalizedLibrary = String(queueLibrary || '').trim().toUpperCase();
    if (!normalizedName) {
        throw new Error('A valid reply message queue is required to send an MSGW response.');
    }

    if (normalizedLibrary && normalizedLibrary !== '*LIBL' && normalizedLibrary !== '*CURLIB') {
        return `${normalizedLibrary}/${normalizedName}`;
    }

    return normalizedName;
}

export function buildMsgwReplyCommandForQueue(messageKeyHex: string, replyText: string, queueName: string, queueLibrary?: string): string {
    const qualifiedQueue = buildMsgQueueQualifiedName(queueName, queueLibrary);
    return buildMsgwReplyCommand(messageKeyHex, replyText, qualifiedQueue);
}

export function buildMsgwQueueInquirySql(messageId: string, fromJobId: string, messageQueue: string = MSGW_REPLY_QUEUE, rowLimit: number = 20): string {
    const normalizedMessageId = String(messageId || '').trim();
    const normalizedFromJobId = String(fromJobId || '').trim();
    const normalizedQueue = String(messageQueue || '').trim();

    if (!normalizedMessageId) {
        throw new Error('A valid message ID is required to resolve the QSYSOPR inquiry message key.');
    }

    if (!normalizedFromJobId) {
        throw new Error('A valid source job ID is required to resolve the QSYSOPR inquiry message key.');
    }

    if (!normalizedQueue) {
        throw new Error('A valid message queue name is required to resolve the QSYSOPR inquiry message key.');
    }

    const escapedMessageId = normalizedMessageId.replace(/'/g, "''");
    const escapedFromJobId = normalizedFromJobId.replace(/'/g, "''");
    const safeRowLimit = Number.isFinite(rowLimit) && rowLimit > 0 ? Math.trunc(rowLimit) : 20;

    return [
        "SELECT MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TEXT, MESSAGE_KEY, FROM_JOB, ASSOCIATED_MESSAGE_KEY, MESSAGE_TIMESTAMP",
        `FROM TABLE(QSYS2.MESSAGE_QUEUE_INFO(QUEUE_NAME => '${normalizedQueue.replace(/'/g, "''")}', MESSAGE_FILTER => 'INQUIRY'))`,
        `WHERE MESSAGE_ID = '${escapedMessageId}'`,
        `AND FROM_JOB = '${escapedFromJobId}'`,
        "AND MESSAGE_TYPE = 'INQUIRY'",
        'AND ASSOCIATED_MESSAGE_KEY IS NULL',
        'ORDER BY MESSAGE_TIMESTAMP DESC',
        `FETCH FIRST ${safeRowLimit} ROWS ONLY`
    ].join(' ');
}

export function buildMsgwQueueInquiryByKeySql(messageKeyHex: string, queueName?: string, queueLibrary?: string, rowLimit: number = 5): string {
    const normalizedMessageKeyHex = String(messageKeyHex || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    if (!normalizedMessageKeyHex) {
        throw new Error('A valid message key is required to resolve the inquiry message text.');
    }

    const normalizedQueueName = String(queueName || '').trim().toUpperCase();
    const normalizedQueueLibrary = String(queueLibrary || '').trim().toUpperCase();

    const effectiveQueueName = normalizedQueueName || 'QSYSOPR';
    const effectiveQueueLibrary = normalizedQueueLibrary && normalizedQueueLibrary !== '*LIBL' && normalizedQueueLibrary !== '*CURLIB'
        ? normalizedQueueLibrary
        : 'QSYS';

    const safeRowLimit = Number.isFinite(rowLimit) && rowLimit > 0 ? Math.trunc(rowLimit) : 5;
    return [
        'SELECT MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TEXT, HEX(MESSAGE_KEY) AS MESSAGE_KEY_HEX, FROM_JOB, MESSAGE_TIMESTAMP',
        `FROM TABLE(QSYS2.MESSAGE_QUEUE_INFO('${escapeSqlLiteral(effectiveQueueLibrary)}', '${escapeSqlLiteral(effectiveQueueName)}', 'INQUIRY', 0))`,
        `WHERE HEX(MESSAGE_KEY) = '${normalizedMessageKeyHex}'`,
        'ORDER BY MESSAGE_TIMESTAMP DESC',
        `FETCH FIRST ${safeRowLimit} ROWS ONLY`
    ].join(' ');
}

function pickRowValue(row: Record<string, unknown>, ...keys: string[]): string | undefined {
    for (const key of keys) {
        const value = row[key] ?? row[key.toLowerCase()];
        if (value === null || value === undefined) {
            continue;
        }
        const text = String(value).trim();
        if (text.length > 0) {
            return text;
        }
    }
    return undefined;
}

function normalizeMsgwRow(row: Record<string, unknown>): MsgwInquiryRow {
    const messageSeverityValue = Number(row.MESSAGE_SEVERITY ?? row.message_severity ?? row.MSGSEV ?? row.msgsev ?? 0);
    const messageKeyValue = row.MESSAGE_KEY ?? row.message_key ?? row.MESSAGE_KEY_HEX ?? row.message_key_hex ?? row.MSGKEY ?? row.msgkey;
    return {
        messageType: pickRowValue(row, 'MESSAGE_TYPE', 'message_type', 'MSGTYPE', 'msgtype'),
        messageId: pickRowValue(row, 'MESSAGE_ID', 'message_id', 'MSGID', 'msgid'),
        messageSeverity: Number.isFinite(messageSeverityValue) ? messageSeverityValue : undefined,
        messageText: pickRowValue(row, 'MESSAGE_TEXT', 'message_text'),
        messageKeyHex: formatMessageKeyHex(messageKeyValue),
        qualifiedJobName: pickRowValue(row, 'QUALIFIED_JOB_NAME', 'qualified_job_name')
    };
}

function formatMsgwRowNotice(row?: Record<string, unknown>): string | undefined {
    if (!row) {
        return undefined;
    }

    const messageType = pickRowValue(row, 'MESSAGE_TYPE', 'message_type');
    const messageText = pickRowValue(row, 'MESSAGE_TEXT', 'message_text');
    const messageId = pickRowValue(row, 'MESSAGE_ID', 'message_id');
    const messageKey = formatMessageKeyHexLiteral(row.MESSAGE_KEY ?? row.message_key ?? row.MESSAGE_KEY_HEX ?? row.message_key_hex ?? row.MSGKEY ?? row.msgkey);

    const parts: string[] = [];
    if (messageType) {
        parts.push(`Type: ${messageType}`);
    }
    if (messageId) {
        parts.push(`ID: ${messageId}`);
    }
    if (messageKey) {
        parts.push(`msgkey=${messageKey}`);
    }
    if (messageText) {
        parts.push(`Text: ${messageText}`);
    }

    return parts.length > 0 ? parts.join(' | ') : undefined;
}

function formatMsgwDebugValue(value: unknown): string {
    if (value === null) {
        return 'null';
    }

    if (value === undefined) {
        return 'undefined';
    }

    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return formatMessageKeyHexLiteral(value) ?? '<buffer>';
    }

    if (value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        return formatMessageKeyHexLiteral(value) ?? '<binary>';
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    return String(value);
}

function formatMsgwDebugRow(row: Record<string, unknown>): string {
    const keys = Object.keys(row).sort();
    if (keys.length === 0) {
        return '<empty row>';
    }

    return keys
        .map((key) => `${key}=${formatMsgwDebugValue(row[key])}`)
        .join(' | ');
}

export function findMsgwInquiryMessage(rows: Record<string, unknown>[]): MsgwInquiryRow | undefined {
    return rows.length > 0 ? normalizeMsgwRow(rows[0]) : undefined;
}

export function findMsgwQueueInquiryMessage(rows: Record<string, unknown>[], messageId: string, fromJobId: string): MsgwInquiryRow | undefined {
    const normalizedMessageId = String(messageId || '').trim().toUpperCase();
    const normalizedFromJobId = String(fromJobId || '').trim().toUpperCase();

    for (const row of rows) {
        const rowMessageId = String(row.MESSAGE_ID ?? row.message_id ?? '').trim().toUpperCase();
        const rowFromJob = String(row.FROM_JOB ?? row.from_job ?? '').trim().toUpperCase();
        const rowAssociatedKey = row.ASSOCIATED_MESSAGE_KEY ?? row.associated_message_key;
        const maybeAssociatedNull = rowAssociatedKey === null || rowAssociatedKey === undefined || String(rowAssociatedKey).trim() === '';

        if (rowMessageId && rowFromJob && rowMessageId === normalizedMessageId && rowFromJob === normalizedFromJobId && maybeAssociatedNull) {
            return normalizeMsgwRow(row);
        }
    }

    return undefined;
}

export function findMsgwQueueInquiryByKey(rows: Record<string, unknown>[], messageKeyHex: string): MsgwInquiryRow | undefined {
    const normalizedMessageKey = String(messageKeyHex || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    if (!normalizedMessageKey) {
        return undefined;
    }

    for (const row of rows) {
        const rowMessageKey = String(row.MESSAGE_KEY_HEX ?? row.message_key_hex ?? row.MSGKEY_HEX ?? row.msgkey_hex ?? '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
        if (rowMessageKey && rowMessageKey === normalizedMessageKey) {
            return normalizeMsgwRow(row);
        }
    }

    return undefined;
}

async function resolveMsgwQueueInquiryMessage(deps: MsgwCheckDependencies, sqlJobId: string, messageId: string): Promise<MsgwInquiryRow | undefined> {
    const normalizedMessageId = String(messageId || '').trim().toUpperCase();
    const normalizedSqlJobId = String(sqlJobId || '').trim().toUpperCase();

    if (!normalizedMessageId) {
        deps.log?.(`[Cmd Entry][MSGW] No inquiry message ID was available to resolve the QSYSOPR queue row for ${normalizedSqlJobId}.`);
        return undefined;
    }

    const queueInquirySql = buildMsgwQueueInquirySql(normalizedMessageId, normalizedSqlJobId, MSGW_REPLY_QUEUE, 3);
    deps.log?.(`[Cmd Entry][MSGW] Queue inquiry SQL for ${normalizedSqlJobId}: ${queueInquirySql}`);
    const queueRows = await deps.jobManager.queryWithHelperJob(deps.connection, queueInquirySql, 'MSGW queue inquiry');
    const queueMessage = findMsgwQueueInquiryMessage(queueRows, normalizedMessageId, normalizedSqlJobId);

    if (!queueMessage) {
        deps.log?.(`[Cmd Entry][MSGW] No unresolved QSYSOPR inquiry row matched message ID ${normalizedMessageId} and source job ${normalizedSqlJobId}.`);
        deps.showNotice(`Job ${normalizedSqlJobId} is in MSGW, but no unresolved QSYSOPR inquiry match was found for message ID ${normalizedMessageId}.`, 'warning');
        return undefined;
    }

    const resolvedMessageKey = formatMessageKeyHex(queueMessage.messageKeyHex);
    if (!resolvedMessageKey) {
        deps.log?.(`[Cmd Entry][MSGW] Resolved QSYSOPR inquiry row for ${normalizedSqlJobId} had no usable message key.`);
        deps.showNotice(`Job ${normalizedSqlJobId} is in MSGW, but the matching inquiry message in QSYSOPR had no usable message key.`, 'warning');
        return undefined;
    }

    const resolvedRow = {
        ...queueMessage,
        MESSAGE_TYPE: queueMessage.messageType,
        MESSAGE_ID: queueMessage.messageId,
        MESSAGE_TEXT: queueMessage.messageText,
        MESSAGE_KEY: resolvedMessageKey
    } as Record<string, unknown>;
    const resolvedInquiryMessage = normalizeMsgwRow(resolvedRow);
    deps.log?.(`[Cmd Entry][MSGW] Matched unresolved QSYSOPR inquiry row for ${normalizedSqlJobId}; using message key ${formatMessageKeyHexLiteral(resolvedInquiryMessage.messageKeyHex)}.`);
    deps.showNotice(`MSGW detected for job ${normalizedSqlJobId}: ${resolvedInquiryMessage.messageText || 'Inquiry message found.'}${resolvedInquiryMessage.messageId ? ` Message ID: ${resolvedInquiryMessage.messageId}.` : ''} Reply queue: ${MSGW_REPLY_QUEUE}.`, 'warning');
    return resolvedInquiryMessage;
}

async function resolveMsgwInquiryMessageByKey(
    deps: MsgwCheckDependencies,
    sqlJobId: string,
    messageKeyHex: string,
    queueName?: string,
    queueLibrary?: string
): Promise<MsgwInquiryRow | undefined> {
    const normalizedSqlJobId = String(sqlJobId || '').trim().toUpperCase();
    const normalizedMessageKeyHex = String(messageKeyHex || '').trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    if (!normalizedMessageKeyHex) {
        return undefined;
    }

    const queueInquirySql = buildMsgwQueueInquiryByKeySql(normalizedMessageKeyHex, queueName, queueLibrary, 3);
    deps.log?.(`[Cmd Entry][MSGW] Queue inquiry-by-key SQL for ${normalizedSqlJobId}: ${queueInquirySql}`);

    try {
        const queueRows = await deps.jobManager.queryWithHelperJob(deps.connection, queueInquirySql, 'MSGW queue inquiry by key');
        const queueMessage = findMsgwQueueInquiryByKey(queueRows, normalizedMessageKeyHex);
        if (!queueMessage) {
            deps.log?.(`[Cmd Entry][MSGW] No inquiry row was found by message key ${normalizedMessageKeyHex} for ${normalizedSqlJobId}.`);
            return undefined;
        }

        deps.log?.(`[Cmd Entry][MSGW] Resolved inquiry text by message key for ${normalizedSqlJobId}: messageId=${queueMessage.messageId || '<none>'} text=${queueMessage.messageText || '<none>'}`);
        return queueMessage;
    } catch (error) {
        const failure = error instanceof Error ? error.message : String(error);
        const canRetryWithoutLibrary = Boolean(queueName) && Boolean(queueLibrary) && /(SQ20483|MESSAGE_QUEUE_INFO)/i.test(failure);
        if (canRetryWithoutLibrary) {
            const fallbackSql = buildMsgwQueueInquiryByKeySql(normalizedMessageKeyHex, queueName, undefined, 3);
            deps.log?.(`[Cmd Entry][MSGW] Queue inquiry-by-key retry without queue library for ${normalizedSqlJobId}: ${fallbackSql}`);

            try {
                const fallbackRows = await deps.jobManager.queryWithHelperJob(deps.connection, fallbackSql, 'MSGW queue inquiry by key fallback');
                const fallbackMessage = findMsgwQueueInquiryByKey(fallbackRows, normalizedMessageKeyHex);
                if (fallbackMessage) {
                    deps.log?.(`[Cmd Entry][MSGW] Resolved inquiry text by message key (fallback) for ${normalizedSqlJobId}: messageId=${fallbackMessage.messageId || '<none>'} text=${fallbackMessage.messageText || '<none>'}`);
                    return fallbackMessage;
                }

                deps.log?.(`[Cmd Entry][MSGW] Fallback inquiry-by-key lookup returned no rows for ${normalizedSqlJobId}.`);
            } catch (fallbackError) {
                const fallbackFailure = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
                deps.log?.(`[Cmd Entry][MSGW] Queue inquiry-by-key fallback failed for ${normalizedSqlJobId}: ${fallbackFailure}`);
            }
        }

        deps.log?.(`[Cmd Entry][MSGW] Queue inquiry-by-key lookup failed for ${normalizedSqlJobId}: ${failure}`);
        return undefined;
    }
}

export async function checkForMsgw(deps: MsgwCheckDependencies): Promise<MsgwInquiryRow | undefined> {
    const sqlJobId = String(deps.sqlJobId || '').trim();
    const silentProbeNotices = deps.silentProbeNotices === true;
    if (!sqlJobId) {
        deps.log?.('[Cmd Entry][MSGW] No SQL job ID is available to check for MSGW.');
        if (!silentProbeNotices) {
            deps.showNotice('No SQL job ID is available to check for MSGW.', 'warning');
        }
        return undefined;
    }

    const udtfLibrary = getUDTFLibrary(deps.connection);
    deps.log?.(`[Cmd Entry][MSGW] Checking job ${sqlJobId} using ${udtfLibrary}.JOB_INFO.`);
    if (!silentProbeNotices) {
        deps.showNotice(`Checking for MSGW on job ${sqlJobId}...`, 'info');
    }

    const jobInfoSql = buildMsgwJobInfoSql(sqlJobId, udtfLibrary);
    deps.log?.(`[Cmd Entry][MSGW] JOB_INFO SQL for ${sqlJobId}: ${jobInfoSql}`);

    const rows = await deps.jobManager.queryWithHelperJob(
        deps.connection,
        jobInfoSql,
        'MSGW job info'
    );
    const row = rows.length > 0 ? rows[0] as Record<string, unknown> : undefined;
    if (!row) {
        deps.log?.(`[Cmd Entry][MSGW] ${udtfLibrary}.JOB_INFO returned no row for ${sqlJobId}.`);
        deps.showNotice(`Unable to determine MSGW status for job ${sqlJobId}; ${udtfLibrary}.JOB_INFO returned no row.`, 'warning');
        return undefined;
    }

    deps.log?.(`[Cmd Entry][MSGW] JOB_INFO row for ${sqlJobId}: ${formatMsgwDebugRow(row)}`);

    const activeJobStatus = String(row.ACTIVE_JOB_STATUS ?? row.active_job_status ?? '').trim().toUpperCase();
    const fallbackJobStatus = String(row.JOB_STATUS ?? row.job_status ?? '').trim().toUpperCase();
    const jobStatus = activeJobStatus || fallbackJobStatus;
    if (jobStatus !== 'MSGW') {
        deps.log?.(`[Cmd Entry][MSGW] Job ${sqlJobId} is not waiting for a reply (status=${jobStatus || '<none>'}).`);
        if (!silentProbeNotices) {
            deps.showNotice(`Job ${sqlJobId} is not in MSGW status. Status: ${jobStatus || '<none>'}.`, 'info');
        }
        return undefined;
    }

    const binaryMsgKeyValue = row.MSGKEY ?? row.msgkey;
    const helperMsgKeyHexValue = row.MSGKEY_HEX ?? row.msgkey_hex;
    const binaryMsgKeyHex = formatMessageKeyHex(binaryMsgKeyValue);
    const helperMsgKeyHex = normalizeMsgKeyHexColumn(helperMsgKeyHexValue);
    const messageKeyHex = binaryMsgKeyHex ?? helperMsgKeyHex;
    const messageKeySource = binaryMsgKeyHex ? 'MSGKEY' : (helperMsgKeyHex ? 'MSGKEY_HEX' : 'none');
    const messageQueueName = String(row.MSGQ_NAME ?? row.msgq_name ?? '').trim().toUpperCase();
    const messageQueueLibrary = String(row.MSGQ_LIB ?? row.msgq_lib ?? '').trim().toUpperCase();

    if (!messageKeyHex) {
        deps.log?.(`[Cmd Entry][MSGW] Job ${sqlJobId} is MSGW, but JOB_INFO returned no usable MSGKEY.`);
        deps.showNotice(`Job ${sqlJobId} is in MSGW, but no usable message key was returned by ${udtfLibrary}.JOB_INFO.`, 'warning');
        return undefined;
    }

    if (!messageQueueName) {
        deps.log?.(`[Cmd Entry][MSGW] Job ${sqlJobId} is MSGW, but JOB_INFO returned no usable message queue name.`);
        deps.showNotice(`Job ${sqlJobId} is in MSGW, but no message queue name was returned by ${udtfLibrary}.JOB_INFO.`, 'warning');
        return undefined;
    }

    const queueLabel = messageQueueLibrary ? `${messageQueueLibrary}/${messageQueueName}` : messageQueueName;
    deps.log?.(`[Cmd Entry][MSGW] MSGW detected for ${sqlJobId}; msgkeySource=${messageKeySource} msgkeyLen=${messageKeyHex.length} msgkey=${formatMessageKeyHexLiteral(messageKeyHex)} queue=${queueLabel}.`);

    const queueInquiryMessage = await resolveMsgwInquiryMessageByKey(deps, sqlJobId, messageKeyHex, messageQueueName, messageQueueLibrary);
    if (queueInquiryMessage?.messageText || queueInquiryMessage?.messageId) {
        deps.showNotice(
            `MSGW detected for job ${sqlJobId}: ${queueInquiryMessage.messageId || 'Inquiry'}${queueInquiryMessage.messageText ? ` - ${queueInquiryMessage.messageText}` : ''}. Reply target: ${queueLabel}.`,
            'warning'
        );
    } else {
        deps.showNotice(`MSGW detected for job ${sqlJobId}. Reply target: ${queueLabel}.`, 'warning');
    }

    return {
        messageKeyHex,
        messageId: queueInquiryMessage?.messageId,
        messageText: queueInquiryMessage?.messageText,
        messageQueueName,
        messageQueueLibrary,
        qualifiedJobName: String(row.JOB ?? row.job ?? sqlJobId).trim().toUpperCase() || sqlJobId
    };
}