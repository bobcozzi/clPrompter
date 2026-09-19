import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SqlColumnMetadata, SqlResultPayload } from './commandEntryModel';

const PANEL_TYPE = 'clprompter.sqlResults';
const PANEL_TITLE = 'SQL Results';
const SQL_RESULT_TEMPLATE_NAME = 'sqlResultPanel.html';

interface SqlResultPanelL10n {
    sqlResultsTitle: string;
    refresh: string;
    top: string;
    priorPage: string;
    nextPage: string;
    bottom: string;
    pagingSize: string;
    auto: string;
    viewSqlStmt: string;
    hideSqlStmt: string;
    showFullSqlStatement: string;
    hideSqlStatement: string;
    noRowsReturned: string;
    loadMore: string;
    loadAll: string;
    loadMoreResultRows: string;
    loadAllRemainingResultRows: string;
    allRowsReturnedButton: string;
    loadNextRowsTemplate: string;
    loadingNextRows: string;
    loadingAllRemainingRows: string;
    stop: string;
    stoppingRequested: string;
    stoppedFetchAfterRowTemplate: string;
    loadAllComplete: string;
    loadedRowsTemplate: string;
    moreRowsAvailableTemplate: string;
    rowsReturnedTemplate: string;
    noSqlStatementToRerun: string;
    rerunningSqlStatement: string;
    unableToLoadAdditionalRows: string;
    sqlSessionNoLongerAvailable: string;
    sortedColumnTemplate: string;
    resizedColumnTemplate: string;
    dragToResizeColumn: string;
    resultSetRefreshedTemplate: string;
    additionalRowsLoadedTemplate: string;
    allRowsLoaded: string;
    switchToRowView: string;
    switchToColumnView: string;
    rowViewButton: string;
    columnViewButton: string;
    columnIdHeader: string;
    dataHeader: string;
    copyResultSet: string;
    saveResultSet: string;
    copyToClipboard: string;
    copyToCommandEntry: string;
}

type ExportFormat = 'csv' | 'tsv' | 'json' | 'md';
type DelimitedSeparator = ',' | '|' | '\t';

type ExportSelection = {
    format: ExportFormat;
    separator?: DelimitedSeparator;
    extension: string;
    formatLabel: string;
};

function getSqlResultPanelL10n(): SqlResultPanelL10n {
    return {
        sqlResultsTitle: vscode.l10n.t('SQL Results'),
        refresh: vscode.l10n.t('Refresh'),
        top: vscode.l10n.t('Top'),
        priorPage: vscode.l10n.t('Prior page'),
        nextPage: vscode.l10n.t('Next page'),
        bottom: vscode.l10n.t('Bottom'),
        pagingSize: vscode.l10n.t('Paging size'),
        auto: vscode.l10n.t('Auto'),
        viewSqlStmt: vscode.l10n.t('<sql>'),
        hideSqlStmt: vscode.l10n.t('</sql>'),
        showFullSqlStatement: vscode.l10n.t('Show full SQL stmt'),
        hideSqlStatement: vscode.l10n.t('Hide SQL stmt'),
        noRowsReturned: vscode.l10n.t('No rows returned.'),
        loadMore: vscode.l10n.t('Load more'),
        loadAll: vscode.l10n.t('Load all'),
        loadMoreResultRows: vscode.l10n.t('Load more rows'),
        loadAllRemainingResultRows: vscode.l10n.t('Load all rows'),
        allRowsReturnedButton: vscode.l10n.t('All rows returned'),
        loadNextRowsTemplate: vscode.l10n.t('Load next {count} rows', { count: '{count}' }),
        loadingNextRows: vscode.l10n.t('Loading next rows...'),
        loadingAllRemainingRows: vscode.l10n.t('Loading all remaining rows...'),
        stop: vscode.l10n.t('Stop'),
        stoppingRequested: vscode.l10n.t('Stopping requested...'),
        stoppedFetchAfterRowTemplate: vscode.l10n.t('Stopped fetch after row {count}', { count: '{count}' }),
        loadAllComplete: vscode.l10n.t('Load all complete.'),
        loadedRowsTemplate: vscode.l10n.t('Loaded {count} rows...', { count: '{count}' }),
        moreRowsAvailableTemplate: vscode.l10n.t('{count} rows loaded. More available.', { count: '{count}' }),
        rowsReturnedTemplate: vscode.l10n.t('{count} rows returned.', { count: '{count}' }),
        noSqlStatementToRerun: vscode.l10n.t('No SQL statement available to rerun.'),
        rerunningSqlStatement: vscode.l10n.t('Rerunning SQL statement...'),
        unableToLoadAdditionalRows: vscode.l10n.t('Unable to load additional rows.'),
        sqlSessionNoLongerAvailable: vscode.l10n.t('SQL result session is no longer available. Run the SQL statement again.'),
        sortedColumnTemplate: vscode.l10n.t('Sorted column {column} ({direction}).', { column: '{column}', direction: '{direction}' }),
        resizedColumnTemplate: vscode.l10n.t('Resized column {column}.', { column: '{column}' }),
        dragToResizeColumn: vscode.l10n.t('Drag to resize column'),
        resultSetRefreshedTemplate: vscode.l10n.t('Result set refreshed ({count} rows currently loaded).', { count: '{count}' }),
        additionalRowsLoadedTemplate: vscode.l10n.t('Additional rows loaded ({count} total).', { count: '{count}' }),
        allRowsLoaded: vscode.l10n.t('All rows loaded.'),
        switchToRowView: vscode.l10n.t('Switch to row view'),
        switchToColumnView: vscode.l10n.t('Switch to column view'),
        rowViewButton: vscode.l10n.t('<row view>'),
        columnViewButton: vscode.l10n.t('<column view>'),
        columnIdHeader: vscode.l10n.t('Column ID'),
        dataHeader: vscode.l10n.t('Data'),
        copyResultSet: vscode.l10n.t('Copy result set'),
        saveResultSet: vscode.l10n.t('Save result set'),
        copyToClipboard: vscode.l10n.t('Copy to Clipboard'),
        copyToCommandEntry: vscode.l10n.t('Copy to Command Entry')
    };
}

function readSqlResultTemplate(): string | undefined {
    try {
        const templatePath = path.join(__dirname, '..', 'media', SQL_RESULT_TEMPLATE_NAME);
        return fs.readFileSync(templatePath, 'utf8');
    } catch {
        return undefined;
    }
}

function renderIconButton(id: string, title: string, iconName: string): string {
    return `<button id="${id}" type="button" class="icon-button" title="${escapeHtml(title)}" data-tooltip="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><span class="codicon codicon-${escapeHtml(iconName)}" aria-hidden="true"></span></button>`;
}

type SqlResultPanelRequest =
    | { type: 'loadMore'; sessionId: string }
    | { type: 'loadAll'; sessionId: string }
    | { type: 'stopLoadAll'; sessionId: string }
    | { type: 'prefetch'; sessionId: string }
    | { type: 'rerunSql'; statement: string; resultTitle?: string }
    | { type: 'copyResultSet'; columns: string[]; rows: string[][] }
    | { type: 'saveResultSet'; columns: string[]; rows: string[][]; resultTitle?: string }
    | { type: 'copyCellToClipboard'; value: string }
    | { type: 'copyCellToCommandEntry'; value: string }
    | { type: 'closeSession'; sessionId: string };

type SqlResultPanelRequestHandler = (request: SqlResultPanelRequest) => Promise<SqlResultPayload | undefined>;

class SqlResultPanel {
    private panel: vscode.WebviewPanel | undefined;
    private requestHandler: SqlResultPanelRequestHandler | undefined;
    private activeSessionId: string | undefined;
    private activeResultTitle: string | undefined;
    private loadAllInProgress = false;
    private stopLoadAllRequested = false;
    private readonly l10n = getSqlResultPanelL10n();

    private sanitizeExportBaseName(value?: string): string {
        const base = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
        return base || 'sql-results';
    }

    private escapeCsvCell(value: string): string {
        if (/[,"\r\n]/.test(value)) {
            return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
    }

    private serializeDelimited(columns: string[], rows: string[][], delimiter: DelimitedSeparator): string {
        const quoteCell = delimiter === ','
            ? (value: string) => this.escapeCsvCell(value)
            : (value: string) => this.escapeCsvCell(value);
        const header = columns.map((column) => quoteCell(String(column ?? ''))).join(delimiter);
        const body = rows.map((row) => columns.map((_column, index) => quoteCell(String((row && row[index]) ?? ''))).join(delimiter));
        return [header, ...body].join('\n');
    }

    private serializeJson(columns: string[], rows: string[][]): string {
        const payload = rows.map((row) => {
            const entry: Record<string, string> = {};
            for (let i = 0; i < columns.length; i += 1) {
                entry[String(columns[i] ?? '')] = String((row && row[i]) ?? '');
            }
            return entry;
        });
        return JSON.stringify(payload, null, 2);
    }

    private escapeMarkdownCell(value: string): string {
        return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    }

    private serializeMarkdown(columns: string[], rows: string[][]): string {
        const header = `| ${columns.map((column) => this.escapeMarkdownCell(String(column ?? ''))).join(' | ')} |`;
        const separator = `| ${columns.map(() => '---').join(' | ')} |`;
        const body = rows.map((row) => `| ${columns.map((_column, index) => this.escapeMarkdownCell(String((row && row[index]) ?? ''))).join(' | ')} |`);
        return [header, separator, ...body].join('\n');
    }

    private serializeResultSet(selection: ExportSelection, columns: string[], rows: string[][]): string {
        switch (selection.format) {
            case 'csv':
                return this.serializeDelimited(columns, rows, selection.separator ?? ',');
            case 'tsv':
                return this.serializeDelimited(columns, rows, '\t');
            case 'json':
                return this.serializeJson(columns, rows);
            case 'md':
                return this.serializeMarkdown(columns, rows);
            default:
                return this.serializeDelimited(columns, rows, ',');
        }
    }

    private async promptCsvSeparator(action: 'copy' | 'save'): Promise<ExportSelection | undefined> {
        const pick = await vscode.window.showQuickPick<{
            label: string;
            description: string;
            separator: DelimitedSeparator;
            extension: string;
            formatLabel: string;
        }>([
            {
                label: vscode.l10n.t('Comma (,)'),
                description: vscode.l10n.t('Standard CSV format'),
                separator: ',',
                extension: 'csv',
                formatLabel: 'CSV'
            },
            {
                label: vscode.l10n.t('Bar (|)'),
                description: vscode.l10n.t('Pipe-separated values'),
                separator: '|',
                extension: 'psv',
                formatLabel: 'CSV (|)'
            },
            {
                label: vscode.l10n.t('Tab'),
                description: vscode.l10n.t('Tab-separated values (best for copy/paste into Excel)'),
                separator: '\t',
                extension: 'tsv',
                formatLabel: 'TSV'
            }
        ], {
            title: action === 'copy' ? vscode.l10n.t('CSV Delimiter for Copy') : vscode.l10n.t('CSV Delimiter for Save'),
            placeHolder: action === 'copy'
                ? vscode.l10n.t('Choose a delimiter for copied CSV data')
                : vscode.l10n.t('Choose a delimiter for saved CSV data')
        });

        if (!pick) {
            return undefined;
        }

        return {
            format: 'csv',
            separator: pick.separator,
            extension: pick.extension,
            formatLabel: pick.formatLabel
        };
    }

    private async promptExportFormat(action: 'copy' | 'save'): Promise<ExportSelection | undefined> {
        const pick = await vscode.window.showQuickPick<{
            label: string;
            description: string;
            format: ExportFormat;
        }>([
            { label: 'CSV', description: vscode.l10n.t('Delimited text with selectable separator'), format: 'csv' },
            { label: 'JSON', description: vscode.l10n.t('JSON array of row objects'), format: 'json' },
            { label: 'Markdown', description: vscode.l10n.t('Markdown table format'), format: 'md' },
        ], {
            title: action === 'copy' ? vscode.l10n.t('Copy Result Set Format') : vscode.l10n.t('Save Result Set Format'),
            placeHolder: action === 'copy'
                ? vscode.l10n.t('Choose a format to copy')
                : vscode.l10n.t('Choose a format to save')
        });

        if (!pick) {
            return undefined;
        }

        if (pick.format === 'csv') {
            return this.promptCsvSeparator(action);
        }

        if (pick.format === 'json') {
            return { format: 'json', extension: 'json', formatLabel: 'JSON' };
        }

        if (pick.format === 'md') {
            return { format: 'md', extension: 'md', formatLabel: 'MD' };
        }

        return { format: 'csv', separator: ',', extension: 'csv', formatLabel: 'CSV' };
    }

    private normalizeColumns(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }
        return value.map((entry) => String(entry ?? ''));
    }

    private normalizeRows(value: unknown, columnCount: number): string[][] {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .filter((row): row is unknown[] => Array.isArray(row))
            .map((row) => {
                const normalized: string[] = [];
                for (let i = 0; i < columnCount; i += 1) {
                    normalized.push(String(row[i] ?? ''));
                }
                return normalized;
            });
    }

    private async handleCopyResultSet(columnsInput: unknown, rowsInput: unknown): Promise<void> {
        const columns = this.normalizeColumns(columnsInput);
        const rows = this.normalizeRows(rowsInput, columns.length);
        if (columns.length === 0) {
            void vscode.window.showWarningMessage(vscode.l10n.t('No result columns available to copy.'));
            return;
        }

        const selection = await this.promptExportFormat('copy');
        if (!selection) {
            return;
        }

        const text = this.serializeResultSet(selection, columns, rows);
        await vscode.env.clipboard.writeText(text);
        void vscode.window.showInformationMessage(vscode.l10n.t('Copied result set to clipboard as {format}.', { format: selection.formatLabel }));
    }

    private async handleSaveResultSet(columnsInput: unknown, rowsInput: unknown, resultTitleInput: unknown): Promise<void> {
        const columns = this.normalizeColumns(columnsInput);
        const rows = this.normalizeRows(rowsInput, columns.length);
        if (columns.length === 0) {
            void vscode.window.showWarningMessage(vscode.l10n.t('No result columns available to save.'));
            return;
        }

        const selection = await this.promptExportFormat('save');
        if (!selection) {
            return;
        }

        const baseName = this.sanitizeExportBaseName(typeof resultTitleInput === 'string' ? resultTitleInput : this.activeResultTitle);
        const defaultFileName = `${baseName}.${selection.extension}`;
        const uri = await vscode.window.showSaveDialog({
            saveLabel: vscode.l10n.t('Save Result Set'),
            defaultUri: vscode.Uri.file(path.join(process.cwd(), defaultFileName)),
            filters: {
                [selection.formatLabel]: [selection.extension],
                [vscode.l10n.t('All files')]: ['*']
            }
        });
        if (!uri) {
            return;
        }

        const content = this.serializeResultSet(selection, columns, rows);
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf8'));
        void vscode.window.showInformationMessage(vscode.l10n.t('Saved result set to {path}.', { path: uri.fsPath }));
    }

    setRequestHandler(handler: SqlResultPanelRequestHandler | undefined): void {
        this.requestHandler = handler;
    }

    dispose(): void {
        this.panel?.dispose();
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
                        ? [
                            vscode.Uri.joinPath(sqlResultPanelExtensionUri, 'media'),
                            vscode.Uri.joinPath(sqlResultPanelExtensionUri, 'node_modules', '@vscode', 'codicons', 'dist')
                        ]
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
                this.activeResultTitle = undefined;
            });
        } else {
            this.panel.reveal(vscode.ViewColumn.Beside, true);
        }

        this.activeSessionId = result.sessionId;
        this.activeResultTitle = result.resultTitle;
        this.panel.title = `${this.l10n.sqlResultsTitle} (${result.rowCount})`;
        const extensionUri = sqlResultPanelExtensionUri;
        const scriptUri = extensionUri
            ? this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'sqlResultSet.js')).toString()
            : '';
        const codiconStylesheetUri = extensionUri
            ? this.panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')).toString()
            : '';
        this.panel.webview.html = renderSqlResultHtml(result, this.panel.webview.cspSource, scriptUri, codiconStylesheetUri, this.l10n);
    }

    private update(result: SqlResultPayload): void {
        if (!this.panel) {
            return;
        }

        this.activeSessionId = result.sessionId;
        this.activeResultTitle = result.resultTitle;
        this.panel.title = `${this.l10n.sqlResultsTitle} (${result.rowCount})`;
        const payload = buildClientPayload(result, this.l10n);
        void this.panel.webview.postMessage({ type: 'sqlResultReplace', payload });
    }

    private postLoadAllState(state: { inProgress: boolean; stopRequested?: boolean; rowsLoaded?: number; message?: string }): void {
        if (!this.panel) {
            return;
        }

        void this.panel.webview.postMessage({
            type: 'loadAllState',
            inProgress: state.inProgress,
            stopRequested: state.stopRequested,
            rowsLoaded: state.rowsLoaded,
            message: state.message ?? ''
        });
    }

    private async runProgressiveLoadAll(sessionId: string): Promise<void> {
        if (!this.requestHandler || !this.panel) {
            return;
        }

        if (this.loadAllInProgress) {
            return;
        }

        this.loadAllInProgress = true;
        this.stopLoadAllRequested = false;
        this.postLoadAllState({ inProgress: true, stopRequested: false, message: this.l10n.loadingAllRemainingRows });

        let lastRowsLoaded = 0;

        try {
            while (!this.stopLoadAllRequested) {
                const updated = await this.requestHandler({ type: 'loadMore', sessionId });
                if (!updated) {
                    break;
                }

                this.update(updated);
                lastRowsLoaded = updated.rowCount;

                if (this.stopLoadAllRequested) {
                    this.postLoadAllState({
                        inProgress: true,
                        stopRequested: true,
                        rowsLoaded: updated.rowCount,
                        message: this.l10n.stoppingRequested
                    });
                    break;
                }

                this.postLoadAllState({
                    inProgress: true,
                    stopRequested: this.stopLoadAllRequested,
                    rowsLoaded: updated.rowCount,
                    message: this.stopLoadAllRequested
                        ? this.l10n.stoppingRequested
                        : vscode.l10n.t(this.l10n.loadedRowsTemplate, { count: updated.rowCount })
                });

                if (!updated.hasMoreRows || !updated.sessionId) {
                    break;
                }

                // Session IDs should remain stable; if they change, continue with the latest.
                sessionId = updated.sessionId;

                // Yield to the event loop so a pending stop message can be handled
                // before scheduling another backend fetch.
                await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
        } catch (error) {
            const messageText = error instanceof Error ? error.message : String(error);
            void this.panel.webview.postMessage({ type: 'loadError', message: messageText });
        } finally {
            const wasStopped = this.stopLoadAllRequested;
            this.loadAllInProgress = false;
            this.stopLoadAllRequested = false;
            this.postLoadAllState({
                inProgress: false,
                stopRequested: false,
                rowsLoaded: lastRowsLoaded,
                message: wasStopped
                    ? vscode.l10n.t(this.l10n.stoppedFetchAfterRowTemplate, { count: lastRowsLoaded })
                    : this.l10n.loadAllComplete
            });
        }
    }

    markSessionClosed(message?: string): void {
        if (!this.panel || !this.activeSessionId) {
            return;
        }

        const sessionId = this.activeSessionId;
        this.activeSessionId = undefined;
        this.activeResultTitle = undefined;
        void this.panel.webview.postMessage({
            type: 'sqlSessionClosed',
            sessionId,
            message: message || this.l10n.sqlSessionNoLongerAvailable
        });
    }

    private async handleMessage(message: unknown): Promise<void> {
        if (!this.panel || !message || typeof message !== 'object') {
            return;
        }

        const request = message as { type?: string; sessionId?: string; statement?: string; resultTitle?: string; value?: string; columns?: unknown; rows?: unknown };
        if (!request.type) {
            return;
        }

        if (request.type === 'copyResultSet') {
            await this.handleCopyResultSet(request.columns, request.rows);
            return;
        }

        if (request.type === 'saveResultSet') {
            await this.handleSaveResultSet(request.columns, request.rows, request.resultTitle);
            return;
        }

        if (!this.requestHandler) {
            return;
        }

        if (request.type === 'copyCellToClipboard') {
            await this.requestHandler({
                type: 'copyCellToClipboard',
                value: String(request.value ?? '')
            });
            return;
        }

        if (request.type === 'copyCellToCommandEntry') {
            await this.requestHandler({
                type: 'copyCellToCommandEntry',
                value: String(request.value ?? '')
            });
            return;
        }

        if (request.type === 'rerunSql') {
            const statement = String(request.statement || '').trim();
            if (!statement) {
                throw new Error(vscode.l10n.t('No SQL statement was provided to rerun.'));
            }

            const updated = await this.requestHandler({
                type: 'rerunSql',
                statement,
                resultTitle: request.resultTitle ?? this.activeResultTitle
            });
            if (updated) {
                this.update(updated);
            }
            return;
        }

        if (!request.sessionId) {
            return;
        }

        if (request.type === 'stopLoadAll') {
            this.stopLoadAllRequested = true;
            this.postLoadAllState({ inProgress: true, stopRequested: true, message: this.l10n.stoppingRequested });
            return;
        }

        if (request.type === 'loadAll') {
            void this.runProgressiveLoadAll(request.sessionId);
            return;
        }

        if (request.type !== 'loadMore' && request.type !== 'prefetch') {
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

export function closeSqlResultPanel(): void {
    singletonPanel.dispose();
}

function renderSqlResultHtml(result: SqlResultPayload, cspSource: string, scriptUri: string, codiconStylesheetUri: string, l10n: SqlResultPanelL10n): string {
    const columns = result.columns;
    const profiles = buildColumnProfiles(columns, result.rows, result.columnMetadata ?? []);
    const initialPayload = buildClientPayload(result, l10n);
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
    const allHeaders = `<th class="align-right row-index-col">${escapeHtml(vscode.l10n.t('ROW'))}</th>` + colHeaders;
    const bootstrapPayloadJson = safeJsonForScript({
        initialColumns: columns,
        initialPayload
    });
    const initialBodyRowsHtml = renderRowCellsHtml(initialPayload.rowCells);

    const sqlHeaderHtml = `<div class="result-header">
                <div class="result-header-actions">
                    <button id="toggle-sql-stmt" type="button" title="${escapeHtml(l10n.showFullSqlStatement)}" data-tooltip="${escapeHtml(l10n.showFullSqlStatement)}" aria-label="${escapeHtml(l10n.showFullSqlStatement)}" aria-expanded="false">${escapeHtml(l10n.viewSqlStmt)}</button>
                    <button id="toggle-single-row-layout" type="button" title="${escapeHtml(l10n.switchToColumnView)}" data-tooltip="${escapeHtml(l10n.switchToColumnView)}" aria-label="${escapeHtml(l10n.switchToColumnView)}" aria-pressed="false" hidden>${escapeHtml(l10n.columnViewButton)}</button>
                </div>
                <h3 class="result-title${result.resultTitle ? '' : ' is-hidden'}" id="result-title">${result.resultTitle ? escapeHtml(result.resultTitle) : ''}</h3>
            </div>`;
    const sqlStatementHtml = `<pre class="sql" id="sql-statement">${escapeHtml(result.statement)}</pre>`;
    const tableHtml = columns.length === 0
        ? `<p class="empty">${escapeHtml(l10n.noRowsReturned)}</p>`
        : `<div class="paging-toolbar" id="paging-toolbar">
                    <button id="rerun-sql" type="button" title="${escapeHtml(l10n.refresh)}" data-tooltip="${escapeHtml(l10n.refresh)}" aria-label="${escapeHtml(l10n.refresh)}">&#x25B6;</button>
                    <button id="first-page" type="button" title="${escapeHtml(l10n.top)}" data-tooltip="${escapeHtml(l10n.top)}" aria-label="${escapeHtml(l10n.top)}"><<</button>
                    <button id="prev-page" type="button" title="${escapeHtml(l10n.priorPage)}" data-tooltip="${escapeHtml(l10n.priorPage)}" aria-label="${escapeHtml(l10n.priorPage)}"><</button>
                                <span id="page-summary">Page 1 of 1</span>
                    <button id="next-page" type="button" title="${escapeHtml(l10n.nextPage)}" data-tooltip="${escapeHtml(l10n.nextPage)}" aria-label="${escapeHtml(l10n.nextPage)}">></button>
                    <button id="last-page" type="button" title="${escapeHtml(l10n.bottom)}" data-tooltip="${escapeHtml(l10n.bottom)}" aria-label="${escapeHtml(l10n.bottom)}">>></button>
                            <button id="load-more" type="button" title="${escapeHtml(l10n.loadMoreResultRows)}" data-tooltip="${escapeHtml(l10n.loadMoreResultRows)}" aria-label="${escapeHtml(l10n.loadMoreResultRows)}" hidden>${escapeHtml(l10n.loadMore)}</button>
                            <button id="load-all" type="button" title="${escapeHtml(l10n.loadAllRemainingResultRows)}" data-tooltip="${escapeHtml(l10n.loadAllRemainingResultRows)}" aria-label="${escapeHtml(l10n.loadAllRemainingResultRows)}" hidden>${escapeHtml(l10n.loadAll)}</button>
                    <span class="toolbar-spacer"></span>
                        </div>
                <div class="result-meta-row">
                    <p class="meta" id="result-meta"></p>
                    <div class="result-meta-actions" aria-label="${escapeHtml(vscode.l10n.t('Result set actions'))}">
                        ${renderIconButton('copy-result-set', l10n.copyResultSet, 'copy')}
                        ${renderIconButton('save-result-set', l10n.saveResultSet, 'save')}
                    </div>
                </div>
                    <div class="single-row-wrap" id="single-row-wrap" hidden><table class="single-row-table"><thead><tr><th id="single-row-col-id-header" class="sortable-col" data-col-index="0" aria-sort="none" role="button" tabindex="0">${escapeHtml(l10n.columnIdHeader)}</th><th id="single-row-data-header" class="sortable-col" data-col-index="1" aria-sort="none" role="button" tabindex="0">${escapeHtml(l10n.dataHeader)}</th></tr></thead><tbody id="single-row-body"></tbody></table></div>
                    <div class="table-wrap" id="table-wrap"><table><thead><tr>${allHeaders}</tr></thead><tbody id="results-body">${initialBodyRowsHtml}</tbody></table></div>`;

    const sqlResultsScriptTag = scriptUri
        ? `<script src="${scriptUri}"></script>`
        : '';
    const bodyHtml = `${sqlHeaderHtml}
    ${sqlStatementHtml}
    <pre id="sql-results-bootstrap" style="display:none">${escapeHtml(bootstrapPayloadJson)}</pre>
    ${tableHtml}
    ${sqlResultsScriptTag}`;

    const template = readSqlResultTemplate();
    if (!template) {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><link rel="stylesheet" href="${codiconStylesheetUri}"><title>${PANEL_TITLE}</title></head><body>${bodyHtml}</body></html>`;
    }

    return template
        .split('{{CSP_SOURCE}}').join(cspSource)
        .split('{{CODICON_SOURCE}}').join(codiconStylesheetUri)
        .split('{{PANEL_TITLE}}').join(PANEL_TITLE)
        .split('{{BODY_HTML}}').join(bodyHtml);
}

function buildClientPayload(result: SqlResultPayload, l10n: SqlResultPanelL10n) {
    const columns = result.columns;
    const profiles = buildColumnProfiles(columns, result.rows, result.columnMetadata ?? []);
    const rowCells = result.rows.map((row) => {
        return columns.map((column) => {
            const profile = profiles[column];
            const alignClass = shouldRightAlign(profile.kind) ? 'align-right' : '';
            const cellClass = (row[column] === null || row[column] === undefined) ? 'sql-null-cell' : '';
            const sortKeys = buildSortKeys(row[column], profile.kind);
            return {
                alignClass,
                cellClass,
                html: formatCell(row[column], profile),
                rawText: sortableTextValue(row[column]),
                sortKind: sortKeys.sortKind,
                sortText: sortKeys.sortText,
                sortNumber: sortKeys.sortNumber
            };
        });
    });

    return {
        rowCells,
        resultTitle: result.resultTitle ?? '',
        rowCount: result.rowCount,
        displayedRowCount: result.displayedRowCount,
        elapsedMs: result.elapsedMs,
        sessionId: result.sessionId ?? '',
        hasMoreRows: !!result.hasMoreRows,
        fetchSize: result.fetchSize ?? 0,
        prefetchSize: result.prefetchSize ?? 0,
        autoColumnViewForSingleRow: !!result.autoColumnViewForSingleRow,
        columnMetadata: result.columnMetadata ?? [],
        l10n
    };
}

function renderRowCellsHtml(rowCells: Array<Array<{ alignClass?: string; cellClass?: string; html: string; rawText?: string }>>): string {
    return rowCells.map((cells, index) => {
        const tds = cells.map((cell) => {
            const classes = [cell.alignClass, cell.cellClass].filter(Boolean).join(' ');
            const classAttr = classes ? ` class="${classes}"` : '';
            const rawValueAttr = ` data-raw-value="${escapeHtml(cell.rawText ?? '')}"`;
            return `<td${classAttr}${rawValueAttr}>${cell.html}</td>`;
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

interface CellSortKeys {
    sortKind: ColumnKind;
    sortText: string;
    sortNumber: number | undefined;
}

const INTEGER_TEXT_PATTERN = /^[-+]?\d+$/;

function shouldSortNumericTextAsText(text: string): boolean {
    if (!INTEGER_TEXT_PATTERN.test(text)) {
        return false;
    }

    try {
        const parsed = BigInt(text);
        const max = BigInt(Number.MAX_SAFE_INTEGER);
        const min = BigInt(Number.MIN_SAFE_INTEGER);
        return parsed > max || parsed < min;
    } catch {
        return true;
    }
}

function buildSortKeys(value: unknown, preferredKind: ColumnKind): CellSortKeys {
    const sortText = sortableTextValue(value);

    if (preferredKind !== 'number') {
        return {
            sortKind: preferredKind,
            sortText,
            sortNumber: sortableNumericValue(value, preferredKind)
        };
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (shouldSortNumericTextAsText(trimmed)) {
            return {
                sortKind: 'text',
                sortText,
                sortNumber: undefined
            };
        }
    }

    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
        return {
            sortKind: 'text',
            sortText,
            sortNumber: undefined
        };
    }

    return {
        sortKind: preferredKind,
        sortText,
        sortNumber: sortableNumericValue(value, preferredKind)
    };
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
    exactNumericScale?: number;
}

const MIN_FRACTION_DIGITS_FALLBACK = 2;

function formatCell(value: unknown, profile: ColumnProfile): string {
    if (value === null || value === undefined) {
        return '<span class="sql-null-text">NULL</span>';
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
            if (typeof profile.exactNumericScale === 'number' && profile.exactNumericScale >= 0) {
                return escapeHtml(value.toFixed(profile.exactNumericScale));
            }

            if (Number.isInteger(value)) {
                return escapeHtml(String(value));
            }
            const digits = Math.max(profile.fractionDigits, MIN_FRACTION_DIGITS_FALLBACK);
            return escapeHtml(value.toFixed(digits));
        }

        const text = String(value);
        if (typeof profile.exactNumericScale === 'number' && profile.exactNumericScale >= 0) {
            return escapeHtml(normalizeNumericTextToScale(text, profile.exactNumericScale));
        }

        // Keep exact text when DB returns numeric values as strings.
        return escapeHtml(text);
    }

    return escapeHtml(String(value));
}

function buildColumnProfiles(
    columns: string[],
    rows: Record<string, unknown>[],
    metadata: SqlColumnMetadata[]
): Record<string, ColumnProfile> {
    const out: Record<string, ColumnProfile> = {};
    const metadataByName = new Map(metadata.map((entry) => [normalizeColumnKey(entry.name), entry]));
    for (const column of columns) {
        const columnMetadata = metadataByName.get(normalizeColumnKey(column))
            ?? metadata.find((entry) => normalizeColumnKey(entry.label) === normalizeColumnKey(column));
        out[column] = profileColumn(rows, column, columnMetadata);
    }
    return out;
}

function isExactNumericType(typeName: string | undefined): boolean {
    const normalized = (typeName ?? '').trim().toUpperCase();
    return normalized === 'DECIMAL' || normalized === 'NUMERIC' || normalized === 'DEC';
}

function profileColumn(
    rows: Record<string, unknown>[],
    column: string,
    metadata?: SqlColumnMetadata
): ColumnProfile {
    let kind: ColumnKind = 'text';
    let fractionDigits = 0;
    let sawFractionalNumber = false;
    let exactNumericScale: number | undefined;

    if (metadata && isExactNumericType(metadata.typeName) && typeof metadata.scale === 'number' && metadata.scale >= 0) {
        kind = 'number';
        exactNumericScale = metadata.scale;
        fractionDigits = Math.max(fractionDigits, metadata.scale);
    }

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

    return { kind, fractionDigits, exactNumericScale };
}

function normalizeNumericTextToScale(value: string, scale: number): string {
    const trimmed = value.trim();
    const match = trimmed.match(/^([+-]?)(\d+)(?:\.(\d+))?$/);
    if (!match) {
        return value;
    }

    const sign = match[1] || '';
    const integerPart = match[2] || '0';
    const fractionPart = match[3] || '';

    if (scale <= 0) {
        return `${sign}${integerPart}`;
    }

    if (fractionPart.length >= scale) {
        // Keep original precision when it exceeds catalog scale.
        return `${sign}${integerPart}.${fractionPart}`;
    }

    return `${sign}${integerPart}.${fractionPart.padEnd(scale, '0')}`;
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
