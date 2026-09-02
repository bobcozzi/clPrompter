(() => {
  const state = vscode.getState() || { command: '', mode: '*RUN', filterSeverity: 0, history: [], executions: [], commandHeightPx: 0 };
  const maxExecutions = 30, maxMessages = 100;
  const noConnectionText = 'no connection';
  const minTextareaRows = 2;
  const command = document.getElementById('command'), mode = document.getElementById('mode'), severityFilter = document.getElementById('message-severity-filter');
  const run = document.getElementById('run'), prompt = document.getElementById('prompt'), clearCommand = document.getElementById('clear-command'), toolbarMenu = document.getElementById('toolbar-menu'), toolbarMenuList = document.getElementById('toolbar-menu-list'), menuViewLog = document.getElementById('menu-view-log'), menuClearLog = document.getElementById('menu-clear-log'), menuStartNewJob = document.getElementById('menu-start-new-job'), historyPrev = document.getElementById('history-prev'), historyNext = document.getElementById('history-next');
  const statusText = document.getElementById('status-text'), statusJobId = document.getElementById('status-jobid'), results = document.getElementById('results');
  let historyIndex = -1, runningStartedAt, runningTimerId, historyDraft = '', sqlJobPollingId;
  let showStartupFetchLimitStatus = true;
  let baseMinHeightPx = 0, autoResizing = false;
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
  const startupFetchLimitStatus = (value = '') => {
    const normalized = String(value || '').trim();
    if (!normalized) { return ''; }
    return normalized;
  };
  const hasRealSqlJobId = () => {
    const value = statusJobId.textContent?.trim().toLowerCase();
    return !!value && value !== noConnectionText;
  };
  const setStatusJobId = (sqlJobId = '') => {
    const normalized = String(sqlJobId || '').trim();
    const isConnected = normalized.length > 0;
    const statusJobLabel = isConnected
      ? 'SQL job ID. Click to select, double-click to copy.'
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
  const selectStatusJobId = () => {
    if (!hasRealSqlJobId()) { return; }
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
  if (toolbarMenuList) {
    toolbarMenuList.classList.remove('is-open');
    toolbarMenuList.setAttribute('aria-hidden', 'true');
  }
  const closeToolbarMenu = () => {
    if (!toolbarMenuList || !toolbarMenu) { return; }
    toolbarMenuList.classList.remove('is-open');
    toolbarMenuList.setAttribute('aria-hidden', 'true');
    toolbarMenu.setAttribute('aria-expanded', 'false');
  };
  const openToolbarMenu = () => {
    if (!toolbarMenuList || !toolbarMenu) { return; }
    toolbarMenuList.classList.add('is-open');
    toolbarMenuList.setAttribute('aria-hidden', 'false');
    toolbarMenu.setAttribute('aria-expanded', 'true');
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
      const end = command.value.length;
      command.setSelectionRange(end, end);
      return;
    }
    const item = state.history[index];
    if (!item) { return; }
    command.value = item.command;
    mode.value = item.mode;
    updateModeTooltip();
    save();
    updateClearCommandState();
    resizeCommandInput();
    const end = command.value.length;
    command.setSelectionRange(end, end);
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
      replayMarker.setAttribute('data-tooltip', 'Click=Fold/Expand, Double-Click=Copy');
      replayMarker.tabIndex = 0;
      const commandEl = text('strong', execution.command, 'execution-command');
      commandEl.setAttribute('data-tooltip', 'Click=Recall, Double-Click=Copy');
      commandEl.tabIndex = 0;
      let clickTimer;
      const singleClickDelayMs = 140;
      const reuseCommand = () => {
        command.value = execution.command;
        mode.value = execution.mode;
        save();
        updateClearCommandState();
        setStatusMessage('Loaded command from history. Edit and run when ready.');
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
            const body = document.createElement('div');
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'message-toggle';
            const toggleIcon = text('span', '', 'message-toggle-icon');
            const summaryLine = document.createElement('span');
            summaryLine.className = 'message-toggle-label';
            summaryLine.append(text('span', `${messageMeta} `, 'message-meta'), text('span', message.text || ''));
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
            body.hidden = !message.firstLevelExpanded;
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
  function setRunning(value, startedAt) {
    run.disabled = value; prompt.disabled = value; command.readOnly = value; clearCommand.disabled = value || command.value.length === 0;
    if (severityFilter) severityFilter.disabled = value;
    runningStartedAt = startedAt;
    if (runningTimerId) {
      clearInterval(runningTimerId);
      runningTimerId = undefined;
    }
    if (value) {
      setStatusMessage('Running…');
      runningTimerId = setInterval(() => {
        if (!runningStartedAt) {
          if (runningTimerId) {
            clearInterval(runningTimerId);
            runningTimerId = undefined;
          }
          return;
        }
        setStatusMessage(`Running… ${formatElapsed(Date.now() - runningStartedAt)}`);
      }, 250);
    }
    else {
      runningStartedAt = undefined;
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
    if (event.key === 'F10' || event.key === 'f10' || event.code === 'F10') {
      event.preventDefault();
      recallNext();
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
  toolbarMenu?.addEventListener('click', event => {
    event.preventDefault();
    toggleToolbarMenu();
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
  menuStartNewJob?.addEventListener('click', () => {
    closeToolbarMenu();
    vscode.postMessage({ type: 'startNewJob' });
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

    const menuItems = [menuViewLog, menuClearLog, menuStartNewJob].filter(Boolean);
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
    if (!toolbarMenuList || !toolbarMenu) { return; }
    if (!toolbarMenuList.classList.contains('is-open')) { return; }
    const target = event.target;
    if (!(target instanceof Node)) {
      closeToolbarMenu();
      return;
    }
    if (toolbarMenu.contains(target) || toolbarMenuList.contains(target)) {
      return;
    }
    closeToolbarMenu();
  });
  command.addEventListener('focus', () => {
    closeToolbarMenu();
  });
  window.addEventListener('blur', closeToolbarMenu);
  historyPrev?.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      vscode.postMessage({ type: 'requestHistoryPicker' });
      return;
    }
    recallPrevious();
    command.focus();
  });
  historyNext?.addEventListener('click', event => {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      vscode.postMessage({ type: 'requestHistoryPicker' });
      return;
    }
    recallNext();
    command.focus();
  });
  statusJobId?.addEventListener('click', selectStatusJobId);
  statusJobId?.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectStatusJobId();
    }
  });
  statusJobId?.addEventListener('dblclick', event => {
    event.preventDefault();
    const sqlJobId = statusJobId.textContent?.trim();
    if (!sqlJobId || sqlJobId.toLowerCase() === noConnectionText) { return; }
    vscode.postMessage({ type: 'copySqlJobId', sqlJobId });
  });
  window.addEventListener('message', event => {
    const message = event.data; switch (message.type) {
      case 'initialize':
        state.history = message.history || [];
        if (message.clearInputOnStartup) {
          command.value = '';
          historyDraft = '';
          historyIndex = -1;
          save();
          updateClearCommandState();
          resizeCommandInput();
        }
        setStatusJobId(message.sqlJobId || '');
        if (message.running) { setRunning(true, Date.now()); }
        if (showStartupFetchLimitStatus) {
          const startupStatus = startupFetchLimitStatus(message.sqlFetchLimitDisplay);
          if (startupStatus) {
            setStatusMessage(startupStatus);
          }
        }
        render();
        results.scrollTop = 0;
        startSqlJobPollingIfNeeded();
        break;
      case 'running':
        if (message.running) {
          showStartupFetchLimitStatus = false;
        }
        setStatusJobId(message.sqlJobId || '');
        setRunning(message.running, message.startedAt);
        startSqlJobPollingIfNeeded();
        break;
      case 'sqlJobId':
        setStatusJobId(message.sqlJobId || '');
        startSqlJobPollingIfNeeded();
        break;
      case 'sqlFetchLimitStatus': {
        const status = startupFetchLimitStatus(message.sqlFetchLimitDisplay);
        if (status) {
          setStatusMessage(status);
        }
        break;
      }
      case 'cancelRequested': setStatusMessage('Cancel requested… IBM i may ignore this when no interruptible SQL statement is active.'); break; case 'cancelAccepted': setStatusJobId(message.sqlJobId || ''); setStatusMessage(`Cancel requested for job ${message.sqlJobId}. Waiting for IBM i to complete the original request.`); break; case 'cancelFailed': setStatusMessage(message.message); break; case 'execution': {
        state.executions = [{ ...message.execution, messages: (message.execution.messages || []).slice(0, maxMessages) }, ...(state.executions || [])].slice(0, maxExecutions);
        state.history = [{ command: message.execution.command, mode: message.execution.mode }, ...state.history.filter(item => item.command !== message.execution.command || item.mode !== message.execution.mode)].slice(0, 100);
        command.value = '';
        historyDraft = '';
        historyIndex = -1;
        save();
        updateClearCommandState();
        resizeCommandInput();
        render({ pinNewest: true });
        break;
      }
      case 'setCommand': command.value = message.command; save(); updateClearCommandState(); resizeCommandInput(); command.focus(); break; case 'setCommandMode': command.value = message.command; mode.value = message.mode || mode.value; updateModeTooltip(); save(); updateClearCommandState(); resizeCommandInput(); command.focus(); break; case 'clearResults': state.executions = []; save(); render(); break; case 'focusInput': command.focus(); break; case 'runCurrent': requestRun(); break; case 'promptCurrent': requestPrompt(); break; case 'notice': setStatusMessage(message.message); break;
    }
  });
  window.addEventListener('beforeunload', () => {
    if (runningTimerId) {
      clearInterval(runningTimerId);
      runningTimerId = undefined;
    }
    stopSqlJobPolling();
  });
  vscode.postMessage({ type: 'ready' });
})();
