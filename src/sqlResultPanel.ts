import * as vscode from 'vscode';
import { SqlResultPayload } from './commandEntryModel';

const PANEL_TYPE = 'clprompter.sqlResults';
const PANEL_TITLE = 'CLPROMPTER SQL Results';

type SqlResultPanelRequest =
    | { type: 'loadMore'; sessionId: string }
    | { type: 'loadAll'; sessionId: string }
    | { type: 'prefetch'; sessionId: string }
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
                { enableScripts: true, retainContextWhenHidden: true }
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
        this.panel.webview.html = renderSqlResultHtml(result);
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

        const request = message as { type?: string; sessionId?: string };
        if (!request.type || !request.sessionId) {
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

export function showSqlResultPanel(result: SqlResultPayload): void {
    singletonPanel.show(result);
}

export function setSqlResultPanelRequestHandler(handler: SqlResultPanelRequestHandler | undefined): void {
    singletonPanel.setRequestHandler(handler);
}

export function notifySqlResultSessionClosed(message?: string): void {
    singletonPanel.markSessionClosed(message);
}

function renderSqlResultHtml(result: SqlResultPayload): string {
    const columns = result.columns;
    const profiles = buildColumnProfiles(columns, result.rows);
    const colHeaders = columns.map((column) => {
        const profile = profiles[column];
        const alignClass = shouldRightAlign(profile.kind) ? ' class="align-right"' : '';
        return `<th${alignClass}>${escapeHtml(column)}</th>`;
    }).join('');
    const allHeaders = '<th class="align-right row-index-col">ROW</th>' + colHeaders;
    const initialPayloadJson = safeJsonForScript(buildClientPayload(result));

    const tableHtml = columns.length === 0
        ? '<p class="empty">No columns were returned by this statement.</p>'
        : `<div class="paging-toolbar" id="paging-toolbar">
                    <button id="first-page" type="button" title="Top" aria-label="Top"><<</button>
                    <button id="prev-page" type="button" title="Prior page" aria-label="Prior page"><</button>
                                <span id="page-summary">Page 1 of 1</span>
                    <button id="next-page" type="button" title="Next page" aria-label="Next page">></button>
                    <button id="last-page" type="button" title="Bottom" aria-label="Bottom">>></button>
                                <label for="page-size">Rows:</label>
                                <select id="page-size" aria-label="Rows per page">
                                        <option value="25">25</option>
                                        <option value="50" selected>50</option>
                                        <option value="100">100</option>
                                        <option value="250">250</option>
                                        <option value="500">500</option>
                                </select>
                    <button id="load-more" type="button" hidden>Load next</button>
                    <button id="load-all" type="button" hidden>Load all</button>
                    <span id="fetch-status" aria-live="polite"></span>
                        </div>
                <p class="meta" id="result-meta"></p>
                        <div class="table-wrap"><table><thead><tr>${allHeaders}</tr></thead><tbody id="results-body"></tbody></table></div>`;

    const pagingScript = columns.length === 0
        ? ''
        : `<script>
(() => {
    const vscode = acquireVsCodeApi();
    const initialPayload = ${initialPayloadJson};
    let sessionId = initialPayload.sessionId || '';
    let hasMoreRows = !!initialPayload.hasMoreRows;
    let fetchSize = Number(initialPayload.fetchSize || 0);
    let prefetchSize = Number(initialPayload.prefetchSize || 0);
    let rows = initialPayload.rowCells || [];
    const tbody = document.getElementById('results-body');
    const firstBtn = document.getElementById('first-page');
    const prevBtn = document.getElementById('prev-page');
    const nextBtn = document.getElementById('next-page');
    const lastBtn = document.getElementById('last-page');
    const pageSizeSelect = document.getElementById('page-size');
    const pageSummary = document.getElementById('page-summary');
    const loadMoreBtn = document.getElementById('load-more');
    const loadAllBtn = document.getElementById('load-all');
    const fetchStatus = document.getElementById('fetch-status');
    const resultMeta = document.getElementById('result-meta');
    const tableWrap = document.querySelector('.table-wrap');

    let pageSize = Number(pageSizeSelect?.value || 50);
    let pageIndex = 0;
    let loadInFlight = false;
    let sessionUnavailable = false;
    let rowOffsets = [];

    function updateMeta() {
        if (!resultMeta) return;
        if (hasMoreRows) {
            resultMeta.textContent = 'Loaded ' + rows.length + ' rows. More rows are available.';
            return;
        }
        resultMeta.textContent = rows.length + ' rows returned.';
    }

    function setFetchLoading(isLoading, statusText) {
        loadInFlight = isLoading;
        if (loadMoreBtn) loadMoreBtn.disabled = isLoading;
        if (loadAllBtn) loadAllBtn.disabled = isLoading;
        if (fetchStatus) {
            fetchStatus.textContent = statusText || '';
        }
    }

    function updateFetchControls() {
        const canFetchMore = !!sessionId && hasMoreRows;
        if (loadMoreBtn) {
            loadMoreBtn.hidden = !canFetchMore;
            if (canFetchMore) {
                const nextSize = fetchSize > 0 ? fetchSize : 1000;
                loadMoreBtn.textContent = 'Load next ' + nextSize;
            }
        }
        if (loadAllBtn) {
            loadAllBtn.hidden = !canFetchMore;
        }
    }

    function requestRows(requestType, statusText) {
        if (!sessionId || !hasMoreRows || loadInFlight || sessionUnavailable) {
            return;
        }
        setFetchLoading(true, statusText);
        vscode.postMessage({ type: requestType, sessionId });
    }

    function isTerminalSessionError(messageText) {
        if (!messageText) {
            return false;
        }
        const normalized = String(messageText).toLowerCase();
        return normalized.includes('session is no longer available')
            || normalized.includes('run the sql statement again')
            || normalized.includes('connection close')
            || normalized.includes('connection closed');
    }

    function maybePrefetchNearEnd(totalPages) {
        if (!sessionId || !hasMoreRows || loadInFlight) {
            return;
        }
        if (pageIndex >= Math.max(0, totalPages - 2)) {
            const sizeText = prefetchSize > 0 ? prefetchSize : 200;
            requestRows('prefetch', 'Prefetching next ' + sizeText + ' rows...');
        }
    }

    function getRenderedRows() {
        if (!tbody) {
            return [];
        }
        return Array.from(tbody.querySelectorAll('tr'));
    }

    function rebuildRowOffsets() {
        const renderedRows = getRenderedRows();
        rowOffsets = renderedRows.map((row) => row.offsetTop);
    }

    function findRowIndexForScrollTop(scrollTop) {
        if (!rowOffsets.length) {
            return 0;
        }

        let low = 0;
        let high = rowOffsets.length - 1;
        let best = 0;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (rowOffsets[mid] <= scrollTop) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return best;
    }

    function getTopVisibleRowIndex() {
        if (!tableWrap) {
            return 0;
        }
        if (rowOffsets.length === 0) {
            return 0;
        }
        return findRowIndexForScrollTop(tableWrap.scrollTop + 1);
    }

    function getCurrentPageIndex() {
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        const topRowIndex = getTopVisibleRowIndex();
        return Math.max(0, Math.min(totalPages - 1, Math.floor(topRowIndex / pageSize)));
    }

    function syncPageFromScroll() {
        pageIndex = getCurrentPageIndex();
    }

    function updatePageControls() {
        const totalRows = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));

        if (pageIndex > totalPages - 1) {
            pageIndex = totalPages - 1;
        }

        if (pageSummary) {
            pageSummary.textContent = 'Page ' + (pageIndex + 1) + ' of ' + totalPages + ' (' + totalRows + ' rows)';
        }
        if (firstBtn) firstBtn.disabled = pageIndex === 0;
        if (prevBtn) prevBtn.disabled = pageIndex === 0;
        if (nextBtn) nextBtn.disabled = pageIndex >= totalPages - 1;
        if (lastBtn) lastBtn.disabled = pageIndex >= totalPages - 1;

        maybePrefetchNearEnd(totalPages);
    }

    function renderRows(preserveScroll) {
        if (!tbody) return;
        const previousScrollTop = tableWrap ? tableWrap.scrollTop : 0;
        tbody.innerHTML = rows.map((cells, index) => {
            const tds = cells.map((cell) => {
                const alignClass = cell.alignClass ? ' class="' + cell.alignClass + '"' : '';
                return '<td' + alignClass + '>' + cell.html + '</td>';
            }).join('');
            return '<tr><td class="align-right row-index-col">' + (index + 1) + '</td>' + tds + '</tr>';
        }).join('');

        if (tableWrap) {
            if (preserveScroll) {
                tableWrap.scrollTop = Math.min(previousScrollTop, tableWrap.scrollHeight);
            } else {
                tableWrap.scrollTop = 0;
            }
        }

        rebuildRowOffsets();

        syncPageFromScroll();
        updatePageControls();
    }

    function jumpToRow(rowIndex) {
        if (!tableWrap) {
            return;
        }
        if (rows.length === 0) {
            pageIndex = 0;
            updatePageControls();
            return;
        }

        const targetRow = Math.max(0, Math.min(rows.length - 1, rowIndex));
        if (targetRow >= rowOffsets.length) {
            return;
        }

        tableWrap.scrollTop = Math.max(0, rowOffsets[targetRow]);
        syncPageFromScroll();
        updatePageControls();
    }

    firstBtn?.addEventListener('click', () => {
        jumpToRow(0);
    });

    prevBtn?.addEventListener('click', () => {
        const targetPageIndex = Math.max(0, getCurrentPageIndex() - 1);
        jumpToRow(targetPageIndex * pageSize);
    });

    nextBtn?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        const targetPageIndex = Math.min(totalPages - 1, getCurrentPageIndex() + 1);
        jumpToRow(targetPageIndex * pageSize);
    });

    lastBtn?.addEventListener('click', () => {
        const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
        const targetPageIndex = Math.max(0, totalPages - 1);
        jumpToRow(targetPageIndex * pageSize);
    });

    pageSizeSelect?.addEventListener('change', () => {
        pageSize = Math.max(1, Number(pageSizeSelect.value || 50));
        syncPageFromScroll();
        updatePageControls();
    });

    loadMoreBtn?.addEventListener('click', () => {
        requestRows('loadMore', 'Loading next rows...');
    });

    loadAllBtn?.addEventListener('click', () => {
        requestRows('loadAll', 'Loading all remaining rows...');
    });

    tableWrap?.addEventListener('scroll', () => {
        syncPageFromScroll();
        updatePageControls();

        if (!tableWrap || loadInFlight || !sessionId || !hasMoreRows) {
            return;
        }
        const nearBottom = (tableWrap.scrollTop + tableWrap.clientHeight) >= (tableWrap.scrollHeight - 120);
        if (nearBottom) {
            const sizeText = prefetchSize > 0 ? prefetchSize : 200;
            requestRows('prefetch', 'Prefetching next ' + sizeText + ' rows...');
        }
    });

    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message) {
            return;
        }

        if (message.type === 'sqlSessionClosed') {
            if (!message.sessionId || !sessionId || message.sessionId !== sessionId) {
                return;
            }

            const noticeText = message.message || 'SQL result session is no longer available. Run the SQL statement again.';
            sessionUnavailable = true;
            sessionId = '';
            hasMoreRows = false;
            updateFetchControls();
            setFetchLoading(false, noticeText);
            return;
        }

        if (message.type === 'loadError') {
            const errorText = message.message || 'Unable to load additional rows.';
            if (isTerminalSessionError(errorText)) {
                sessionUnavailable = true;
                sessionId = '';
                hasMoreRows = false;
                updateFetchControls();
            }
            setFetchLoading(false, errorText);
            return;
        }

        if (message.type !== 'sqlResultReplace' || !message.payload) {
            return;
        }

        const payload = message.payload;
        rows = Array.isArray(payload.rowCells) ? payload.rowCells : [];
        sessionId = payload.sessionId || '';
        hasMoreRows = !!payload.hasMoreRows;
        fetchSize = Number(payload.fetchSize || 0);
        prefetchSize = Number(payload.prefetchSize || 0);
        sessionUnavailable = false;
        updateMeta();
        updateFetchControls();
        setFetchLoading(false, hasMoreRows ? 'Additional rows loaded.' : 'All rows loaded.');
        renderRows(true);
    });

    updateMeta();
    updateFetchControls();

    renderRows(false);
})();
</script>`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    table {
      width: max-content;
      min-width: 100%;
      border-collapse: collapse;
      table-layout: auto;
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
  <pre class="sql">${escapeHtml(result.statement)}</pre>
  ${tableHtml}
    ${pagingScript}
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
                html: formatCell(row[column], profile)
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
        prefetchSize: result.prefetchSize ?? 0
    };
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
        } catch {
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
