(() => {
  const state = vscode.getState() || { command: '', mode: '*RUN', filterSeverity: 0, history: [], executions: [], commandHeightPx: 0 };
  const maxExecutions = 30, maxMessages = 100;
  const noConnectionText = 'no connection';
  const MENU_POSITION_DEBUG = true;
  const minTextareaRows = 2;
  const command = document.getElementById('command'), mode = document.getElementById('mode'), severityFilter = document.getElementById('message-severity-filter');
  const run = document.getElementById('run'), prompt = document.getElementById('prompt'), snippets = document.getElementById('snippets'), cmdEntrySettings = document.getElementById('cmdentry-settings'), snippetsMenuList = document.getElementById('snippets-menu-list'), snippetsMenuManage = document.getElementById('snippets-menu-manage'), snippetsMenuToggle = document.getElementById('snippets-menu-toggle'), snippetsMenuRefresh = document.getElementById('snippets-menu-refresh'), snippetsMenuImport = document.getElementById('snippets-menu-import'), snippetsMenuExport = document.getElementById('snippets-menu-export'), snippetsMenuAdd = document.getElementById('snippets-menu-add'), clearCommand = document.getElementById('clear-command'), toolbarMenu = document.getElementById('toolbar-menu'), toolbarMenuList = document.getElementById('toolbar-menu-list'), menuViewLog = document.getElementById('menu-view-log'), menuClearLog = document.getElementById('menu-clear-log'), menuClearSqlLog = document.getElementById('menu-clear-sql-log'), menuToggleSqlLog = document.getElementById('menu-toggle-sql-log'), menuToggleMessageDetails = document.getElementById('menu-toggle-message-details'), menuStartNewJob = document.getElementById('menu-start-new-job'), menuCancelSqlJob = document.getElementById('menu-cancel-sql-job'), menuClearHistory = document.getElementById('menu-clear-history'), historyPrev = document.getElementById('history-prev'), historyNext = document.getElementById('history-next'), statusJobMenu = document.getElementById('status-job-menu'), statusJobMenuCopy = document.getElementById('status-job-menu-copy'), statusJobMenuDisplayJoblog = document.getElementById('status-job-menu-display-joblog');
  const statusText = document.getElementById('status-text'), statusJobId = document.getElementById('status-jobid'), results = document.getElementById('results');
  let historyIndex = -1, runningStartedAt, runningTimerId, runningStatusPrefix = 'Running…', historyDraft = '', sqlJobPollingId;
  let statusJobSingleClickTimer;
  let historyHoverTooltipEl;
  let dedicatedJobEnabled = false;
  let remoteMapepireEnabled = false;
  let canStartNewJob = false;
  let canCancelSqlJob = false;
  let messageDetailsMode = 'SHOW';
  let logSqlStatementsToCommandLog = false;
  let baseMinHeightPx = 0, autoResizing = false;
  const applyAppearancePreferences = commandTextColor => {
    const value = String(commandTextColor || '').trim();
    if (value) {
      document.documentElement.style.setProperty('--clp-command-log-color', value);
      return;
    }
    document.documentElement.style.removeProperty('--clp-command-log-color');
  };
  // Wrap the mode select so we can render a custom CSS tooltip with fast hover behavior.
  const modeTooltipWrap = document.createElement('span');
  modeTooltipWrap.id = 'mode-tooltip-wrap';
  mode.parentNode?.insertBefore(modeTooltipWrap, mode);
  modeTooltipWrap.appendChild(mode);
  const save = () => {
    state.command = command.value;
    state.mode = mode.value;
    state.filterSeverity = Number(severityFilter?.value || 0);
    state.history = state.history || [];
    state.executions = state.executions || [];
    state.commandHeightPx = Number(state.commandHeightPx || 0);
    vscode.setState(state);
  };
  const formatElapsed = ms => ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  const setStatusMessage = (message = '') => {
    statusText.textContent = message;
  };
  const hasRealSqlJobId = () => {
    const value = statusJobId.textContent?.trim().toLowerCase();
    return !!value && value !== noConnectionText;
  };
  const setStatusJobId = (sqlJobId = '') => {
    const normalized = String(sqlJobId || '').trim();
    const isConnected = normalized.length > 0;
    const statusJobLabel = isConnected
      ? 'SQL job ID. Click to copy, double-click to display joblog, right-click for menu.'
      : 'No IBM i connection job detected. Connect to an IBM i server to enabled Command Entry.';
    statusJobId.textContent = normalized || noConnectionText;
    statusJobId.classList.toggle('no-connection', !isConnected);
    statusJobId.title = statusJobLabel;
    statusJobId.setAttribute('data-tooltip', statusJobLabel);
    statusJobId.setAttribute('aria-label', statusJobLabel);
    statusJobId.hidden = false;
  };
  const requestSqlJobId = () => {
    vscode.postMessage({ type: 'requestSqlJobId' });
  };
  const stopSqlJobPolling = () => {
    if (sqlJobPollingId) {
      clearInterval(sqlJobPollingId);
      sqlJobPollingId = undefined;
    }
  };
  const startSqlJobPollingIfNeeded = () => {
    if (hasRealSqlJobId()) {
      stopSqlJobPolling();
      return;
    }
    if (sqlJobPollingId) { return; }
    requestSqlJobId();
    sqlJobPollingId = setInterval(() => {
      if (hasRealSqlJobId()) {
        stopSqlJobPolling();
        return;
      }
      requestSqlJobId();
    }, 5000);
  };
  const copyStatusJobId = () => {
    const sqlJobId = statusJobId.textContent?.trim();
    if (!sqlJobId || sqlJobId.toLowerCase() === noConnectionText) { return; }
    vscode.postMessage({ type: 'copySqlJobId', sqlJobId });
  };

  const displayStatusJoblog = () => {
    const sqlJobId = statusJobId.textContent?.trim();
    if (!sqlJobId || sqlJobId.toLowerCase() === noConnectionText) { return; }
    vscode.postMessage({ type: 'requestDisplayJoblog', sqlJobId });
  };
  const selectEntireStatusJobId = () => {
    const sqlJobId = statusJobId?.textContent?.trim();
    if (!statusJobId || !sqlJobId || sqlJobId.toLowerCase() === noConnectionText) { return; }
    const selection = window.getSelection();
    if (!selection) { return; }
    const range = document.createRange();
    range.selectNodeContents(statusJobId);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const updateModeTooltip = () => {
    const selected = mode.options[mode.selectedIndex];
    const help = selected?.title || 'Run mode';
    modeTooltipWrap.setAttribute('data-tooltip', help);
    mode.removeAttribute('title');
    mode.setAttribute('aria-description', help);
  };

  const suppressModeTooltip = () => {
    modeTooltipWrap.classList.add('tooltip-suppressed');
  };

  const restoreModeTooltip = () => {
    modeTooltipWrap.classList.remove('tooltip-suppressed');
  };

  const hideHistoryHoverTooltip = () => {
    if (!historyHoverTooltipEl) { return; }
    historyHoverTooltipEl.remove();
    historyHoverTooltipEl = undefined;
  };

  const showHistoryHoverTooltip = anchor => {
    const tooltipText = String(anchor?.getAttribute('data-tooltip') || '').trim();
    if (!tooltipText) {
      hideHistoryHoverTooltip();
      return;
    }

    hideHistoryHoverTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'history-hover-tooltip';
    tooltip.textContent = tooltipText;
    document.body.appendChild(tooltip);

    const margin = 8;
    const offset = 6;
    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    let left = anchorRect.left;
    if (left + tooltipRect.width + margin > window.innerWidth) {
      left = window.innerWidth - tooltipRect.width - margin;
    }
    left = Math.max(margin, left);

    const spaceAbove = anchorRect.top - margin;
    const spaceBelow = window.innerHeight - anchorRect.bottom - margin;
    const showAbove = spaceAbove >= tooltipRect.height + offset || spaceAbove >= spaceBelow;

    let top = showAbove
      ? anchorRect.top - tooltipRect.height - offset
      : anchorRect.bottom + offset;
    top = Math.max(margin, Math.min(top, window.innerHeight - tooltipRect.height - margin));

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.classList.toggle('is-below', !showAbove);
    historyHoverTooltipEl = tooltip;
  };

  const attachHistoryHoverTooltip = element => {
    element.addEventListener('mouseenter', () => showHistoryHoverTooltip(element));
    element.addEventListener('mouseleave', hideHistoryHoverTooltip);
    element.addEventListener('focus', () => showHistoryHoverTooltip(element));
    element.addEventListener('blur', hideHistoryHoverTooltip);
  };
  if (toolbarMenuList) {
    toolbarMenuList.classList.remove('is-open');
    toolbarMenuList.setAttribute('aria-hidden', 'true');
  }
  if (snippetsMenuList) {
    snippetsMenuList.classList.remove('is-open');
    snippetsMenuList.setAttribute('aria-hidden', 'true');
  }
  if (statusJobMenu) {
    statusJobMenu.classList.remove('is-open');
    statusJobMenu.setAttribute('aria-hidden', 'true');
  }
  const closeToolbarMenu = () => {
    if (!toolbarMenuList || !toolbarMenu) { return; }
    toolbarMenuList.classList.remove('is-open');
    toolbarMenuList.classList.remove('flip-up');
    toolbarMenuList.classList.remove('compact-grid');
    toolbarMenuList.style.position = '';
    toolbarMenuList.style.left = '';
    toolbarMenuList.style.top = '';
    toolbarMenuList.style.right = '';
    toolbarMenuList.style.bottom = '';
    toolbarMenuList.style.width = '';
    toolbarMenuList.style.maxHeight = '';
    toolbarMenuList.style.overflowY = '';
    toolbarMenuList.style.removeProperty('--toolbar-menu-columns');
    toolbarMenuList.setAttribute('aria-hidden', 'true');
    toolbarMenu.setAttribute('aria-expanded', 'false');
  };
  const closeSnippetsMenu = () => {
    if (!snippetsMenuList || !snippets) { return; }
    snippetsMenuList.classList.remove('is-open');
    snippetsMenuList.classList.remove('flip-up');
    snippetsMenuList.classList.remove('compact-grid');
    snippetsMenuList.style.position = '';
    snippetsMenuList.style.left = '';
    snippetsMenuList.style.top = '';
    snippetsMenuList.style.right = '';
    snippetsMenuList.style.bottom = '';
    snippetsMenuList.style.width = '';
    snippetsMenuList.style.maxHeight = '';
    snippetsMenuList.style.overflowY = '';
    snippetsMenuList.style.removeProperty('--toolbar-menu-columns');
    snippetsMenuList.setAttribute('aria-hidden', 'true');
    snippets.setAttribute('aria-expanded', 'false');
  };
  const logMenuPlacementDebug = (phase, payload) => {
    if (!MENU_POSITION_DEBUG) { return; }
    console.log(`[Command Entry][MenuDebug] ${phase}`, payload);
    vscode.postMessage({ type: 'menuDebug', phase, payload });
  };
  const closeStatusJobMenu = () => {
    if (!statusJobMenu) { return; }
    statusJobMenu.classList.remove('is-open');
    statusJobMenu.style.position = '';
    statusJobMenu.style.left = '';
    statusJobMenu.style.top = '';
    statusJobMenu.style.right = '';
    statusJobMenu.style.bottom = '';
    statusJobMenu.style.width = '';
    statusJobMenu.style.maxHeight = '';
    statusJobMenu.style.overflowY = '';
    statusJobMenu.setAttribute('aria-hidden', 'true');
    statusJobMenu.removeAttribute('data-jobid');
  };
  const openStatusJobMenu = (clientX, clientY, sqlJobId) => {
    if (!statusJobMenu) { return; }
    closeToolbarMenu();
    statusJobMenu.classList.remove('flip-up');
    statusJobMenu.classList.remove('compact-grid');
    statusJobMenu.style.removeProperty('--toolbar-menu-columns');
    statusJobMenu.classList.add('is-open');
    statusJobMenu.setAttribute('aria-hidden', 'false');
    statusJobMenu.setAttribute('data-jobid', sqlJobId);

    const edgePadding = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const naturalRect = statusJobMenu.getBoundingClientRect();
    const menuWidth = Math.ceil(naturalRect.width || 180);
    const menuHeight = Math.ceil(naturalRect.height || 64);

    const left = Math.max(edgePadding, Math.min(clientX, viewportWidth - edgePadding - menuWidth));
    const top = Math.max(edgePadding, Math.min(clientY, viewportHeight - edgePadding - menuHeight));

    statusJobMenu.style.position = 'fixed';
    statusJobMenu.style.left = `${Math.round(left)}px`;
    statusJobMenu.style.top = `${Math.round(top)}px`;
    statusJobMenu.style.right = 'auto';
    statusJobMenu.style.bottom = 'auto';
    statusJobMenuCopy?.focus();
  };
  const positionToolbarMenu = () => {
    if (!toolbarMenuList || !toolbarMenu) { return; }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const edgePadding = 8;
    const gap = 4;

    // Reset dynamic styles to measure natural size each time.
    toolbarMenuList.style.position = '';
    toolbarMenuList.style.left = '';
    toolbarMenuList.style.top = '';
    toolbarMenuList.style.right = '';
    toolbarMenuList.style.bottom = '';
    toolbarMenuList.style.width = '';
    toolbarMenuList.style.maxHeight = '';
    toolbarMenuList.style.overflowY = '';
    toolbarMenuList.classList.remove('flip-up');

    const anchorRect = toolbarMenu.getBoundingClientRect();
    let menuRect = toolbarMenuList.getBoundingClientRect();
    let naturalHeight = Math.ceil(toolbarMenuList.scrollHeight || menuRect.height);
    let naturalWidth = Math.ceil(menuRect.width || 190);
    const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - edgePadding);
    const spaceAbove = Math.max(0, anchorRect.top - gap - edgePadding);
    const fitsBelow = naturalHeight <= spaceBelow;
    const fitsAbove = naturalHeight <= spaceAbove;

    // Prefer the side that fits naturally. If neither fits, prefer opening above to keep
    // the menu away from the panel bottom as the viewport shrinks.
    let shouldFlipUp;
    if (fitsBelow) {
      shouldFlipUp = false;
    } else if (fitsAbove) {
      shouldFlipUp = true;
    } else {
      shouldFlipUp = true;
    }
    toolbarMenuList.classList.toggle('flip-up', shouldFlipUp);

    const maxViewportHeight = Math.max(24, Math.floor(viewportHeight - edgePadding * 2));
    const constrainedFlipUp = shouldFlipUp && !fitsAbove;

    // If neither side fits, switch to compact grid only when overflow is substantial.
    // This keeps the normal one-column menu longer and avoids an early compact jump.
    let compactGrid = false;
    const bestSingleColumnSpace = Math.max(spaceAbove, spaceBelow);
    const singleColumnOverflow = Math.max(0, naturalHeight - bestSingleColumnSpace);
    const compactActivationOverflowPx = 28;
    if (!fitsBelow && !fitsAbove && singleColumnOverflow >= compactActivationOverflowPx) {
      toolbarMenuList.classList.add('compact-grid');
      const itemCount = toolbarMenuList.querySelectorAll('button').length;
      const compactRowHeight = 18;
      const compactPaddingAndGap = 10;
      const maxRowsThatFit = Math.max(1, Math.floor((maxViewportHeight - compactPaddingAndGap) / compactRowHeight));
      const compactColumns = Math.max(2, Math.min(3, Math.ceil(itemCount / maxRowsThatFit)));
      toolbarMenuList.style.setProperty('--toolbar-menu-columns', String(compactColumns));

      menuRect = toolbarMenuList.getBoundingClientRect();
      const compactHeight = Math.ceil(toolbarMenuList.scrollHeight || menuRect.height);
      const compactWidth = Math.ceil(menuRect.width || naturalWidth);
      compactGrid = true;
      naturalHeight = compactHeight;
      naturalWidth = compactWidth;
    }

    const sideAvailableHeight = Math.max(
      24,
      Math.floor(
        shouldFlipUp
          ? (constrainedFlipUp ? maxViewportHeight : spaceAbove)
          : spaceBelow
      )
    );
    const effectiveHeight = Math.max(24, Math.min(naturalHeight, sideAvailableHeight, maxViewportHeight));

    // Pin to viewport so parent layout/overflow cannot clip the menu.
    toolbarMenuList.style.position = 'fixed';

    const maxUsableWidth = Math.max(120, viewportWidth - edgePadding * 2);
    const effectiveWidth = Math.min(naturalWidth, maxUsableWidth);
    toolbarMenuList.style.width = `${effectiveWidth}px`;

    const unclampedLeft = anchorRect.right - effectiveWidth;
    const clampedLeft = Math.max(edgePadding, Math.min(unclampedLeft, viewportWidth - edgePadding - effectiveWidth));
    toolbarMenuList.style.left = `${Math.round(clampedLeft)}px`;
    toolbarMenuList.style.right = 'auto';

    const openTop = shouldFlipUp
      ? ((constrainedFlipUp ? anchorRect.bottom : anchorRect.top) - gap - effectiveHeight)
      : anchorRect.bottom + gap;
    const clampedTop = Math.max(edgePadding, Math.min(openTop, viewportHeight - edgePadding - effectiveHeight));
    toolbarMenuList.style.top = `${Math.round(clampedTop)}px`;
    toolbarMenuList.style.bottom = 'auto';

    if (naturalHeight > effectiveHeight) {
      toolbarMenuList.style.maxHeight = `${effectiveHeight}px`;
      toolbarMenuList.style.overflowY = 'auto';
    }

    // Final viewport clamp after actual layout (accounts for borders, padding, and scrollbars).
    let finalRect = toolbarMenuList.getBoundingClientRect();
    const viewportTopLimit = edgePadding;
    const viewportBottomLimit = viewportHeight - edgePadding;

    const overflowBottom = finalRect.bottom - viewportBottomLimit;
    if (overflowBottom > 0) {
      const adjustedTop = Math.max(viewportTopLimit, Math.round(clampedTop - overflowBottom));
      toolbarMenuList.style.top = `${adjustedTop}px`;
      finalRect = toolbarMenuList.getBoundingClientRect();
    }

    const overflowTop = viewportTopLimit - finalRect.top;
    if (overflowTop > 0) {
      const adjustedTop = Math.min(Math.round(viewportBottomLimit - finalRect.height), Math.round(finalRect.top + overflowTop));
      toolbarMenuList.style.top = `${Math.max(viewportTopLimit, adjustedTop)}px`;
      finalRect = toolbarMenuList.getBoundingClientRect();
    }

    const clipping = {
      top: finalRect.top < 0,
      bottom: finalRect.bottom > viewportHeight,
      left: finalRect.left < 0,
      right: finalRect.right > viewportWidth
    };
    logMenuPlacementDebug('position', {
      viewport: { width: viewportWidth, height: viewportHeight },
      anchor: {
        top: Math.round(anchorRect.top),
        bottom: Math.round(anchorRect.bottom),
        left: Math.round(anchorRect.left),
        right: Math.round(anchorRect.right)
      },
      natural: { width: naturalWidth, height: naturalHeight },
      space: { above: Math.floor(spaceAbove), below: Math.floor(spaceBelow) },
      fit: {
        fitsAbove,
        fitsBelow,
        shouldFlipUp,
        constrainedFlipUp,
        compactGrid,
        singleColumnOverflow: Math.round(singleColumnOverflow),
        compactActivationOverflowPx,
        sideAvailableHeight
      },
      applied: {
        width: effectiveWidth,
        height: effectiveHeight,
        top: Math.round(clampedTop),
        left: Math.round(clampedLeft),
        maxHeight: toolbarMenuList.style.maxHeight || '<none>',
        overflowY: toolbarMenuList.style.overflowY || '<none>'
      },
      finalRect: {
        top: Math.round(finalRect.top),
        bottom: Math.round(finalRect.bottom),
        left: Math.round(finalRect.left),
        right: Math.round(finalRect.right),
        width: Math.round(finalRect.width),
        height: Math.round(finalRect.height)
      },
      clipping
    });
  };
  const positionSnippetsMenu = () => {
    if (!snippetsMenuList || !snippets) { return; }

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const edgePadding = 8;
    const gap = 4;

    snippetsMenuList.style.position = '';
    snippetsMenuList.style.left = '';
    snippetsMenuList.style.top = '';
    snippetsMenuList.style.right = '';
    snippetsMenuList.style.bottom = '';
    snippetsMenuList.style.width = '';
    snippetsMenuList.style.maxHeight = '';
    snippetsMenuList.style.overflowY = '';
    snippetsMenuList.classList.remove('flip-up');

    const anchorRect = snippets.getBoundingClientRect();
    let menuRect = snippetsMenuList.getBoundingClientRect();
    let naturalHeight = Math.ceil(snippetsMenuList.scrollHeight || menuRect.height);
    let naturalWidth = Math.ceil(menuRect.width || 200);
    const maxWidth = Math.max(180, viewportWidth - edgePadding * 2);
    const maxHeight = Math.max(100, viewportHeight - edgePadding * 2);
    const effectiveWidth = Math.max(180, Math.min(naturalWidth, maxWidth));
    const effectiveHeight = Math.max(40, Math.min(naturalHeight, maxHeight));

    const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - edgePadding);
    const spaceAbove = Math.max(0, anchorRect.top - gap - edgePadding);
    const flipUp = spaceBelow < effectiveHeight && spaceAbove > spaceBelow;

    if (flipUp) {
      snippetsMenuList.classList.add('flip-up');
    } else {
      snippetsMenuList.classList.remove('flip-up');
    }

    const left = Math.min(Math.max(edgePadding, anchorRect.left), viewportWidth - edgePadding - effectiveWidth);
    const top = flipUp
      ? anchorRect.top - gap - effectiveHeight
      : anchorRect.bottom + gap;
    const clampedTop = Math.max(edgePadding, Math.min(top, viewportHeight - edgePadding - effectiveHeight));

    snippetsMenuList.style.position = 'fixed';
    snippetsMenuList.style.width = `${Math.round(effectiveWidth)}px`;
    snippetsMenuList.style.left = `${Math.round(left)}px`;
    snippetsMenuList.style.top = `${Math.round(clampedTop)}px`;
    snippetsMenuList.style.right = 'auto';
    snippetsMenuList.style.bottom = 'auto';
    snippetsMenuList.style.maxHeight = `${Math.round(maxHeight)}px`;
    snippetsMenuList.style.overflowY = effectiveHeight >= maxHeight ? 'auto' : 'visible';
  };
  const openToolbarMenu = () => {
    if (!toolbarMenuList || !toolbarMenu) { return; }
    closeSnippetsMenu();
    toolbarMenuList.classList.add('is-open');
    toolbarMenuList.setAttribute('aria-hidden', 'false');
    toolbarMenu.setAttribute('aria-expanded', 'true');
    positionToolbarMenu();
  };
  const openSnippetsMenu = () => {
    if (!snippetsMenuList || !snippets) { return; }
    closeToolbarMenu();
    closeStatusJobMenu();
    snippetsMenuList.classList.add('is-open');
    snippetsMenuList.setAttribute('aria-hidden', 'false');
    snippets.setAttribute('aria-expanded', 'true');
    positionSnippetsMenu();
  };
  const repositionToolbarMenuIfOpen = () => {
    if (!toolbarMenuList?.classList.contains('is-open')) { return; }
    positionToolbarMenu();
  };
  const repositionSnippetsMenuIfOpen = () => {
    if (!snippetsMenuList?.classList.contains('is-open')) { return; }
    positionSnippetsMenu();
  };
  const toggleToolbarMenu = () => {
    if (!toolbarMenuList || !toolbarMenu) { return; }
    if (!toolbarMenuList.classList.contains('is-open')) {
      openToolbarMenu();
      menuViewLog?.focus();
      return;
    }
    closeToolbarMenu();
  };
  const updateClearCommandState = () => {
    clearCommand.disabled = command.value.length === 0;
  };
  const isSqlCommandText = (value) => {
    const text = String(value || '');
    return /^\s*sql\s*:/i.test(text) || /^\s*(select|values)\b/i.test(text);
  };
  const applySqlPrefixForRecall = (value, isSqlHint) => {
    const text = String(value || '');
    if (/^\s*(sql|cl)\s*:/i.test(text)) {
      return text;
    }
    if (!isSqlHint) {
      return text;
    }
    const trimmed = text.trim();
    return trimmed ? `SQL: ${trimmed}` : text;
  };
  const areMessageDetailsShown = () => messageDetailsMode !== 'HIDE';
  const updateMessageDetailsMenuLabel = () => {
    if (!menuToggleMessageDetails) { return; }
    const showing = areMessageDetailsShown();
    menuToggleMessageDetails.textContent = showing ? 'Collapse Message Details' : 'Expand Message Details';
    menuToggleMessageDetails.title = showing ? 'Collapse command-level message details' : 'Expand command-level message details';
  };
  const updateSqlLoggingMenuLabel = () => {
    if (!menuToggleSqlLog) { return; }
    menuToggleSqlLog.textContent = `${logSqlStatementsToCommandLog ? '✓ ' : ''}Log SQL Statements`;
    menuToggleSqlLog.title = logSqlStatementsToCommandLog
      ? 'Disable logging SQL statements to the Command Entry Log'
      : 'Enable logging SQL statements to the Command Entry Log';
  };
  const applyMessageDetailsMode = () => {
    const expand = areMessageDetailsShown();
    const executions = state.executions || [];
    executions.forEach(execution => {
      execution.collapsed = !expand;
    });
  };
  const updateMenuCapabilities = () => {
    const cancelDisabled = !canCancelSqlJob;
    if (menuCancelSqlJob) {
      menuCancelSqlJob.disabled = cancelDisabled;
      const reason = cancelDisabled
        ? (!dedicatedJobEnabled
          ? 'Available only when shared SQL job mode is disabled (set clPrompter.cmdEntryUseSharedSQLJob=false)'
          : 'Enable Code for IBM i setting "Connect to remote Mapepire Server"')
        : 'Cancel the last SQL request on the dedicated SQL job';
      menuCancelSqlJob.title = reason;
      menuCancelSqlJob.setAttribute('aria-disabled', String(cancelDisabled));
    }
    if (menuStartNewJob) {
      menuStartNewJob.disabled = !canStartNewJob;
      const reason = canStartNewJob
        ? 'Reconnect the dedicated SQL job'
        : (!dedicatedJobEnabled
          ? 'Available only when shared SQL job mode is disabled (set clPrompter.cmdEntryUseSharedSQLJob=false)'
          : 'Enable Code for IBM i setting "Connect to remote Mapepire Server"');
      menuStartNewJob.title = reason;
      menuStartNewJob.setAttribute('aria-disabled', String(!canStartNewJob));
    }
    updateMessageDetailsMenuLabel();
  };
  const normalizeCommand = value => String(value || '').replace(/[\r\n]+/g, '');
  const lineCount = value => Math.max(minTextareaRows, String(value || '').split(/\r\n|\n|\r/).length);
  const rememberCommandHeight = heightPx => {
    const rounded = Math.max(baseMinHeightPx, Math.round(Number(heightPx || 0)));
    if (!Number.isFinite(rounded) || rounded <= 0) { return; }
    if (rounded === Number(state.commandHeightPx || 0)) { return; }
    state.commandHeightPx = rounded;
    save();
  };
  const measureBaseHeight = () => {
    if (baseMinHeightPx > 0) { return baseMinHeightPx; }
    autoResizing = true;
    command.style.height = 'auto';
    const measured = Math.ceil(command.scrollHeight);
    autoResizing = false;
    baseMinHeightPx = Math.max(measured, 1);
    return baseMinHeightPx;
  };
  const resizeCommandInput = () => {
    const minHeight = measureBaseHeight();
    const rememberedHeight = Math.max(minHeight, Number(state.commandHeightPx || 0));
    command.rows = Math.max(minTextareaRows, lineCount(command.value));
    autoResizing = true;
    command.style.height = 'auto';
    const autoHeight = Math.max(minHeight, Math.ceil(command.scrollHeight));
    command.style.height = `${Math.max(autoHeight, rememberedHeight)}px`;
    autoResizing = false;
  };
  const recallPrevious = () => {
    if (!state.history.length) { return; }
    if (historyIndex === -1) {
      historyDraft = command.value;
    }
    if (historyIndex < state.history.length - 1) {
      historyIndex += 1;
      applyHistoryEntry(historyIndex);
    }
  };
  const recallNext = () => {
    if (!state.history.length) { return; }
    if (historyIndex > -1) {
      historyIndex -= 1;
    }
    applyHistoryEntry(historyIndex);
  };
  const clearCommandInput = () => {
    command.value = '';
    historyDraft = '';
    historyIndex = -1;
    save();
    updateClearCommandState();
    resizeCommandInput();
    command.focus();
  };
  const applyHistoryEntry = (index) => {
    if (index < 0) {
      command.value = historyDraft;
      mode.value = state.mode || '*RUN';
      updateModeTooltip();
      save();
      updateClearCommandState();
      resizeCommandInput();
      command.setSelectionRange(0, 0);
      return;
    }
    const item = state.history[index];
    if (!item) { return; }
    const historySqlHint = typeof item.isSql === 'boolean'
      ? item.isSql
      : (isSqlCommandText(item.command) || /^\s*(insert|update|delete|merge|call)\b/i.test(String(item.command || '')));
    command.value = applySqlPrefixForRecall(item.command, historySqlHint);
    mode.value = item.mode;
    updateModeTooltip();
    save();
    updateClearCommandState();
    resizeCommandInput();
    command.setSelectionRange(0, 0);
    command.focus();
  };
  function render({ pinNewest = false } = {}) {
    const previousScrollTop = results.scrollTop;
    results.replaceChildren();
    const minSeverity = Number(state.filterSeverity || 0);
    state.executions.forEach((execution, index) => {
      const isLatest = index === 0;
      const article = document.createElement('article');
      article.className = `execution${isLatest ? ' latest' : ''}`;
      if (execution.collapsed) { article.classList.add('collapsed'); }
      const header = document.createElement('header');
      const meta = `${new Date(execution.startedAt).toLocaleString()} · ${execution.mode} · ${formatElapsed(execution.elapsedMs)}`;
      const replayMarker = text('span', execution.collapsed ? '▶' : '▼', 'execution-replay');
      replayMarker.tabIndex = 0;
      const commandEl = text('span', execution.command, 'execution-command');
      commandEl.setAttribute('data-tooltip', 'Click=Recall, Double-Click=Copy');
      commandEl.tabIndex = 0;
      attachHistoryHoverTooltip(commandEl);
      let clickTimer;
      const singleClickDelayMs = 140;
      const reuseCommand = () => {
        const executionIsSql = !!execution.sqlResult
          || (execution.messages || []).some(message => String(message.messageId || '').trim().toUpperCase() === 'SQL0000');
        command.value = applySqlPrefixForRecall(execution.command, executionIsSql);
        save();
        updateClearCommandState();
        setStatusMessage('Loaded command from history. Current run mode preserved.');
        command.focus();
      };
      const toggleMessages = () => {
        execution.collapsed = !execution.collapsed;
        save();
        render({ pinNewest: false });
      };
      const copyCommandToClipboard = () => {
        vscode.postMessage({ type: 'copyCommand', command: execution.command });
      };
      const handleSingleClick = event => {
        if (event.detail > 1) { return; }
        if (clickTimer) {
          clearTimeout(clickTimer);
        }
        clickTimer = setTimeout(() => {
          clickTimer = undefined;
          reuseCommand();
        }, singleClickDelayMs);
      };
      const handleToggleClick = event => {
        event.preventDefault();
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = undefined;
        }
        toggleMessages();
      };
      const handleDoubleClick = event => {
        event.preventDefault();
        if (clickTimer) {
          clearTimeout(clickTimer);
          clickTimer = undefined;
        }
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
        }
        copyCommandToClipboard();
      };
      commandEl.addEventListener('click', handleSingleClick);
      commandEl.addEventListener('dblclick', handleDoubleClick);
      commandEl.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reuseCommand();
        }
      });
      replayMarker.addEventListener('click', handleToggleClick);
      replayMarker.addEventListener('dblclick', handleDoubleClick);
      replayMarker.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleMessages();
        }
      });
      header.append(replayMarker, commandEl, text('span', meta, 'meta'));
      article.append(header);
      if (execution.failure) article.append(text('div', execution.failure, 'failure'));
      if (!execution.collapsed) {
        const visibleMessages = (execution.messages || []).filter(message => Number(message.severity || 0) >= minSeverity);
        visibleMessages.forEach(message => {
          const item = document.createElement('div'); item.className = `message ${message.kind}`;
          const messageMeta = `${message.ordinalPosition}. ${message.messageId || '—'} Sev ${message.severity} ${message.type || ''}`;
          const hasFirstLevelContext = [
            message.sentTimestamp,
            message.sentFromProgram,
            message.sentFromStmt,
            message.sentFromModule,
            message.sentFromProcedure,
            message.sentToProgram,
            message.sentToStmt,
            message.sentToModule,
            message.sentToProcedure
          ].some(value => String(value || '').trim().length > 0);
          if (hasFirstLevelContext) {
            const typeValue = String(message.type || '').trim();
            const displayType = typeValue ? (typeValue.startsWith('*') ? typeValue : `*${typeValue}`) : '*UNKNOWN';
            const messageId = String(message.messageId || '—').trim() || '—';
            const severityText = String(message.severity ?? '').trim() || '0';
            const hoverMeta = `${messageId} ${severityText} ${displayType}`;
            const body = document.createElement('div');
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'message-toggle';
            toggle.title = hoverMeta;
            const toggleIcon = text('span', '', 'message-toggle-icon');
            const summaryLine = document.createElement('span');
            summaryLine.className = 'message-toggle-label';
            summaryLine.append(text('span', message.text || ''));
            toggle.append(toggleIcon, summaryLine);
            toggle.classList.toggle('is-expanded', !!message.firstLevelExpanded);
            toggle.setAttribute('aria-expanded', String(!!message.firstLevelExpanded));
            toggle.addEventListener('click', () => {
              message.firstLevelExpanded = !message.firstLevelExpanded;
              toggle.classList.toggle('is-expanded', !!message.firstLevelExpanded);
              toggle.setAttribute('aria-expanded', String(!!message.firstLevelExpanded));
              body.hidden = !message.firstLevelExpanded;
            });
            const makeContextSegment = (label, value) => {
              const segment = document.createElement('span');
              segment.className = 'message-context-segment';
              segment.append(
                text('span', `${label} `, 'message-context-label'),
                text('span', value, 'message-context-value')
              );
              return segment;
            };

            const makeContextLine = segments => {
              const line = document.createElement('div');
              line.className = 'message-context-line';
              segments.forEach((segment, index) => {
                if (index > 0) line.append(text('span', '  ', 'message-context-separator'));
                line.append(makeContextSegment(segment.label, segment.value));
              });
              return line;
            };

            const fromLine1Segments = [{ label: 'From: PGM', value: String(message.sentFromProgram || '-').trim() || '-' }];
            if (String(message.sentFromModule || '').trim()) fromLine1Segments.push({ label: 'MOD', value: String(message.sentFromModule).trim() });
            if (String(message.sentFromStmt || '').trim()) fromLine1Segments.push({ label: 'STMT', value: String(message.sentFromStmt).trim() });

            const fromLine2Segments = [{ label: 'Sent', value: String(message.sentTimestamp || '-').trim() || '-' }];
            if (String(message.sentFromProcedure || '').trim()) fromLine2Segments.push({ label: 'PROC', value: String(message.sentFromProcedure).trim() });

            const toLine1Segments = [{ label: 'To: PGM', value: String(message.sentToProgram || '-').trim() || '-' }];
            if (String(message.sentToModule || '').trim()) toLine1Segments.push({ label: 'MOD', value: String(message.sentToModule).trim() });
            if (String(message.sentToStmt || '').trim()) toLine1Segments.push({ label: 'STMT', value: String(message.sentToStmt).trim() });

            const toLine2Segments = [];
            if (String(message.sentToProcedure || '').trim()) toLine2Segments.push({ label: 'PROC', value: String(message.sentToProcedure).trim() });
            const metaSegments = [
              { label: 'MSGID:', value: messageId },
              { label: 'Sev:', value: severityText },
              { label: 'Type:', value: displayType }
            ];
            body.hidden = !message.firstLevelExpanded;
            body.append(makeContextLine(metaSegments));
            body.append(makeContextLine(fromLine1Segments));
            body.append(makeContextLine(fromLine2Segments));
            body.append(makeContextLine(toLine1Segments));
            if (toLine2Segments.length > 0) body.append(makeContextLine(toLine2Segments));
            item.append(toggle, body);
          } else {
            const line = document.createElement('div');
            line.className = 'message-line';
            line.append(text('span', `${messageMeta} `, 'message-meta'), text('span', message.text || ''));
            item.append(line);
          }
          if (message.secondLevelText) {
            const secondLevelBody = document.createElement('div');
            secondLevelBody.className = 'second-level-container';
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'message-toggle message-summary';
            const toggleIcon = text('span', '', 'message-toggle-icon');
            const summaryText = text('span', 'Second-level text', 'message-summary-text');
            toggle.append(toggleIcon, summaryText);
            toggle.classList.toggle('is-expanded', !!message.expanded);
            toggle.setAttribute('aria-expanded', String(!!message.expanded));
            toggle.addEventListener('click', () => {
              message.expanded = !message.expanded;
              toggle.classList.toggle('is-expanded', !!message.expanded);
              toggle.setAttribute('aria-expanded', String(!!message.expanded));
              secondLevelBody.hidden = !message.expanded;
            });
            secondLevelBody.hidden = !message.expanded;
            secondLevelBody.append(text('div', message.secondLevelText, 'second-level'));
            item.append(toggle, secondLevelBody);
          }
          article.append(item);
        });
      }
      results.append(article);
    });
    if (pinNewest) {
      const newest = results.querySelector('.execution.latest');
      if (newest) {
        requestAnimationFrame(() => {
          results.scrollTop = Math.max(0, newest.offsetTop);
        });
        return;
      }
    }
    results.scrollTop = previousScrollTop;
  }
  const text = (tag, value, className) => { const el = document.createElement(tag); el.textContent = value || ''; if (className) el.className = className; return el; };
  function setRunning(value, startedAt, statusMessage) {
    run.disabled = value; prompt.disabled = value; command.readOnly = value; clearCommand.disabled = value || command.value.length === 0;
    if (severityFilter) severityFilter.disabled = value;
    runningStartedAt = startedAt;
    if (runningTimerId) {
      clearInterval(runningTimerId);
      runningTimerId = undefined;
    }
    if (value) {
      runningStatusPrefix = String(statusMessage || '').trim() || 'Running…';
      setStatusMessage(runningStatusPrefix);
      runningTimerId = setInterval(() => {
        if (!runningStartedAt) {
          if (runningTimerId) {
            clearInterval(runningTimerId);
            runningTimerId = undefined;
          }
          return;
        }
        setStatusMessage(`${runningStatusPrefix} ${formatElapsed(Date.now() - runningStartedAt)}`);
      }, 250);
    }
    else {
      runningStartedAt = undefined;
      runningStatusPrefix = 'Running…';
      setStatusMessage('');
    }
  }
  function requestRun() {
    const normalized = normalizeCommand(command.value);
    if (normalized !== command.value) {
      command.value = normalized;
      resizeCommandInput();
    }
    save();
    vscode.postMessage({ type: 'run', command: normalized, mode: mode.value });
  }
  function requestPrompt() {
    const normalized = normalizeCommand(command.value);
    if (normalized !== command.value) {
      command.value = normalized;
      resizeCommandInput();
    }
    save();
    vscode.postMessage({ type: 'prompt', command: normalized });
  }
  command.value = state.command || '';
  mode.value = state.mode || '*RUN';
  updateModeTooltip();
  if (severityFilter) {
    severityFilter.value = String(state.filterSeverity ?? 0);
  }
  save();
  render();
  updateClearCommandState();
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(entries => {
      if (autoResizing || !entries.length) { return; }
      const height = Math.ceil(entries[0].contentRect.height);
      if (height > 0) {
        rememberCommandHeight(height);
      }
    });
    observer.observe(command);
  }
  resizeCommandInput();
  command.addEventListener('input', () => { historyDraft = ''; historyIndex = -1; save(); updateClearCommandState(); resizeCommandInput(); });
  mode.addEventListener('change', () => { updateModeTooltip(); save(); restoreModeTooltip(); });
  mode.addEventListener('mousedown', () => { updateModeTooltip(); suppressModeTooltip(); });
  mode.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      suppressModeTooltip();
    }
  });
  mode.addEventListener('blur', restoreModeTooltip);
  if (severityFilter) severityFilter.addEventListener('change', () => { save(); render(); });
  command.addEventListener('keydown', event => {
    if (event.key === 'Home' || event.key === 'End') {
      // Prevent browser/page-level scroll behavior so Home/End always acts on the command text area.
      event.preventDefault();
      event.stopPropagation();
      const target = event.key === 'Home' ? 0 : command.value.length;
      command.setSelectionRange(target, target);
      return;
    }
    if (event.key === 'Enter') { event.preventDefault(); requestRun(); return; }
    if (event.key === 'F4' || event.key === 'f4' || event.code === 'F4') {
      event.preventDefault();
      requestPrompt();
      return;
    }
    if (event.key === 'F9' || event.key === 'f9' || event.code === 'F9') {
      event.preventDefault();
      recallPrevious();
      return;
    }
    if (event.key === 'F8' || event.key === 'f8' || event.code === 'F8') {
      event.preventDefault();
      recallNext();
      return;
    }
    if (event.key === 'F10' || event.key === 'f10' || event.code === 'F10') {
      event.preventDefault();
      vscode.postMessage({ type: 'toggleMessageDetails' });
      return;
    }
    if (!(event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
    if (!state.history.length) return;
    const valueLength = command.value.length;
    const selectionStart = Number(command.selectionStart || 0);
    const selectionEnd = Number(command.selectionEnd || 0);
    const hasSelection = selectionStart !== selectionEnd;
    if (event.key === 'ArrowUp' && !hasSelection && selectionStart === 0) {
      event.preventDefault();
      recallPrevious();
      return;
    }
    if (event.key === 'ArrowDown' && !hasSelection && selectionEnd === valueLength) {
      event.preventDefault();
      recallNext();
    }
  });
  run.addEventListener('click', requestRun); prompt.addEventListener('click', requestPrompt); clearCommand.addEventListener('click', clearCommandInput);
  snippets?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeSnippetsMenu();
    vscode.postMessage({ type: 'toggleSnippetsTreeView' });
  });
  snippets?.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    if (snippetsMenuList?.classList.contains('is-open')) {
      closeSnippetsMenu();
      return;
    }
    openSnippetsMenu();
    snippetsMenuManage?.focus();
  });
  snippets?.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openSnippetsMenu();
      snippetsMenuManage?.focus();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSnippetsMenu();
      command.focus();
    }
  });
  cmdEntrySettings?.addEventListener('click', event => {
    event.preventDefault();
    closeToolbarMenu();
    closeSnippetsMenu();
    vscode.postMessage({ type: 'openCmdEntrySettings' });
  });
  toolbarMenu?.addEventListener('click', event => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      openToolbarMenu();
      menuViewLog?.focus();
      return;
    }
    toggleToolbarMenu();
  });
  toolbarMenu?.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
    openToolbarMenu();
    menuViewLog?.focus();
  });
  toolbarMenu?.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openToolbarMenu();
      menuViewLog?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeToolbarMenu();
      command.focus();
    }
  });
  menuViewLog?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'requestHistoryPicker' });
    command.focus();
  });
  menuClearLog?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'clear' });
    command.focus();
  });
  menuClearSqlLog?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'clearSqlHistoryAndMessages' });
    command.focus();
  });
  menuToggleMessageDetails?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'toggleMessageDetails' });
    command.focus();
  });
  menuToggleSqlLog?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'toggleSqlStatementsToCommandLog' });
    command.focus();
  });
  menuStartNewJob?.addEventListener('click', () => {
    if (menuStartNewJob.disabled) {
      return;
    }
    closeToolbarMenu();
    vscode.postMessage({ type: 'startNewJob' });
    command.focus();
  });
  menuCancelSqlJob?.addEventListener('click', () => {
    if (menuCancelSqlJob.disabled) {
      return;
    }
    closeToolbarMenu();
    vscode.postMessage({ type: 'requestCancelSqlJob' });
    command.focus();
  });
  menuClearHistory?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'clearHistoryAndMessages' });
    command.focus();
  });
  snippetsMenuManage?.addEventListener('click', () => {
    closeSnippetsMenu();
    vscode.postMessage({ type: 'manageCodeSnippets' });
    command.focus();
  });
  snippetsMenuToggle?.addEventListener('click', () => {
    closeSnippetsMenu();
    vscode.postMessage({ type: 'toggleSnippetsTreeView' });
    command.focus();
  });
  snippetsMenuRefresh?.addEventListener('click', () => {
    closeSnippetsMenu();
    vscode.postMessage({ type: 'refreshCodeSnippets' });
    command.focus();
  });
  snippetsMenuImport?.addEventListener('click', () => {
    closeSnippetsMenu();
    vscode.postMessage({ type: 'importCodeSnippets' });
    command.focus();
  });
  snippetsMenuExport?.addEventListener('click', () => {
    closeSnippetsMenu();
    vscode.postMessage({ type: 'exportCodeSnippets' });
    command.focus();
  });
  snippetsMenuAdd?.addEventListener('click', () => {
    closeSnippetsMenu();
    vscode.postMessage({ type: 'addCodeSnippet' });
    command.focus();
  });
  toolbarMenuList?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeToolbarMenu();
      toolbarMenu?.focus();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    const menuItems = [menuViewLog, menuClearLog, menuClearSqlLog, menuClearHistory, menuToggleSqlLog, menuToggleMessageDetails, menuStartNewJob, menuCancelSqlJob]
      .filter(item => item && !item.disabled);
    if (!menuItems.length) { return; }
    event.preventDefault();
    const currentIndex = menuItems.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      const nextIndex = (currentIndex + 1 + menuItems.length) % menuItems.length;
      menuItems[nextIndex].focus();
      return;
    }
    const prevIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
    menuItems[prevIndex].focus();
  });
  snippetsMenuList?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSnippetsMenu();
      snippets?.focus();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    const menuItems = [snippetsMenuManage, snippetsMenuToggle, snippetsMenuRefresh, snippetsMenuImport, snippetsMenuExport, snippetsMenuAdd]
      .filter(item => item && !item.disabled);
    if (!menuItems.length) { return; }
    event.preventDefault();
    const currentIndex = menuItems.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      const nextIndex = (currentIndex + 1 + menuItems.length) % menuItems.length;
      menuItems[nextIndex].focus();
      return;
    }
    const prevIndex = (currentIndex - 1 + menuItems.length) % menuItems.length;
    menuItems[prevIndex].focus();
  });
  document.addEventListener('click', event => {
    const target = event.target;
    if (!(target instanceof Node)) {
      closeToolbarMenu();
      closeStatusJobMenu();
      return;
    }

    if (toolbarMenuList?.classList.contains('is-open')) {
      if (!(toolbarMenu?.contains(target) || toolbarMenuList.contains(target))) {
        closeToolbarMenu();
      }
    }

    if (snippetsMenuList?.classList.contains('is-open')) {
      if (!(snippets?.contains(target) || snippetsMenuList.contains(target))) {
        closeSnippetsMenu();
      }
    }

    if (statusJobMenu?.classList.contains('is-open')) {
      if (!(statusJobId?.contains(target) || statusJobMenu.contains(target))) {
        closeStatusJobMenu();
      }
    }
  });
  command.addEventListener('focus', () => {
    closeToolbarMenu();
    closeSnippetsMenu();
    closeStatusJobMenu();
  });
  window.addEventListener('resize', repositionToolbarMenuIfOpen);
  window.addEventListener('resize', repositionSnippetsMenuIfOpen);
  window.addEventListener('resize', closeStatusJobMenu);
  window.addEventListener('blur', () => {
    closeToolbarMenu();
    closeSnippetsMenu();
    closeStatusJobMenu();
  });
  historyPrev?.addEventListener('click', event => {
    event.preventDefault();
    recallPrevious();
    command.focus();
  });
  historyNext?.addEventListener('click', event => {
    event.preventDefault();
    recallNext();
    command.focus();
  });
  historyPrev?.addEventListener('contextmenu', event => {
    event.preventDefault();
  });
  historyNext?.addEventListener('contextmenu', event => {
    event.preventDefault();
  });
  statusJobId?.addEventListener('click', event => {
    event.preventDefault();
    if (statusJobSingleClickTimer) {
      clearTimeout(statusJobSingleClickTimer);
      statusJobSingleClickTimer = undefined;
    }
    // Delay single-click copy so double-click can override it.
    statusJobSingleClickTimer = setTimeout(() => {
      statusJobSingleClickTimer = undefined;
      selectEntireStatusJobId();
      copyStatusJobId();
    }, 220);
  });
  statusJobId?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      copyStatusJobId();
    }
  });
  statusJobId?.addEventListener('dblclick', event => {
    event.preventDefault();
    if (statusJobSingleClickTimer) {
      clearTimeout(statusJobSingleClickTimer);
      statusJobSingleClickTimer = undefined;
    }
    selectEntireStatusJobId();
    displayStatusJoblog();
  });
  statusJobId?.addEventListener('contextmenu', event => {
    const sqlJobId = statusJobId.textContent?.trim();
    if (!sqlJobId || sqlJobId.toLowerCase() === noConnectionText) { return; }
    event.preventDefault();
    openStatusJobMenu(event.clientX, event.clientY, sqlJobId);
  });
  statusJobMenuCopy?.addEventListener('click', () => {
    const sqlJobId = statusJobMenu?.getAttribute('data-jobid') || '';
    if (!sqlJobId) { return; }
    closeStatusJobMenu();
    vscode.postMessage({ type: 'copySqlJobId', sqlJobId });
  });
  statusJobMenuDisplayJoblog?.addEventListener('click', () => {
    const sqlJobId = statusJobMenu?.getAttribute('data-jobid') || '';
    if (!sqlJobId) { return; }
    closeStatusJobMenu();
    vscode.postMessage({ type: 'requestDisplayJoblog', sqlJobId });
  });
  statusJobMenu?.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeStatusJobMenu();
      statusJobId?.focus();
      return;
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }

    const items = [statusJobMenuCopy, statusJobMenuDisplayJoblog].filter(item => item && !item.disabled);
    if (!items.length) { return; }
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      const nextIndex = (currentIndex + 1 + items.length) % items.length;
      items[nextIndex].focus();
      return;
    }
    const prevIndex = (currentIndex - 1 + items.length) % items.length;
    items[prevIndex].focus();
  });
  window.addEventListener('message', event => {
    const message = event.data; switch (message.type) {
      case 'initialize':
        state.history = message.history || [];
        if (message.clearHistoryOnStartup) {
          state.executions = [];
          historyDraft = '';
          historyIndex = -1;
          save();
        }
        messageDetailsMode = String(message.messageDetailsMode || 'SHOW').toUpperCase() === 'HIDE' ? 'HIDE' : 'SHOW';
        logSqlStatementsToCommandLog = !!message.logSqlStatementsToCommandLog;
        applyMessageDetailsMode();
        applyAppearancePreferences(message.commandTextColor);
        dedicatedJobEnabled = !!message.dedicatedJobEnabled;
        remoteMapepireEnabled = !!message.remoteMapepireEnabled;
        canStartNewJob = typeof message.canStartNewJob === 'boolean'
          ? !!message.canStartNewJob
          : (dedicatedJobEnabled && remoteMapepireEnabled);
        canCancelSqlJob = typeof message.canCancelSqlJob === 'boolean'
          ? !!message.canCancelSqlJob
          : (dedicatedJobEnabled && remoteMapepireEnabled);
        updateMenuCapabilities();
        updateSqlLoggingMenuLabel();
        if (message.clearInputOnStartup) {
          command.value = '';
          historyDraft = '';
          historyIndex = -1;
          save();
          updateClearCommandState();
          resizeCommandInput();
        }
        setStatusJobId(message.sqlJobId || '');
        if (message.running) { setRunning(true, Date.now(), message.statusMessage); }
        render();
        results.scrollTop = 0;
        startSqlJobPollingIfNeeded();
        break;
      case 'running':
        setStatusJobId(message.sqlJobId || '');
        setRunning(message.running, message.startedAt, message.statusMessage);
        startSqlJobPollingIfNeeded();
        break;
      case 'sqlJobId':
        setStatusJobId(message.sqlJobId || '');
        startSqlJobPollingIfNeeded();
        break;
      case 'jobCapabilities':
        dedicatedJobEnabled = !!message.dedicatedJobEnabled;
        remoteMapepireEnabled = !!message.remoteMapepireEnabled;
        canStartNewJob = !!message.canStartNewJob;
        canCancelSqlJob = !!message.canCancelSqlJob;
        updateMenuCapabilities();
        break;
      case 'messageDetailsPreference':
        messageDetailsMode = String(message.mode || 'SHOW').toUpperCase() === 'HIDE' ? 'HIDE' : 'SHOW';
        applyMessageDetailsMode();
        save();
        render();
        updateMessageDetailsMenuLabel();
        break;
      case 'sqlLoggingPreference':
        logSqlStatementsToCommandLog = !!message.logSqlStatementsToCommandLog;
        updateSqlLoggingMenuLabel();
        break;
      case 'appearancePreferences':
        applyAppearancePreferences(message.commandTextColor);
        break;
      case 'sqlFetchLimitStatus': {
        // Legacy event retained for compatibility; fetch-limit info is no longer shown in status text.
        break;
      }
      case 'clearSqlResults':
        state.executions = (state.executions || []).filter(execution => !isSqlCommandText(execution.command));
        save();
        render();
        break;
      case 'execution': {
        const shouldAddToCommandEntryLog = message.addToCommandEntryLog !== false;
        if (shouldAddToCommandEntryLog) {
          state.executions = [{ ...message.execution, messages: (message.execution.messages || []).slice(0, maxMessages) }, ...(state.executions || [])].slice(0, maxExecutions);
          applyMessageDetailsMode();
        }
        if (message.addToHistory !== false) {
          const executionIsSql = !!message.execution.sqlResult
            || (message.execution.messages || []).some(entry => String(entry.messageId || '').trim().toUpperCase() === 'SQL0000');
          const recalledCommand = applySqlPrefixForRecall(message.execution.command, executionIsSql);
          state.history = [{ command: recalledCommand, mode: message.execution.mode, isSql: executionIsSql }, ...state.history.filter(item => item.command !== recalledCommand || item.mode !== message.execution.mode)].slice(0, 100);
        }
        command.value = '';
        historyDraft = '';
        historyIndex = -1;
        save();
        updateClearCommandState();
        resizeCommandInput();
        if (shouldAddToCommandEntryLog) {
          render({ pinNewest: true });
        }
        break;
      }
      case 'historyUpdated': state.history = message.history || []; historyDraft = ''; historyIndex = -1; save(); break; case 'setCommand': command.value = message.command; save(); updateClearCommandState(); resizeCommandInput(); command.focus(); break; case 'setCommandMode': command.value = message.command; mode.value = message.mode || mode.value; updateModeTooltip(); save(); updateClearCommandState(); resizeCommandInput(); command.focus(); break; case 'clearResults': state.executions = []; save(); render(); break; case 'focusInput': command.focus(); break; case 'runCurrent': requestRun(); break; case 'promptCurrent': requestPrompt(); break; case 'notice': setStatusMessage(message.message); break;
    }
  });
  results.addEventListener('scroll', hideHistoryHoverTooltip, { passive: true });
  window.addEventListener('resize', hideHistoryHoverTooltip);
  window.addEventListener('beforeunload', () => {
    hideHistoryHoverTooltip();
    if (runningTimerId) {
      clearInterval(runningTimerId);
      runningTimerId = undefined;
    }
    stopSqlJobPolling();
  });
  vscode.postMessage({ type: 'ready' });
})();
