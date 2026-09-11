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
    var resultTitleNode = document.getElementById('result-title');
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
    var resultTitle = String(initialPayload.resultTitle || '').trim();
    var hasMoreRows = !!initialPayload.hasMoreRows;
    var fetchSize = Number(initialPayload.fetchSize || 0);
    var rows = Array.isArray(initialPayload.rowCells) ? initialPayload.rowCells.slice() : [];

    function renderResultTitle() {
        if (!resultTitleNode) {
            return;
        }
        if (resultTitle) {
            resultTitleNode.textContent = resultTitle;
            resultTitleNode.classList.remove('is-hidden');
        } else {
            resultTitleNode.textContent = '';
            resultTitleNode.classList.add('is-hidden');
        }
    }

    var sortColumnIndex = -1;
    var sortDirection = 'asc';
    var suppressSortUntil = 0;
    var minColumnWidthPx = 80;
    var pageSize = 50;
    var pageSizeAuto = false;
    var pageIndex = 0;
    var autoPageStep = 0;
    var rowOffsets = [];
    var rowHeights = [];
    var rerunInFlight = false;
    var pagingDiagEnabled = true;

    function logPagingDiag(reason) {
        if (!pagingDiagEnabled || !tableWrap) {
            return;
        }

        var viewportHeight = Math.max(1, tableWrap.clientHeight);
        var maxScrollable = Math.max(0, tableWrap.scrollHeight - viewportHeight);
        try {
            console.log('[SQL Results][PagingDiag]', {
                reason: reason,
                pageSizeAuto: pageSizeAuto,
                pageIndex: pageIndex,
                totalPages: getTotalPages(),
                scrollTop: tableWrap.scrollTop,
                clientHeight: tableWrap.clientHeight,
                scrollHeight: tableWrap.scrollHeight,
                maxScrollable: maxScrollable,
                rows: rows.length
            });
        } catch (_e) {
            // Ignore console serialization issues.
        }
    }

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
            autoPageStep = 0;
            return;
        }

        var selectedValue = String(pageSizeSelect.value || '50').toUpperCase();
        pageSizeAuto = selectedValue === 'AUTO';
        autoPageStep = 0;
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

        return Math.max(1, Math.floor(getRowViewportHeight() / rowHeight));
    }

    function getRowViewportHeight() {
        if (!tableWrap) {
            return 1;
        }

        var totalHeight = Math.max(1, tableWrap.clientHeight);
        var thead = tableWrap.querySelector('thead');
        if (!thead) {
            return totalHeight;
        }

        var headerHeight = thead.getBoundingClientRect().height;
        if (!isFinite(headerHeight) || headerHeight <= 0) {
            return totalHeight;
        }

        return Math.max(1, totalHeight - headerHeight);
    }

    function getEffectivePageSize() {
        if (!pageSizeAuto) {
            return pageSize > 0 ? pageSize : 50;
        }
        return estimateVisibleRows();
    }

    function getVisibleRowCountFromStartRow(startRow) {
        if (!tableWrap || rowOffsets.length === 0) {
            return 1;
        }

        var start = Math.max(0, Math.min(rowOffsets.length - 1, startRow));
        var viewportHeight = getRowViewportHeight();
        var viewportTop = rowOffsets[start] || 0;
        var viewportBottom = viewportTop + viewportHeight;
        var visibleCount = 0;

        for (var i = start; i < rowOffsets.length; i++) {
            var rowTop = rowOffsets[i] || 0;
            if (rowTop >= viewportBottom) {
                break;
            }
            // Count rows whose top edge is inside the current row viewport.
            // This is more stable than overlap-based counting for page stepping.
            if (rowTop >= viewportTop) {
                visibleCount += 1;
            }
        }

        return Math.max(1, visibleCount);
    }

    function getMeasuredRowHeight(rowIndex) {
        if (!isFinite(rowIndex) || rowIndex < 0) {
            return 24;
        }

        if (rowIndex < rowHeights.length && rowHeights[rowIndex] > 0) {
            return rowHeights[rowIndex];
        }

        if (rowIndex < rowOffsets.length - 1) {
            var previousOffset = rowOffsets[rowIndex] || 0;
            var nextOffset = rowOffsets[rowIndex + 1] || previousOffset;
            if (nextOffset > previousOffset) {
                return nextOffset - previousOffset;
            }
        }

        if (rowHeights.length > 0) {
            return rowHeights[rowHeights.length - 1] || 24;
        }

        return 24;
    }

    function getAutoLastStartRow() {
        var anchors = getAutoPageAnchors();
        return anchors.length > 0 ? anchors[anchors.length - 1] : 0;
    }

    function getAutoPageAnchors() {
        if (!tableWrap || rowOffsets.length === 0) {
            return [0];
        }

        var anchors = [0];
        var startRow = 0;
        while (startRow < rowOffsets.length - 1) {
            var nextStart = computePageDownTargetRow(startRow);
            if (nextStart <= startRow) {
                nextStart = startRow + 1;
            }
            if (nextStart >= rowOffsets.length) {
                break;
            }
            anchors.push(nextStart);
            startRow = nextStart;
        }

        return anchors;
    }

    function getAutoPageSizeForIndex(pageIdx, anchors) {
        if (!anchors || anchors.length === 0) {
            return 0;
        }

        var idx = Math.max(0, Math.min(anchors.length - 1, pageIdx));
        var start = anchors[idx] || 0;
        var end = (idx + 1 < anchors.length)
            ? anchors[idx + 1]
            : rowOffsets.length;
        return Math.max(1, end - start);
    }

    function getAutoPageSizeFromStartRow(startRow) {
        if (!rowOffsets.length) {
            return 1;
        }

        var start = Math.max(0, Math.min(rowOffsets.length - 1, startRow));
        var nextStart = computePageDownTargetRow(start);
        if (nextStart <= start) {
            return Math.max(1, rowOffsets.length - start);
        }
        return Math.max(1, nextStart - start);
    }

    function getAutoStepForCurrentView(currentTopRow) {
        if (!rowOffsets.length) {
            return 1;
        }

        if (autoPageStep > 0) {
            return autoPageStep;
        }

        autoPageStep = getVisibleRowCountFromStartRow(currentTopRow);
        return Math.max(1, autoPageStep);
    }

    function buildPageSummaryText() {
        var totalPages = getTotalPages();
        if (pageSizeAuto) {
            var anchors = getAutoPageAnchors();
            pageIndex = getAutoPageIndexFromScrollAnchors(anchors);
            var autoSize = getAutoStepForCurrentView(getCurrentTopRowIndex());
            return 'Page ' + (pageIndex + 1) + ' of ' + totalPages + ' (' + rows.length + ' rows, page AUTO=' + autoSize + ')';
        }

        var effectiveSize = getEffectivePageSize();
        return 'Page ' + (pageIndex + 1) + ' of ' + totalPages + ' (' + rows.length + ' rows, page ' + effectiveSize + ')';
    }

    function getAutoPageIndexFromScrollAnchors(anchors) {
        if (!tableWrap || !anchors || anchors.length === 0) {
            return 0;
        }

        var topRow = findRowIndexForScrollTop(tableWrap.scrollTop);
        var index = 0;
        for (var i = 0; i < anchors.length; i++) {
            var anchorRow = anchors[i] || 0;
            if (topRow >= anchorRow) {
                index = i;
            } else {
                break;
            }
        }
        return Math.max(0, Math.min(index, anchors.length - 1));
    }

    function getTotalPages() {
        if (pageSizeAuto && tableWrap) {
            return Math.max(1, getAutoPageAnchors().length);
        }

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
        var baseOffsetTop = renderedRows.length > 0 ? renderedRows[0].offsetTop : 0;
        for (var i = 0; i < renderedRows.length; i++) {
            var normalizedTop = Math.max(0, renderedRows[i].offsetTop - baseOffsetTop);
            rowOffsets.push(normalizedTop);
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
        var visibleCount = pageSizeAuto
            ? getAutoStepForCurrentView(topIndex)
            : getVisibleRowCountFromStartRow(topIndex);
        var targetIndex = topIndex + visibleCount;

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

        // Jump back to the previous computed page anchor (same model as forward paging).
        var anchors = getAutoPageAnchors();
        var previous = 0;
        for (var i = 0; i < anchors.length; i++) {
            var anchor = anchors[i] || 0;
            if (anchor >= topIndex) {
                break;
            }
            previous = anchor;
        }

        return Math.max(0, Math.min(previous, topIndex - 1));
    }

    function findFirstRowIndexAtOrAfter(offset) {
        if (!rowOffsets.length) {
            return 0;
        }

        var low = 0;
        var high = rowOffsets.length - 1;
        var best = rowOffsets.length;
        while (low <= high) {
            var mid = Math.floor((low + high) / 2);
            if (rowOffsets[mid] >= offset) {
                best = mid;
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }

        if (best >= rowOffsets.length) {
            return rowOffsets.length - 1;
        }
        return best;
    }

    function findRowIndexForScrollTop(scrollTop) {
        if (!rowOffsets.length) {
            return 0;
        }

        // scrollTop can be 1px lower than measured row tops due to browser rounding.
        var adjustedTop = scrollTop + 1;

        var low = 0;
        var high = rowOffsets.length - 1;
        var best = 0;
        while (low <= high) {
            var mid = Math.floor((low + high) / 2);
            if (rowOffsets[mid] <= adjustedTop) {
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

        if (pageSizeAuto) {
            var anchors = getAutoPageAnchors();
            return getAutoPageIndexFromScrollAnchors(anchors);
        }

        var maxScrollable = Math.max(0, tableWrap.scrollHeight - tableWrap.clientHeight);
        if (maxScrollable <= 1) {
            return 0;
        }

        if (tableWrap.scrollTop <= 0) {
            return 0;
        }

        var totalPages = getTotalPages();
        if (tableWrap.scrollTop >= (maxScrollable - 1)) {
            return Math.max(0, totalPages - 1);
        }

        var topRow = findRowIndexForScrollTop(tableWrap.scrollTop);
        var size = getEffectivePageSize();
        return Math.max(0, Math.min(totalPages - 1, Math.floor(topRow / size)));
    }

    function getCurrentTopRowIndex() {
        if (!tableWrap || rowOffsets.length === 0) {
            return 0;
        }
        if (tableWrap.scrollTop <= 1) {
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

        var effectiveSize = getEffectivePageSize();
        var totalPages = getTotalPages();
        var targetRow = Math.max(0, Math.min(rowOffsets.length - 1, rowIndex));
        var requestedPageIndex = Math.max(0, Math.min(totalPages - 1, Math.floor(targetRow / effectiveSize)));
        tableWrap.scrollTop = Math.max(0, rowOffsets[targetRow]);
        syncPageIndexFromScroll();
        if (!pageSizeAuto && requestedPageIndex > pageIndex) {
            pageIndex = requestedPageIndex;
            clampPageIndex();
        }
        updatePageButtons();
        if (pageSummary) {
            pageSummary.textContent = buildPageSummaryText();
        }
    }

    function jumpByPages(deltaPages) {
        if (pageSizeAuto) {
            if (!tableWrap) {
                return;
            }

            rebuildRowOffsets();
            var targetTopRow = getCurrentTopRowIndex();
            if (deltaPages > 0) {
                for (var down = 0; down < deltaPages; down++) {
                    var nextRow = computePageDownTargetRow(targetTopRow);
                    if (nextRow <= targetTopRow) {
                        break;
                    }
                    targetTopRow = nextRow;
                }
            } else if (deltaPages < 0) {
                for (var up = 0; up < Math.abs(deltaPages); up++) {
                    var prevRow = computePageUpTargetRow(targetTopRow);
                    if (prevRow >= targetTopRow) {
                        break;
                    }
                    targetTopRow = prevRow;
                }
            }

            tableWrap.scrollTop = Math.max(0, rowOffsets[targetTopRow] || 0);
            syncPageIndexFromScroll();
            updatePageButtons();
            if (pageSummary) {
                pageSummary.textContent = buildPageSummaryText();
            }
            logPagingDiag('jumpByPages:auto');
            return;
        }

        var baseTopRow = getCurrentTopRowIndex();
        var targetRow;
        if (deltaPages === 1) {
            targetRow = computePageDownTargetRow(baseTopRow);
        } else if (deltaPages === -1) {
            targetRow = computePageUpTargetRow(baseTopRow);
        } else {
            var effectiveSize = getEffectivePageSize();
            targetRow = baseTopRow + (deltaPages * effectiveSize);
        }
        scrollToRowIndex(targetRow);
    }

    function updatePageButtons() {
        if (pageSizeAuto && tableWrap && rowOffsets.length > 0) {
            rebuildRowOffsets();
            var anchors = getAutoPageAnchors();
            var totalPages = Math.max(1, anchors.length);
            var pageNumber = getAutoPageIndexFromScrollAnchors(anchors);
            var topRow = getCurrentTopRowIndex();
            var canPageBackward = topRow > 0;
            var nextRow = computePageDownTargetRow(topRow);
            var canPageForward = nextRow > topRow;
            pageIndex = pageNumber;

            if (firstBtn) { firstBtn.disabled = !canPageBackward; }
            if (prevBtn) { prevBtn.disabled = !canPageBackward; }
            if (nextBtn) { nextBtn.disabled = !canPageForward; }
            if (lastBtn) { lastBtn.disabled = !canPageForward; }
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
        autoPageStep = 0;
        var html = '';
        for (var i = 0; i < rows.length; i++) {
            var cells = rows[i];
            var tds = '';
            if (Array.isArray(cells)) {
                for (var c = 0; c < cells.length; c++) {
                    var cell = cells[c] || {};
                    var classNames = [];
                    if (cell.alignClass) {
                        classNames.push(cell.alignClass);
                    }
                    if (cell.cellClass) {
                        classNames.push(cell.cellClass);
                    }
                    var alignClass = classNames.length > 0 ? ' class="' + classNames.join(' ') + '"' : '';
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
            pageSummary.textContent = buildPageSummaryText();
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
            if (pageSizeAuto && tableWrap) {
                var anchors = getAutoPageAnchors();
                var lastPage = Math.max(0, anchors.length - 1);
                pageIndex = lastPage;
                var lastTopRow = anchors[lastPage] || 0;
                tableWrap.scrollTop = Math.max(0, rowOffsets[lastTopRow] || 0);
                updatePageButtons();
                if (pageSummary) {
                    pageSummary.textContent = buildPageSummaryText();
                }
                return;
            }

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

        if (!tableWrap) {
            renderRows();
            return;
        }

        if (pageSizeAuto) {
            var autoAnchors = getAutoPageAnchors();
            var targetRow = autoAnchors[Math.max(0, Math.min(autoAnchors.length - 1, nextPage))] || 0;
            tableWrap.scrollTop = Math.max(0, rowOffsets[targetRow] || 0);
            syncPageIndexFromScroll();
            updatePageButtons();
            if (pageSummary) {
                pageSummary.textContent = buildPageSummaryText();
            }
            return;
        }

        if (pageIndex === 0) {
            tableWrap.scrollTop = 0;
            syncPageIndexFromScroll();
            updatePageButtons();
            if (pageSummary) {
                pageSummary.textContent = buildPageSummaryText();
            }
            return;
        }

        var targetRow = pageIndex * getEffectivePageSize();
        if (targetRow < rowOffsets.length) {
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
                pageSummary.textContent = buildPageSummaryText();
            }
            logPagingDiag('scroll');
        });
    }

    window.addEventListener('resize', function () {
        if (!pageSizeAuto) {
            return;
        }
        autoPageStep = 0;
        syncPageIndexFromScroll();
        updatePageButtons();
        if (pageSummary) {
            pageSummary.textContent = buildPageSummaryText();
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
                vscode.postMessage({ type: 'rerunSql', statement: statement, resultTitle: resultTitle });
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
        resultTitle = String(payload.resultTitle || '').trim();
        sessionId = payload.sessionId || '';
        hasMoreRows = !!payload.hasMoreRows;
        fetchSize = Number(payload.fetchSize || 0);
        renderResultTitle();

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
        renderResultTitle();
        renderRows({ scrollToTop: true });
        updateSortIndicators();
        updateLoadButtons();
        // Re-measure once the browser has finalized layout so AUTO summary starts accurate.
        requestAnimationFrame(function () {
            if (!tableWrap) {
                return;
            }
            rebuildRowOffsets();
            syncPageIndexFromScroll();
            updatePageButtons();
            if (pageSummary) {
                pageSummary.textContent = buildPageSummaryText();
            }
        });
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
