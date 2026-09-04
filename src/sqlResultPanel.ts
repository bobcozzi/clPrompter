import * as vscode from 'vscode';
import { SqlColumnMetadata, SqlResultPayload } from './commandEntryModel';

const PANEL_TYPE = 'clprompter.sqlResults';
const PANEL_TITLE = 'SQL Results';

type SqlResultPanelRequest =
    | { type: 'loadMore'; sessionId: string }
    | { type: 'loadAll'; sessionId: string }
    | { type: 'prefetch'; sessionId: string }
    | { type: 'rerunSql'; statement: string }
    | { type: 'closeSession'; sessionId: string };

type SqlResultPanelRequestHandler = (request: SqlResultPanelRequest) => Promise<SqlResultPayload | undefined>;

class SqlResultPanel {
    private panel: vscode.WebviewPanel | undefined;
    private requestHandler: SqlResultPanelRequestHandler | undefined;
    private activeSessionId: string | undefined;

    setRequestHandler(handler: SqlResultPanelRequestHandler | undefined): void {
        this.requestHandler = handler;
    }

    show(result: SqlResultPayload): void {
        if (!this.panel) {
            this.panel = vscode.window.createWebviewPanel(
                PANEL_TYPE,
                PANEL_TITLE,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true,
                    localResourceRoots: sqlResultPanelExtensionUri
                        ? [vscode.Uri.joinPath(sqlResultPanelExtensionUri, 'media')]
                        : undefined
                }
            );
            this.panel.webview.onDidReceiveMessage((message: unknown) => {
                void this.handleMessage(message);
            });
            this.panel.onDidDispose(() => {
                if (this.activeSessionId && this.requestHandler) {
                    void this.requestHandler({ type: 'closeSession', sessionId: this.activeSessionId });
                }
                this.panel = undefined;
                this.activeSessionId = undefined;
            });
        } else {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }

        this.activeSessionId = result.sessionId;
        this.panel.title = `${PANEL_TITLE} (${result.rowCount})`;
        const extensionUri = sqlResultPanelExtensionUri;
        const scriptUri = extensionUri
            ? this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sqlResultPanel.js')).toString()
            : '';
        this.panel.webview.html = renderSqlResultHtml(result, this.panel.webview.cspSource, scriptUri);
    }

    private update(result: SqlResultPayload): void {
        if (!this.panel) {
            return;
        }

        this.activeSessionId = result.sessionId;
        this.panel.title = `${PANEL_TITLE} (${result.rowCount})`;
        const payload = buildClientPayload(result);
        void this.panel.webview.postMessage({ type: 'sqlResultReplace', payload });
    }

    markSessionClosed(message?: string): void {
        if (!this.panel || !this.activeSessionId) {
            return;
        }

        const sessionId = this.activeSessionId;
        this.activeSessionId = undefined;
        void this.panel.webview.postMessage({
            type: 'sqlSessionClosed',
            sessionId,
            message: message || 'SQL result session is no longer available. Run the SQL statement again.'
        });
    }

    private async handleMessage(message: unknown): Promise<void> {
        if (!this.requestHandler || !this.panel || !message || typeof message !== 'object') {
            return;
        }

        const request = message as { type?: string; sessionId?: string; statement?: string };
        if (!request.type) {
            return;
        }

        if (request.type === 'rerunSql') {
            const statement = String(request.statement || '').trim();
            if (!statement) {
                throw new Error('No SQL statement was provided to rerun.');
            }

            const updated = await this.requestHandler({ type: 'rerunSql', statement });
            if (updated) {
                this.update(updated);
            }
            return;
        }

        if (!request.sessionId) {
            return;
        }

        if (request.type !== 'loadMore' && request.type !== 'loadAll' && request.type !== 'prefetch') {
            return;
        }

        try {
            const updated = await this.requestHandler({ type: request.type, sessionId: request.sessionId });
            if (updated) {
                this.update(updated);
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            void this.panel.webview.postMessage({ type: 'loadError', message: messageText });
        }
    }
}

const singletonPanel = new SqlResultPanel();
let sqlResultPanelExtensionUri: vscode.Uri | undefined;

export function configureSqlResultPanelAssets(extensionUri: vscode.Uri): void {
    sqlResultPanelExtensionUri = extensionUri;
}

export function showSqlResultPanel(result: SqlResultPayload): void {
    singletonPanel.show(result);
}

export function setSqlResultPanelRequestHandler(handler: SqlResultPanelRequestHandler | undefined): void {
    singletonPanel.setRequestHandler(handler);
}

export function notifySqlResultSessionClosed(message?: string): void {
    singletonPanel.markSessionClosed(message);
}

function renderSqlResultHtml(result: SqlResultPayload, cspSource: string, scriptUri: string): string {
    const columns = result.columns;
    const profiles = buildColumnProfiles(columns, result.rows);
    const initialPayload = buildClientPayload(result);
    const columnMetadataByName = new Map((result.columnMetadata ?? []).map((entry) => [normalizeColumnKey(entry.name), entry]));
    const colHeaders = columns.map((column, index) => {
        const profile = profiles[column];
        const classes = ['sortable-col'];
        if (shouldRightAlign(profile.kind)) {
            classes.push('align-right');
        }
        const byName = columnMetadataByName.get(normalizeColumnKey(column));
        const byScan = findMetadataForColumn(column, result.columnMetadata ?? []);
        const byPosition = result.columnMetadata?.[index];
        const metadata = byName ?? byScan ?? byPosition;
        const headerText = resolveColumnHeaderText(column, metadata);
        const tooltipText = buildColumnHeaderTooltip(column, metadata);
        const headerHtml = renderColumnHeaderHtml(headerText);
        return `<th class="${classes.join(' ')}" data-col-index="${index}" title="${escapeHtml(tooltipText)}" aria-sort="none">${headerHtml}</th>`;
    }).join('');
    const allHeaders = '<th class="align-right row-index-col">ROW</th>' + colHeaders;
    const bootstrapPayloadJson = safeJsonForScript({
        initialColumns: columns,
        initialPayload
    });
    const initialBodyRowsHtml = renderRowCellsHtml(initialPayload.rowCells);

    const tableHtml = columns.length === 0
        ? `<div class="paging-toolbar" id="paging-toolbar">
                    <button id="rerun-sql" type="button" title="Refresh" aria-label="Refresh">&#x25B6;</button>
                    <span class="toolbar-spacer"></span>
                    <button id="toggle-sql-stmt" type="button" title="View SQL statement" aria-label="View SQL statement" aria-expanded="false">View SQL Stmt</button>
                </div>
                <p class="empty">No rows returned.</p>`
        : `<div class="paging-toolbar" id="paging-toolbar">
                    <button id="rerun-sql" type="button" title="Refresh" aria-label="Refresh">&#x25B6;</button>
                    <button id="first-page" type="button" title="Top" aria-label="Top"><<</button>
                    <button id="prev-page" type="button" title="Prior page" aria-label="Prior page"><</button>
                                <span id="page-summary">Page 1 of 1</span>
                    <button id="next-page" type="button" title="Next page" aria-label="Next page">></button>
                    <button id="last-page" type="button" title="Bottom" aria-label="Bottom">>></button>
                                <label for="page-size" title="Paging size">Paging Size:</label>
                                <select id="page-size" title="Paging size" aria-label="Paging size">
                                    <option value="AUTO" selected>Auto</option>
                                        <option value="25">25</option>
                                        <option value="50">50</option>
                                        <option value="100">100</option>
                                        <option value="250">250</option>
                                        <option value="500">500</option>
                                </select>
                            <button id="load-more" type="button" title="Load more result rows" aria-label="Load more result rows" hidden>Load more</button>
                            <button id="load-all" type="button" title="Load all remaining result rows" aria-label="Load all remaining result rows" hidden>Load all</button>
                    <span id="fetch-status" aria-live="polite">Initializing table features...</span>
                    <span class="toolbar-spacer"></span>
                            <button id="toggle-sql-stmt" type="button" title="View SQL statement" aria-label="View SQL statement" aria-expanded="false">View SQL Stmt</button>
                        </div>
                <p class="meta" id="result-meta"></p>
                    <div class="table-wrap"><table><thead><tr>${allHeaders}</tr></thead><tbody id="results-body">${initialBodyRowsHtml}</tbody></table></div>`;

    const sqlResultsScriptTag = scriptUri
        ? `<script src="${scriptUri}"></script>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} https: data:; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource};">
  <title>${PANEL_TITLE}</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --header-bg: color-mix(in srgb, var(--bg) 82%, var(--fg) 18%);
      --row-even: color-mix(in srgb, var(--bg) 90%, var(--fg) 10%);
      --row-odd: color-mix(in srgb, var(--bg) 96%, var(--fg) 4%);
    }
    body {
      margin: 0;
      padding: 14px;
      background: var(--bg);
      color: var(--fg);
      font: 12px/1.45 var(--vscode-editor-font-family, Consolas, monospace);
    }
    .sql {
            margin: 0 0 8px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
      white-space: pre-wrap;
      word-break: break-word;
            display: none;
        }
        .sql.is-visible {
            display: block;
    }
    .meta {
      margin: 0 0 10px;
      color: var(--muted);
    }
    .table-wrap {
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: auto;
      max-height: calc(100vh - 170px);
    }
        .paging-toolbar {
            display: flex;
            gap: 6px;
            align-items: center;
            margin: 0 0 10px;
            flex-wrap: wrap;
        }
        .fetch-toolbar {
            display: flex;
            gap: 8px;
            align-items: center;
            margin: 0 0 10px;
            flex-wrap: wrap;
        }
        .paging-toolbar button,
        .paging-toolbar select,
        .fetch-toolbar button {
            border: 1px solid var(--border);
            background: color-mix(in srgb, var(--bg) 92%, var(--fg) 8%);
            color: var(--fg);
            border-radius: 4px;
            padding: 3px 7px;
            font: inherit;
        }
        #rerun-sql {
            min-width: 28px;
            width: 28px;
            padding: 3px 0;
            font-weight: 700;
            font-size: 12px;
            line-height: 1;
        }
        .paging-toolbar button:disabled {
            opacity: 0.45;
            cursor: default;
        }
        .fetch-toolbar button:disabled {
            opacity: 0.45;
            cursor: default;
        }
        #page-summary {
            min-width: 170px;
            color: var(--muted);
        }
        #fetch-status {
            color: var(--muted);
        }
        .toolbar-spacer {
            flex: 1 1 auto;
        }
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      table-layout: auto;
    }
    .stacked-header {
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
        justify-content: flex-end;
      gap: 0;
      line-height: 1.15;
      white-space: normal;
      text-align: left;
        pointer-events: none;
    }
    .stacked-header span {
      display: block;
      min-width: 0;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: var(--header-bg);
      text-align: left;
      font-weight: 600;
      padding: 7px 8px;
      border-bottom: 1px solid var(--border);
      border-right: 1px solid var(--border);
      white-space: nowrap;
            vertical-align: bottom;
            position: sticky;
    }
        thead th.sortable-col {
            cursor: pointer;
            user-select: none;
            padding-right: 16px;
        }
        thead th.sortable-col:hover {
            background: color-mix(in srgb, var(--header-bg) 82%, var(--fg) 18%);
        }
        thead th.sortable-col.is-sorted::after {
            content: ' \\25B2';
            font-size: 10px;
            opacity: 0.9;
            margin-left: 4px;
        }
        thead th.sortable-col.is-sorted.is-desc::after {
            content: ' \\25BC';
        }
        .col-resize-handle {
            position: absolute;
            top: 0;
            right: -2px;
            width: 8px;
            height: 100%;
            cursor: col-resize;
            z-index: 3;
        }
        .col-resize-handle:hover {
            background: color-mix(in srgb, var(--vscode-focusBorder, var(--fg)) 45%, transparent);
        }
        body.is-col-resizing,
        body.is-col-resizing * {
            cursor: col-resize !important;
            user-select: none;
        }
    tbody td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--border);
      border-right: 1px solid var(--border);
      vertical-align: top;
      white-space: pre-wrap;
      word-break: break-word;
      max-width: 440px;
    }
    th.align-right,
    td.align-right {
      text-align: right;
      font-variant-numeric: tabular-nums;
    }
        th.row-index-col,
        td.row-index-col {
            position: sticky;
            left: 0;
            z-index: 2;
            background: var(--header-bg);
        }
        td.row-index-col {
            z-index: 1;
            background: color-mix(in srgb, var(--bg) 94%, var(--fg) 6%);
        }
    tbody tr:nth-child(odd) { background: var(--row-odd); }
    tbody tr:nth-child(even) { background: var(--row-even); }
    .empty {
      color: var(--muted);
      margin: 12px 0 0;
    }
  </style>
</head>
<body>
    <pre class="sql" id="sql-statement">${escapeHtml(result.statement)}</pre>
    <pre id="sql-results-bootstrap" style="display:none">${escapeHtml(bootstrapPayloadJson)}</pre>
  ${tableHtml}
    ${sqlResultsScriptTag}
</body>
</html>`;
}

function buildClientPayload(result: SqlResultPayload) {
    const columns = result.columns;
    const profiles = buildColumnProfiles(columns, result.rows);
    const rowCells = result.rows.map((row) => {
        return columns.map((column) => {
            const profile = profiles[column];
            const alignClass = shouldRightAlign(profile.kind) ? 'align-right' : '';
            return {
                alignClass,
                html: formatCell(row[column], profile),
                sortKind: profile.kind,
                sortText: sortableTextValue(row[column]),
                sortNumber: sortableNumericValue(row[column], profile.kind)
            };
        });
    });

    return {
        rowCells,
        rowCount: result.rowCount,
        displayedRowCount: result.displayedRowCount,
        sessionId: result.sessionId ?? '',
        hasMoreRows: !!result.hasMoreRows,
        fetchSize: result.fetchSize ?? 0,
        prefetchSize: result.prefetchSize ?? 0,
        columnMetadata: result.columnMetadata ?? []
    };
}

function renderRowCellsHtml(rowCells: Array<Array<{ alignClass?: string; html: string }>>): string {
    return rowCells.map((cells, index) => {
        const tds = cells.map((cell) => {
            const alignClass = cell.alignClass ? ` class="${cell.alignClass}"` : '';
            return `<td${alignClass}>${cell.html}</td>`;
        }).join('');
        return `<tr><td class="align-right row-index-col">${index + 1}</td>${tds}</tr>`;
    }).join('');
}

function sortableTextValue(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'object') {
        try {
            return JSON.stringify(value);
        } catch (_stringifyError) {
            return String(value);
        }
    }
    return String(value);
}

function sortableNumericValue(value: unknown, kind: ColumnKind): number | undefined {
    if (value === null || value === undefined) {
        return undefined;
    }

    if (kind === 'number') {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }
        const text = String(value).trim();
        return isNumericText(text) ? Number(text) : undefined;
    }

    if (value instanceof Date) {
        return value.getTime();
    }

    const text = String(value).trim();
    if (!text) {
        return undefined;
    }

    if (kind === 'timestamp' || kind === 'date') {
        const parsed = Date.parse(text);
        return Number.isFinite(parsed) ? parsed : undefined;
    }

    if (kind === 'time') {
        const match = text.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?$/);
        if (!match) {
            return undefined;
        }
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        const seconds = Number(match[3] || '0');
        const fractional = String(match[4] || '').padEnd(6, '0').slice(0, 6);
        const micros = Number(fractional || '0');
        return (((hours * 60 + minutes) * 60 + seconds) * 1000000) + micros;
    }

    return undefined;
}

function normalizeColumnKey(value: string | undefined): string {
    return (value ?? '').trim().toUpperCase();
}

function findMetadataForColumn(columnName: string, metadata: SqlColumnMetadata[] | undefined): SqlColumnMetadata | undefined {
    if (!metadata || metadata.length === 0) {
        return undefined;
    }

    const match = metadata.find((entry) => normalizeColumnKey(entry.name) === normalizeColumnKey(columnName));
    return match ?? metadata.find((entry) => normalizeColumnKey(entry.label) === normalizeColumnKey(columnName));
}

function resolveColumnHeaderText(columnName: string, metadata?: SqlColumnMetadata): string {
    const preferred = metadata?.label?.trim() || metadata?.name?.trim() || columnName;
    const cleaned = preferred.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!cleaned || cleaned.toUpperCase() === columnName.toUpperCase()) {
        return columnName;
    }
    return cleaned;
}

function buildColumnHeaderTooltip(columnName: string, metadata?: SqlColumnMetadata): string {
    const typeName = metadata?.typeName?.trim() || 'UNKNOWN';
    const displaySize = typeof metadata?.displaySize === 'number' ? metadata.displaySize : undefined;
    const scale = typeof metadata?.scale === 'number' ? metadata.scale : undefined;
    const textDescription = metadata?.textDescription?.trim();
    const ddsType = metadata?.ddsType?.trim();
    const isIdentity = metadata?.isIdentity;
    const label = metadata?.label?.trim();
    const isExactNumeric = /^(NUMERIC|DECIMAL|DEC)$/i.test(typeName);
    const sqlType = displaySize && displaySize > 0
        ? (isExactNumeric && scale != null && scale >= 0 ? `${typeName}(${displaySize}, ${scale})` : `${typeName}(${displaySize})`)
        : typeName;
    const lines: string[] = [];
    if (label && label.toUpperCase() !== columnName.toUpperCase()) {
        lines.push(`Heading: ${label}`);
    }
    if (textDescription && textDescription.toUpperCase() !== columnName.toUpperCase() && (!label || textDescription.toUpperCase() !== label.toUpperCase())) {
        lines.push(`Text: ${textDescription}`);
    }
    lines.push(`Column: ${columnName}`);
    lines.push(`Type: ${sqlType}`);
    if (ddsType) {
        lines.push(`DDS Type: ${ddsType}`);
    }
    if (typeof isIdentity === 'boolean') {
        lines.push(`Identity: ${isIdentity ? 'Yes' : 'No'}`);
    }
    return lines.join('\n');
}

function renderColumnHeaderHtml(displayText: string): string {
    const lines = displayText
        .replace(/\r?\n/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3);

    const visibleLines = lines.length > 0 ? lines : [displayText];
    const spans = visibleLines.map((line) => `<span>${escapeHtml(line)}</span>`).join('');
    return `<div class="stacked-header">${spans}</div>`;
}

function safeJsonForScript<T>(value: T): string {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e')
        .replace(/&/g, '\\u0026')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029')
        .replace(/<\/script/gi, '<\\/script');
}

type ColumnKind = 'number' | 'date' | 'time' | 'timestamp' | 'text';

interface ColumnProfile {
    kind: ColumnKind;
    fractionDigits: number;
}

const MIN_FRACTION_DIGITS_FALLBACK = 2;

function formatCell(value: unknown, profile: ColumnProfile): string {
    if (value === null || value === undefined) {
        return '<span style="opacity:.7">NULL</span>';
    }

    if (value instanceof Date) {
        return escapeHtml(value.toISOString());
    }

    if (typeof value === 'object') {
        try {
            return escapeHtml(JSON.stringify(value));
        } catch (_jsonError) {
            return escapeHtml(String(value));
        }
    }

    if (profile.kind === 'number') {
        if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                return escapeHtml(String(value));
            }
            const digits = Math.max(profile.fractionDigits, MIN_FRACTION_DIGITS_FALLBACK);
            return escapeHtml(value.toFixed(digits));
        }

        // Keep exact text when DB returns numeric values as strings.
        return escapeHtml(String(value));
    }

    return escapeHtml(String(value));
}

function buildColumnProfiles(columns: string[], rows: Record<string, unknown>[]): Record<string, ColumnProfile> {
    const out: Record<string, ColumnProfile> = {};
    for (const column of columns) {
        out[column] = profileColumn(rows, column);
    }
    return out;
}

function profileColumn(rows: Record<string, unknown>[], column: string): ColumnProfile {
    let kind: ColumnKind = 'text';
    let fractionDigits = 0;
    let sawFractionalNumber = false;

    for (const row of rows) {
        const value = row[column];
        if (value === null || value === undefined) {
            continue;
        }

        if (value instanceof Date) {
            kind = 'timestamp';
            continue;
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            kind = 'number';
            if (!Number.isInteger(value)) {
                sawFractionalNumber = true;
                fractionDigits = Math.max(fractionDigits, countFractionDigits(value));
            }
            continue;
        }

        const text = String(value).trim();
        if (!text) {
            continue;
        }

        if (isNumericText(text)) {
            kind = 'number';
            fractionDigits = Math.max(fractionDigits, fractionDigitsFromText(text));
            continue;
        }

        if (isTimestampText(text)) {
            if (kind === 'text') { kind = 'timestamp'; }
            continue;
        }

        if (isDateText(text)) {
            if (kind === 'text') { kind = 'date'; }
            continue;
        }

        if (isTimeText(text)) {
            if (kind === 'text') { kind = 'time'; }
            continue;
        }

        kind = 'text';
        break;
    }

    if (kind === 'number' && sawFractionalNumber && fractionDigits === 0) {
        fractionDigits = MIN_FRACTION_DIGITS_FALLBACK;
    }

    return { kind, fractionDigits };
}

function shouldRightAlign(kind: ColumnKind): boolean {
    return kind === 'number' || kind === 'date' || kind === 'time' || kind === 'timestamp';
}

function isNumericText(value: string): boolean {
    return /^[-+]?\d+(?:\.\d+)?$/.test(value);
}

function fractionDigitsFromText(value: string): number {
    const dot = value.indexOf('.');
    return dot === -1 ? 0 : value.length - dot - 1;
}

function countFractionDigits(value: number): number {
    const text = String(value);
    if (text.includes('e') || text.includes('E')) {
        const [, expText] = text.split(/[eE]/);
        const exp = Number(expText);
        if (Number.isNaN(exp)) {
            return 0;
        }
        const normalized = value.toFixed(Math.max(0, MIN_FRACTION_DIGITS_FALLBACK - exp));
        return fractionDigitsFromText(normalized);
    }
    return fractionDigitsFromText(text);
}

function isDateText(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isTimeText(value: string): boolean {
    return /^\d{2}:\d{2}:\d{2}(?:\.\d{1,12})?$/.test(value);
}

function isTimestampText(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,12})?$/.test(value);
}

function escapeHtml(input: string): string {
    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
