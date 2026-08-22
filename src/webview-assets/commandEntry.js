(() => {
  const state = vscode.getState() || { command: '', mode: '*RUN', filterSeverity: 0, history: [], executions: [] };
  const maxExecutions = 30, maxMessages = 100;
  const noConnectionText = 'no connection';
  const command = document.getElementById('command'), mode = document.getElementById('mode'), severityFilter = document.getElementById('message-severity-filter');
  const run = document.getElementById('run'), prompt = document.getElementById('prompt'), clear = document.getElementById('clear'), clearCommand = document.getElementById('clear-command'), goToTop = document.getElementById('go-to-top'), goToBottom = document.getElementById('go-to-bottom');
  const statusText = document.getElementById('status-text'), statusJobId = document.getElementById('status-jobid'), results = document.getElementById('results');
  let historyIndex = -1, runningStartedAt, runningTimerId, historyDraft = '', sqlJobPollingId;
  const save = () => {
    state.command = command.value;
    state.mode = mode.value;
    state.filterSeverity = Number(severityFilter?.value || 0);
    state.history = state.history || [];
    state.executions = state.executions || [];
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
    mode.title = help;
    mode.setAttribute('aria-description', help);
  };
  const updateClearCommandState = () => {
    clearCommand.disabled = command.value.length === 0;
  };
  const clearCommandInput = () => {
    command.value = '';
    historyDraft = '';
    historyIndex = -1;
    save();
    updateClearCommandState();
    command.focus();
  };
  const applyHistoryEntry = (index) => {
    if (index < 0) {
      command.value = historyDraft;
      mode.value = state.mode || '*RUN';
      updateModeTooltip();
      save();
      updateClearCommandState();
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
    const end = command.value.length;
    command.setSelectionRange(end, end);
    command.focus();
  };
  function render() {
    const previousScrollTop = results.scrollTop;
    results.replaceChildren();
    const minSeverity = Number(state.filterSeverity || 0);
    state.executions.forEach((execution, index) => {
      const isLatest = index === state.executions.length - 1;
      const article = document.createElement('article');
      article.className = `execution${isLatest ? ' latest' : ''}`;
      if (execution.collapsed) { article.classList.add('collapsed'); }
      const header = document.createElement('header');
      const meta = `${new Date(execution.startedAt).toLocaleString()} · ${execution.mode} · ${formatElapsed(execution.elapsedMs)}`;
      const replayMarker = text('span', execution.collapsed ? '▶' : '▼', 'execution-replay');
      replayMarker.title = 'Click=Fold/Expand, Double-Click=Copy';
      replayMarker.tabIndex = 0;
      const commandEl = text('strong', execution.command, 'execution-command');
      commandEl.title = 'Click=Recall, Double-Click=Copy';
      commandEl.tabIndex = 0;
      let clickTimer;
      const singleClickDelayMs = 350;
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
        render();
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
    save();
    vscode.postMessage({ type: 'run', command: command.value, mode: mode.value });
  }
  function requestPrompt() { save(); vscode.postMessage({ type: 'prompt', command: command.value }); }
  command.value = state.command || '';
  mode.value = state.mode || '*RUN';
  updateModeTooltip();
  if (severityFilter) {
    severityFilter.value = String(state.filterSeverity ?? 0);
  }
  save();
  render();
  updateClearCommandState();
  command.addEventListener('input', () => { historyDraft = ''; historyIndex = -1; save(); updateClearCommandState(); }); mode.addEventListener('change', () => { updateModeTooltip(); save(); }); mode.addEventListener('mousedown', updateModeTooltip); if (severityFilter) severityFilter.addEventListener('change', () => { save(); render(); });
  command.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); requestRun(); return; }
    if (event.key === 'F4' || event.key === 'f4' || event.code === 'F4') {
      event.preventDefault();
      requestPrompt();
      return;
    }
    if (!(event.key === 'ArrowUp' || event.key === 'ArrowDown')) return;
    if (!state.history.length) return;
    event.preventDefault();
    if (historyIndex === -1 && event.key === 'ArrowUp') {
      historyDraft = command.value;
    }
    if (event.key === 'ArrowUp') {
      if (historyIndex < state.history.length - 1) {
        historyIndex += 1;
        applyHistoryEntry(historyIndex);
      }
      return;
    }
    if (historyIndex > -1) {
      historyIndex -= 1;
    }
    applyHistoryEntry(historyIndex);
  });
  run.addEventListener('click', requestRun); prompt.addEventListener('click', requestPrompt); clear.addEventListener('click', () => vscode.postMessage({ type: 'clear' })); clearCommand.addEventListener('click', clearCommandInput);
  goToTop?.addEventListener('click', () => { results.scrollTop = 0; });
  goToBottom?.addEventListener('click', () => { results.scrollTop = results.scrollHeight; });
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
        setStatusJobId(message.sqlJobId || '');
        if (message.running) { setRunning(true, Date.now()); }
        render();
        results.scrollTop = results.scrollHeight;
        startSqlJobPollingIfNeeded();
        break;
      case 'running':
        setStatusJobId(message.sqlJobId || '');
        setRunning(message.running, message.startedAt);
        startSqlJobPollingIfNeeded();
        break;
      case 'sqlJobId':
        setStatusJobId(message.sqlJobId || '');
        startSqlJobPollingIfNeeded();
        break;
      case 'cancelRequested': setStatusMessage('Cancel requested… IBM i may ignore this when no interruptible SQL statement is active.'); break; case 'cancelAccepted': setStatusJobId(message.sqlJobId || ''); setStatusMessage(`Cancel requested for job ${message.sqlJobId}. Waiting for IBM i to complete the original request.`); break; case 'cancelFailed': setStatusMessage(message.message); break; case 'execution': {
        state.executions = [...(state.executions || []), { ...message.execution, messages: (message.execution.messages || []).slice(0, maxMessages) }].slice(-maxExecutions);
        state.history = [{ command: message.execution.command, mode: message.execution.mode }, ...state.history.filter(item => item.command !== message.execution.command || item.mode !== message.execution.mode)].slice(0, 100);
        command.value = '';
        historyDraft = '';
        historyIndex = -1;
        save();
        updateClearCommandState();
        render();
        results.lastElementChild?.scrollIntoView({ block: 'nearest' });
        break;
      }
      case 'setCommand': command.value = message.command; save(); updateClearCommandState(); command.focus(); break; case 'clearResults': state.executions = []; save(); render(); break; case 'focusInput': command.focus(); break; case 'runCurrent': requestRun(); break; case 'promptCurrent': requestPrompt(); break; case 'notice': setStatusMessage(message.message); break;
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
