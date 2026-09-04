(function () {
    var bootstrapNode = document.getElementById('sql-results-bootstrap');
    if (!bootstrapNode) {
        return;
    }

    var bootstrap = {};
    try {
        bootstrap = JSON.parse(bootstrapNode.textContent || '{}');
    } catch (_parseError) {
        return;
    }

    var initialColumns = Array.isArray(bootstrap.initialColumns) ? bootstrap.initialColumns : [];
    var initialPayload = (bootstrap.initialPayload && typeof bootstrap.initialPayload === 'object')
        ? bootstrap.initialPayload
        : {};

    var vscode = {
        getState: function () { return {}; },
        setState: function () { return undefined; },
        postMessage: function () { return undefined; }
    };

    try {
        if (typeof acquireVsCodeApi === 'function') {
            vscode = acquireVsCodeApi();
        }
    } catch (_apiError) {
        // Keep fallback API.
    }

    var persistedState = {};
    try {
        var rawState = vscode.getState ? vscode.getState() : {};
        persistedState = (rawState && typeof rawState === 'object') ? rawState : {};
    } catch (_stateError) {
        persistedState = {};
    }

    var tbody = document.getElementById('results-body');
    var firstBtn = document.getElementById('first-page');
    var prevBtn = document.getElementById('prev-page');
    var nextBtn = document.getElementById('next-page');
    var lastBtn = document.getElementById('last-page');
    var pageSizeSelect = document.getElementById('page-size');
    var pageSummary = document.getElementById('page-summary');
    var loadMoreBtn = document.getElementById('load-more');
    var loadAllBtn = document.getElementById('load-all');
    var rerunBtn = document.getElementById('rerun-sql');
    var fetchStatus = document.getElementById('fetch-status');
    var resultMeta = document.getElementById('result-meta');
    var toggleSqlStmtBtn = document.getElementById('toggle-sql-stmt');
    var sqlStatement = document.getElementById('sql-statement');
    var tableWrap = document.querySelector('.table-wrap');

    if (!tbody) {
        return;
    }

    function setStatus(text) {
        if (fetchStatus) {
            fetchStatus.textContent = text || '';
        }
    }

    function setRerunBusy(isBusy) {
        if (!rerunBtn) {
            return;
        }
        rerunBtn.disabled = !!isBusy;
        rerunBtn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
        rerunBtn.title = isBusy ? 'Refresh' : 'Refresh';
    }

    if (toggleSqlStmtBtn && sqlStatement) {
        toggleSqlStmtBtn.addEventListener('click', function () {
            var isVisible = sqlStatement.classList.toggle('is-visible');
            toggleSqlStmtBtn.textContent = isVisible ? 'Hide SQL Stmt' : 'View SQL Stmt';
            toggleSqlStmtBtn.setAttribute('aria-expanded', isVisible ? 'true' : 'false');
        });
    }

    var sessionId = initialPayload.sessionId || '';
    var hasMoreRows = !!initialPayload.hasMoreRows;
    var fetchSize = Number(initialPayload.fetchSize || 0);
    var rows = Array.isArray(initialPayload.rowCells) ? initialPayload.rowCells.slice() : [];

    var sortColumnIndex = -1;
    var sortDirection = 'asc';
    var suppressSortUntil = 0;
    var minColumnWidthPx = 80;
    var pageSize = 50;
    var pageSizeAuto = false;
    var pageIndex = 0;
    var rowOffsets = [];
    var rowHeights = [];
    var rerunInFlight = false;

    var tableSignature = initialColumns.join('|~|');
    var widthBySignature = (persistedState.columnWidthsBySignature && typeof persistedState.columnWidthsBySignature === 'object')
        ? persistedState.columnWidthsBySignature
        : {};
    var columnWidths = (tableSignature && widthBySignature[tableSignature] && typeof widthBySignature[tableSignature] === 'object')
        ? widthBySignature[tableSignature]
        : {};

    var widthStyle = document.createElement('style');
    widthStyle.id = 'column-width-style';
    document.head.appendChild(widthStyle);

    function saveWidths() {
        if (!persistedState.columnWidthsBySignature || typeof persistedState.columnWidthsBySignature !== 'object') {
            persistedState.columnWidthsBySignature = {};
        }
        if (tableSignature) {
            persistedState.columnWidthsBySignature[tableSignature] = columnWidths;
        }
        try {
            if (vscode.setState) {
                vscode.setState(persistedState);
            }
        } catch (_saveError) {
            // Ignore persistence errors.
        }
    }

    function applyWidths() {
        var css = [];
        for (var rawIndex in columnWidths) {
            if (!Object.prototype.hasOwnProperty.call(columnWidths, rawIndex)) {
                continue;
            }
            var colIndex = Number(rawIndex);
            var widthPx = Number(columnWidths[rawIndex]);
            if (!isFinite(colIndex) || Math.floor(colIndex) !== colIndex || colIndex < 0) {
                continue;
            }
            if (!isFinite(widthPx) || widthPx < minColumnWidthPx) {
                continue;
            }
            var safeWidth = Math.round(widthPx);
            var cellColumnIndex = colIndex + 2;
            css.push(
                'thead th[data-col-index="' + colIndex + '"]'
                + ', tbody td:nth-child(' + cellColumnIndex + ')'
                + ' { width: ' + safeWidth + 'px; min-width: ' + safeWidth + 'px; max-width: ' + safeWidth + 'px; }'
            );
        }
        widthStyle.textContent = css.join('\n');
    }

    function updatePageSizeFromSelection() {
        if (!pageSizeSelect) {
            pageSizeAuto = false;
            pageSize = 50;
            return;
        }

        var selectedValue = String(pageSizeSelect.value || '50').toUpperCase();
        pageSizeAuto = selectedValue === 'AUTO';
        if (pageSizeAuto) {
            pageSize = 0;
            return;
        }

        var nextSize = Number(selectedValue);
        pageSize = (isFinite(nextSize) && nextSize > 0) ? Math.floor(nextSize) : 50;
    }

    function estimateVisibleRows() {
        if (!tableWrap) {
            return 50;
        }

        var totalHeight = 0;
        var measured = 0;
        for (var i = 0; i < rowHeights.length; i++) {
            var h = rowHeights[i];
            if (h > 0) {
                totalHeight += h;
                measured += 1;
            }
        }

        var rowHeight = measured > 0 ? (totalHeight / measured) : 0;
        if (rowHeight <= 0) {
            var renderedRows = getRenderedRows();
            if (renderedRows.length > 0) {
                var height = renderedRows[0].getBoundingClientRect().height;
                if (isFinite(height) && height > 0) {
                    rowHeight = height;
                }
            }
        }

        if (rowHeight <= 0) {
            return 50;
        }

        return Math.max(1, Math.floor(tableWrap.clientHeight / rowHeight));
    }

    function getEffectivePageSize() {
        if (!pageSizeAuto) {
            return pageSize > 0 ? pageSize : 50;
        }
        return estimateVisibleRows();
    }

    function getTotalPages() {
        var size = getEffectivePageSize();
        return Math.max(1, Math.ceil(rows.length / size));
    }

    function clampPageIndex() {
        var totalPages = getTotalPages();
        if (pageIndex < 0) {
            pageIndex = 0;
        }
        if (pageIndex > totalPages - 1) {
            pageIndex = totalPages - 1;
        }
    }

    function getRenderedRows() {
        return tbody ? Array.prototype.slice.call(tbody.querySelectorAll('tr')) : [];
    }

    function rebuildRowOffsets() {
        var renderedRows = getRenderedRows();
        rowOffsets = [];
        rowHeights = [];
        var baseOffset = renderedRows.length > 0 ? renderedRows[0].offsetTop : 0;
        for (var i = 0; i < renderedRows.length; i++) {
            rowOffsets.push(Math.max(0, renderedRows[i].offsetTop - baseOffset));
            var measuredHeight = renderedRows[i].offsetHeight;
            rowHeights.push(measuredHeight > 0 ? measuredHeight : 0);
        }

        // Fill missing heights using neighboring row offsets.
        for (var j = 0; j < rowHeights.length; j++) {
            if (rowHeights[j] > 0) {
                continue;
            }
            if (j < rowOffsets.length - 1) {
                var nextDelta = rowOffsets[j + 1] - rowOffsets[j];
                if (nextDelta > 0) {
                    rowHeights[j] = nextDelta;
                    continue;
                }
            }
            if (j > 0 && rowHeights[j - 1] > 0) {
                rowHeights[j] = rowHeights[j - 1];
            }
        }
    }

    function computePageDownTargetRow(currentTopRowIndex) {
        if (!tableWrap || rowOffsets.length === 0) {
            return 0;
        }

        var topIndex = Math.max(0, Math.min(rowOffsets.length - 1, currentTopRowIndex));
        var viewportHeight = Math.max(1, tableWrap.clientHeight);
        var currentTopOffset = rowOffsets[topIndex] || 0;
        var targetScrollTop = currentTopOffset + viewportHeight;
        var targetIndex = findRowIndexForScrollTop(targetScrollTop);

        // Guarantee forward progress when not already at the last row.
        if (targetIndex <= topIndex && topIndex < rowOffsets.length - 1) {
            targetIndex = topIndex + 1;
        }

        return Math.max(0, Math.min(rowOffsets.length - 1, targetIndex));
    }

    function computePageUpTargetRow(currentTopRowIndex) {
        if (!tableWrap || rowOffsets.length === 0) {
            return 0;
        }

        var topIndex = Math.max(0, Math.min(rowOffsets.length - 1, currentTopRowIndex));
        if (topIndex <= 0) {
            return 0;
        }

        var viewportHeight = Math.max(1, tableWrap.clientHeight);
        var currentTopOffset = rowOffsets[topIndex] || 0;
        var targetIndex = topIndex;

        // Walk upward row-by-row until adding one more row would exceed one viewport.
        while (targetIndex > 0) {
            var candidateIndex = targetIndex - 1;
            var delta = currentTopOffset - (rowOffsets[candidateIndex] || 0);
            if (delta > viewportHeight) {
                break;
            }
            targetIndex = candidateIndex;
        }

        // Guarantee backward progress if no candidate fit (very tall rows).
        if (targetIndex >= topIndex) {
            targetIndex = topIndex - 1;
        }

        return Math.max(0, Math.min(rowOffsets.length - 1, targetIndex));
    }

    function findRowIndexForScrollTop(scrollTop) {
        if (!rowOffsets.length) {
            return 0;
        }

        var low = 0;
        var high = rowOffsets.length - 1;
        var best = 0;
        while (low <= high) {
            var mid = Math.floor((low + high) / 2);
            if (rowOffsets[mid] <= scrollTop) {
                best = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }
        return best;
    }

    function getCurrentPageIndexFromScroll() {
        if (!tableWrap || rowOffsets.length === 0) {
            return 0;
        }

        var topRow = findRowIndexForScrollTop(tableWrap.scrollTop);
        var size = getEffectivePageSize();
        var totalPages = getTotalPages();
        return Math.max(0, Math.min(totalPages - 1, Math.floor(topRow / size)));
    }

    function getCurrentTopRowIndex() {
        if (!tableWrap || rowOffsets.length === 0) {
            return 0;
        }
        return findRowIndexForScrollTop(tableWrap.scrollTop);
    }

    function syncPageIndexFromScroll() {
        pageIndex = getCurrentPageIndexFromScroll();
        clampPageIndex();
    }

    function scrollToRowIndex(rowIndex) {
        if (!tableWrap || rowOffsets.length === 0) {
            return;
        }

        var targetRow = Math.max(0, Math.min(rowOffsets.length - 1, rowIndex));
        tableWrap.scrollTop = Math.max(0, rowOffsets[targetRow]);
        syncPageIndexFromScroll();
        updatePageButtons();
        if (pageSummary) {
            var effectiveSize = getEffectivePageSize();
            var sizeLabel = pageSizeAuto ? ('AUTO=' + effectiveSize) : String(effectiveSize);
            pageSummary.textContent = 'Page ' + (pageIndex + 1) + ' of ' + getTotalPages() + ' (' + rows.length + ' rows, page ' + sizeLabel + ')';
        }
    }

    function jumpByPages(deltaPages) {
        var baseTopRow = getCurrentTopRowIndex();
        var targetRow;

        if (pageSizeAuto) {
            if (deltaPages > 0) {
                targetRow = computePageDownTargetRow(baseTopRow);
            } else if (deltaPages < 0) {
                targetRow = computePageUpTargetRow(baseTopRow);
            } else {
                targetRow = baseTopRow;
            }
        } else {
            var effectiveSize = getEffectivePageSize();
            targetRow = baseTopRow + (deltaPages * effectiveSize);
        }

        scrollToRowIndex(targetRow);
    }

    function updatePageButtons() {
        if (pageSizeAuto && tableWrap && rowOffsets.length > 0) {
            var currentTopRow = getCurrentTopRowIndex();
            var maxScrollable = Math.max(0, tableWrap.scrollHeight - tableWrap.clientHeight);
            var atTop = currentTopRow <= 0 || tableWrap.scrollTop <= 0;
            var atBottom = tableWrap.scrollTop >= (maxScrollable - 1);

            if (firstBtn) { firstBtn.disabled = atTop; }
            if (prevBtn) { prevBtn.disabled = atTop; }
            if (nextBtn) { nextBtn.disabled = atBottom; }
            if (lastBtn) { lastBtn.disabled = atBottom; }
            return;
        }

        var totalPages = getTotalPages();
        if (firstBtn) { firstBtn.disabled = pageIndex <= 0; }
        if (prevBtn) { prevBtn.disabled = pageIndex <= 0; }
        if (nextBtn) { nextBtn.disabled = pageIndex >= totalPages - 1; }
        if (lastBtn) { lastBtn.disabled = pageIndex >= totalPages - 1; }
    }

    function renderRows(options) {
        var opts = options || {};
        var preserveScroll = !!opts.preserveScroll;
        var scrollToTop = !!opts.scrollToTop;
        var previousScrollTop = tableWrap ? tableWrap.scrollTop : 0;
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i];
            var tds = '';
            if (Array.isArray(cells)) {
                for (var c = 0; c < cells.length; c++) {
                    var cell = cells[c] || {};
                    var alignClass = cell.alignClass ? ' class="' + cell.alignClass + '"' : '';
                    var cellHtml = (typeof cell.html === 'string') ? cell.html : '';
                    tds += '<td' + alignClass + '>' + cellHtml + '</td>';
                }
            }
            html += '<tr><td class="align-right row-index-col">' + (i + 1) + '</td>' + tds + '</tr>';
        }
        tbody.innerHTML = html;

        rebuildRowOffsets();
        if (tableWrap) {
            if (scrollToTop) {
                tableWrap.scrollTop = 0;
            } else if (preserveScroll) {
                tableWrap.scrollTop = Math.min(previousScrollTop, tableWrap.scrollHeight);
            }
        }

        syncPageIndexFromScroll();

        if (resultMeta) {
            resultMeta.textContent = hasMoreRows
                ? ('Loaded ' + rows.length + ' rows. More rows are available.')
                : (rows.length + ' rows returned.');
        }
        if (pageSummary) {
            var effectiveSize = getEffectivePageSize();
            var sizeLabel = pageSizeAuto ? ('AUTO=' + effectiveSize) : String(effectiveSize);
            pageSummary.textContent = 'Page ' + (pageIndex + 1) + ' of ' + getTotalPages() + ' (' + rows.length + ' rows, page ' + sizeLabel + ')';
        }
        updatePageButtons();
    }

    function normalizeCell(cell) {
        if (!cell || typeof cell !== 'object') {
            return { kind: 'text', value: '' };
        }
        var sortKind = String(cell.sortKind || 'text');
        if (sortKind === 'null') {
            return { kind: 'null', value: '' };
        }
        if (sortKind === 'number' || sortKind === 'date' || sortKind === 'time' || sortKind === 'timestamp') {
            var n = Number(cell.sortNumber);
            return isFinite(n) ? { kind: sortKind, value: n } : { kind: 'null', value: '' };
        }
        return { kind: 'text', value: String(cell.sortText || '').toUpperCase() };
    }

    function compareForSort(leftCell, rightCell) {
        var left = normalizeCell(leftCell);
        var right = normalizeCell(rightCell);

        if (left.kind === 'null' && right.kind === 'null') { return 0; }
        if (left.kind === 'null') { return 1; }
        if (right.kind === 'null') { return -1; }

        if (typeof left.value === 'number' && typeof right.value === 'number') {
            if (left.value < right.value) { return -1; }
            if (left.value > right.value) { return 1; }
            return 0;
        }

        var lt = String(left.value);
        var rt = String(right.value);
        if (lt < rt) { return -1; }
        if (lt > rt) { return 1; }
        return 0;
    }

    var sortableHeaders = document.querySelectorAll('thead th.sortable-col[data-col-index]');

    function updateSortIndicators() {
        for (var i = 0; i < sortableHeaders.length; i++) {
            var header = sortableHeaders[i];
            var colIndex = Number(header.getAttribute('data-col-index') || -1);
            var isActive = colIndex === sortColumnIndex;
            header.classList.toggle('is-sorted', isActive);
            header.classList.toggle('is-desc', isActive && sortDirection === 'desc');
            header.setAttribute('aria-sort', isActive ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none');
        }
    }

    function sortRowsByColumn(colIndex) {
        if (!isFinite(colIndex) || Math.floor(colIndex) !== colIndex || colIndex < 0) {
            return;
        }

        if (sortColumnIndex === colIndex) {
            sortDirection = (sortDirection === 'asc') ? 'desc' : 'asc';
        } else {
            sortColumnIndex = colIndex;
            sortDirection = 'asc';
        }

        applyActiveSort();
        pageIndex = 0;
        updateSortIndicators();
        renderRows({ scrollToTop: true });
        setStatus('Sorted column ' + (colIndex + 1) + ' (' + sortDirection + ').');
    }

    function applyActiveSort() {
        if (sortColumnIndex < 0) {
            return;
        }

        var decorated = [];
        for (var i = 0; i < rows.length; i++) {
            decorated.push({ cells: rows[i], index: i });
        }

        var dir = (sortDirection === 'desc') ? -1 : 1;
        decorated.sort(function (a, b) {
            var cmp = compareForSort(a.cells[sortColumnIndex], b.cells[sortColumnIndex]);
            if (cmp !== 0) {
                return cmp * dir;
            }
            return a.index - b.index;
        });

        var sorted = [];
        for (var j = 0; j < decorated.length; j++) {
            sorted.push(decorated[j].cells);
        }
        rows = sorted;
    }

    function attachSortHandlers() {
        for (var i = 0; i < sortableHeaders.length; i++) {
            (function (header) {
                var colIndex = Number(header.getAttribute('data-col-index') || -1);
                header.tabIndex = 0;
                header.setAttribute('role', 'button');
                header.addEventListener('click', function () {
                    if (Date.now() < suppressSortUntil) {
                        return;
                    }
                    sortRowsByColumn(colIndex);
                });
                header.addEventListener('keydown', function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        sortRowsByColumn(colIndex);
                    }
                });
            })(sortableHeaders[i]);
        }
    }

    function attachResizeHandlers() {
        for (var i = 0; i < sortableHeaders.length; i++) {
            (function (header) {
                var colIndex = Number(header.getAttribute('data-col-index') || -1);
                if (!isFinite(colIndex) || Math.floor(colIndex) !== colIndex || colIndex < 0) {
                    return;
                }

                var handle = document.createElement('span');
                handle.className = 'col-resize-handle';
                handle.setAttribute('aria-hidden', 'true');
                handle.title = 'Drag to resize column';
                header.appendChild(handle);

                handle.addEventListener('mousedown', function (event) {
                    event.preventDefault();
                    event.stopPropagation();

                    var startX = event.clientX;
                    var rect = header.getBoundingClientRect();
                    var baseWidth = Number(columnWidths[colIndex]) || rect.width;
                    var didMove = false;
                    if (!isFinite(baseWidth) || baseWidth < minColumnWidthPx) {
                        baseWidth = minColumnWidthPx;
                    }

                    document.body.classList.add('is-col-resizing');

                    var onMove = function (moveEvent) {
                        var delta = moveEvent.clientX - startX;
                        if (Math.abs(delta) > 1) {
                            didMove = true;
                        }
                        var nextWidth = Math.round(baseWidth + delta);
                        if (nextWidth < minColumnWidthPx) {
                            nextWidth = minColumnWidthPx;
                        }
                        columnWidths[colIndex] = nextWidth;
                        applyWidths();
                    };

                    var onUp = function () {
                        window.removeEventListener('mousemove', onMove);
                        window.removeEventListener('mouseup', onUp);
                        document.body.classList.remove('is-col-resizing');
                        if (didMove) {
                            suppressSortUntil = Date.now() + 250;
                        }
                        saveWidths();
                        setStatus('Resized column ' + (colIndex + 1) + '.');
                    };

                    window.addEventListener('mousemove', onMove);
                    window.addEventListener('mouseup', onUp);
                });

                // Block click bubbling from the handle itself.
                handle.addEventListener('click', function (event) {
                    event.preventDefault();
                    event.stopPropagation();
                });
            })(sortableHeaders[i]);
        }
    }

    function updateLoadButtons() {
        var canFetch = !!sessionId && !!hasMoreRows;
        if (loadMoreBtn) {
            loadMoreBtn.hidden = !canFetch;
            if (canFetch) {
                loadMoreBtn.textContent = 'Load more';
            }
        }
        if (loadAllBtn) {
            loadAllBtn.hidden = !canFetch;
        }
    }

    function requestRows(requestType, statusText) {
        if (!sessionId || !hasMoreRows) {
            return;
        }
        setStatus(statusText);
        if (vscode.postMessage) {
            vscode.postMessage({ type: requestType, sessionId: sessionId });
        }
    }

    if (loadMoreBtn) {
        loadMoreBtn.addEventListener('click', function () {
            requestRows('loadMore', 'Loading next rows...');
        });
    }

    if (loadAllBtn) {
        loadAllBtn.addEventListener('click', function () {
            requestRows('loadAll', 'Loading all remaining rows...');
        });
    }

    if (firstBtn) {
        firstBtn.addEventListener('click', function () {
            scrollToRowIndex(0);
        });
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', function () {
            jumpByPages(-1);
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', function () {
            jumpByPages(1);
        });
    }

    if (lastBtn) {
        lastBtn.addEventListener('click', function () {
            var startOfLastPage = Math.max(0, rows.length - getEffectivePageSize());
            scrollToRowIndex(startOfLastPage);
        });
    }

    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', function () {
            updatePageSizeFromSelection();
            pageIndex = 0;
            renderRows({ scrollToTop: true });
        });
    }

    function jumpToPage(targetPage) {
        var totalPages = getTotalPages();
        var nextPage = Math.max(0, Math.min(totalPages - 1, targetPage));
        pageIndex = nextPage;

        if (tableWrap && pageIndex === 0) {
            tableWrap.scrollTop = 0;
            syncPageIndexFromScroll();
            updatePageButtons();
            if (pageSummary) {
                pageSummary.textContent = 'Page ' + (pageIndex + 1) + ' of ' + getTotalPages() + ' (' + rows.length + ' rows)';
            }
            return;
        }

        var targetRow = pageIndex * getEffectivePageSize();
        if (tableWrap && targetRow < rowOffsets.length) {
            scrollToRowIndex(targetRow);
            return;
        }

        renderRows();
    }

    if (tableWrap) {
        tableWrap.addEventListener('scroll', function () {
            syncPageIndexFromScroll();
            updatePageButtons();
            if (pageSummary) {
                var effectiveSize = getEffectivePageSize();
                var sizeLabel = pageSizeAuto ? ('AUTO=' + effectiveSize) : String(effectiveSize);
                pageSummary.textContent = 'Page ' + (pageIndex + 1) + ' of ' + getTotalPages() + ' (' + rows.length + ' rows, page ' + sizeLabel + ')';
            }
        });
    }

    window.addEventListener('resize', function () {
        if (!pageSizeAuto) {
            return;
        }
        syncPageIndexFromScroll();
        updatePageButtons();
        if (pageSummary) {
            var effectiveSize = getEffectivePageSize();
            pageSummary.textContent = 'Page ' + (pageIndex + 1) + ' of ' + getTotalPages() + ' (' + rows.length + ' rows, page AUTO=' + effectiveSize + ')';
        }
    });

    if (rerunBtn) {
        rerunBtn.addEventListener('click', function () {
            var statement = sqlStatement ? String(sqlStatement.textContent || '').trim() : '';
            if (!statement) {
                setStatus('No SQL statement available to rerun.');
                return;
            }
            rerunInFlight = true;
            setRerunBusy(true);
            setStatus('Rerunning SQL statement...');
            if (vscode.postMessage) {
                vscode.postMessage({ type: 'rerunSql', statement: statement });
            }
        });
    }

    window.addEventListener('message', function (event) {
        var message = event.data;
        if (!message) {
            return;
        }

        if (message.type === 'loadError') {
            setRerunBusy(false);
            setStatus(message.message || 'Unable to load additional rows.');
            return;
        }

        if (message.type === 'sqlSessionClosed') {
            setRerunBusy(false);
            sessionId = '';
            hasMoreRows = false;
            updateLoadButtons();
            setStatus(message.message || 'SQL result session is no longer available. Run the SQL statement again.');
            return;
        }

        if (message.type !== 'sqlResultReplace' || !message.payload) {
            return;
        }

        setRerunBusy(false);
        var wasRerun = rerunInFlight;
        rerunInFlight = false;
        var payload = message.payload;
        rows = (payload.rowCells && Array.isArray(payload.rowCells)) ? payload.rowCells.slice() : [];
        sessionId = payload.sessionId || '';
        hasMoreRows = !!payload.hasMoreRows;
        fetchSize = Number(payload.fetchSize || 0);

        if (sortColumnIndex >= 0) {
            applyActiveSort();
            updateSortIndicators();
        } else {
            updateSortIndicators();
        }
        renderRows({ preserveScroll: !wasRerun, scrollToTop: wasRerun });
        updateLoadButtons();
        if (wasRerun) {
            setStatus('Result set refreshed (' + rows.length + ' rows currently loaded).');
        } else {
            setStatus(hasMoreRows ? 'Additional rows loaded.' : 'All rows loaded.');
        }
    });

    try {
        updatePageSizeFromSelection();
        setRerunBusy(false);
        attachSortHandlers();
        attachResizeHandlers();
        applyWidths();
        renderRows({ scrollToTop: true });
        updateSortIndicators();
        updateLoadButtons();
        setStatus('Sorting/resizing ready. headers=' + sortableHeaders.length + '.');
    } catch (error) {
        try {
            var details = (error && typeof error === 'object' && error.message)
                ? String(error.message)
                : String(error || 'Unknown error');
            setStatus('Advanced table features are temporarily unavailable: ' + details);
        } catch (_statusError) {
            setStatus('Advanced table features are temporarily unavailable.');
        }
    }
})();
