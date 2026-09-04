# CL Command Entry Panel (Tester Guide)

## Purpose

This document is a standalone guide for User testing of the CL Command Entry panel in the CLPROMPTER VSCODE extension.

The panel is designed for fast, editor-side execution of non-interactive CL commands or SQL statements against a IBM i host connection, with detailed resulting feedback.

## Recalled Prior Chat State (Sep 2, 2026)

From the prior-day "recovered previous chat state" thread, the key baseline was:

- Command Entry SQL/log UX updates were active and validated.
- Message-details collapse/expand behavior had been revised to operate at command-row level.
- SQL session stale/close behavior was patched to avoid misleading fetch status after session invalidation.
- Dedicated SQL job behavior and server-mode dependency were clarified and tested.
- Terminology and help text were refreshed to use "rows per fetch" language.

## What The Panel Is

CL Command Entry is a side-panel workspace for:

- Running non-interactive CL commands such as `CPYF`, `CHGJOB`, etc.
- Prompting command strings using the CL prompter (`F4` or `Prompt`).
- Running SQL statements by prefixing the input with `SQL:`.

It is not intended to emulate full interactive 5250 command screens.

## How To Open/Close It

You can configure auto-show timing with setting `clPrompter.showCLCommandEntry`:

- `At Start Up`
- `After IBM i Connection`
- `No`

Manual commands from Command Palette:

- `CLPROMPTER: Open CL Command Entry`
- `CLPROMPTER: Close CL Command Entry`

## Core UI Behavior

- Input area supports single/multi-line command text.
- `Run` executes current input.
- `Prompt` opens CL prompter for current command text.
- `SEV` filter controls minimum message severity shown.
- Run mode selector:
  - `Run` (`*RUN`)
  - `Limit` (`*LIMIT`)
  - `Check` (`*CHECK`)

History behavior:

- `ArrowUp`/`ArrowDown` for quick recall.
- `F9` retrieves prior command (same direction as arrow up).
- `F8` retrieves next command (same direction as arrow down).
- `F10` toggles message-details expand/collapse (same behavior as menu option).
- Right-click on history arrows opens full history picker.
- History is persisted via extension global state and deduplicated by command+mode.

## SQL Support (Current)

### Entering SQL

Use `SQL:` prefix in Command Entry input, for example:

```text
SQL: SELECT * FROM QSYS2.JOBLOG_INFO FETCH FIRST 25 ROWS ONLY
```

If a user omits the `SQL:` prefix, Command Entry also treats the input as SQL when the first word is `SELECT` or `VALUES`.

### Code Snippets Button

- The `Code Snippets` toolbar button opens a picker containing built-in and user-defined Code Snippets.
- Code Snippets can be CL commands or SQL statements.
- Selecting a Code Snippet runs it immediately.
- Code Snippets support variable substitution:
  - `${sqlJobId}`
  - `${sqlJobName}`
  - `${sqlJobNumber}`
  - `${currentUser}`
  - `${currentLibrary}`
- Picker includes:
  - `Add more...` to open the Code Snippet manager in create mode
  - `Manage Code Snippets...` to open Add/Edit/Delete/Reorder UI
  - `Import Code Snippets...` to load JSON into your VS Code environment
  - `Export Code Snippets...` to save user Code Snippets as JSON
- Import options:
  - `Merge`
  - `Replace All`
  - `Add New Only`

### Result Handling

- SQL results render in the SQL Results panel.
- Large results use incremental retrieval when enabled.
- Panel supports background prefetch and manual "Load more rows".
- Result status text uses IBM i centric "rows per fetch" terminology.

### Fetch Settings

- `clPrompter.commandEntrySqlFetchLimitEnabled` (default `true`)
  - `true`: incremental loading behavior
  - `false`: equivalent to `*NOMAX` (fetch all rows on run)

- `clPrompter.commandEntrySqlFetchLimitRows` (default `1000`)
  - Maximum rows fetched per request

- `clPrompter.commandEntrySqlPrefetchRows` (default `200`)
  - Initial/background prefetch target before manual load-more is needed

## Dedicated SQL Job Mode

Setting:

- `clPrompter.commandEntryUseDedicatedJob` (default `false`)

Behavior:

- When `true`, Command Entry attempts to use a CLPROMPTER-owned SQL job (instead of sharing the main Code for IBM i SQL job).
- Dedicated mode requires Code for IBM i remote Mapepire Server mode (`mapepireUseServer`) to be enabled.
- If server mode is not available, UI messaging indicates the limitation and shared-path behavior/fallback applies.

Operational menu items related to dedicated mode:

- `Reconnect Server Job`
- `Cancel Last SQL stmt`

## Command Menu ("...")

Current menu options include:

- `View CL Cmd History`
- `Clear CL messages`
- `Clear SQL History Log`
- `Clear CL Cmd History`
- `Collapse Message Details` / `Expand Message Details`
- `Reconnect Server Job`
- `Cancel Last SQL stmt`

Important update:

- Message-details preference now controls command-row reveal/collapse behavior (execution-level collapse).
- If a command row is collapsed, nested message details are naturally hidden.

Setting used:

- `clPrompter.commandEntryMessageDetails`
  - `SHOW` (default expanded command rows)
  - `HIDE` (default collapsed command rows)

## SQL Job ID Status Field

The status field on the right supports:

- Single-click: selects/copies the full job ID
- Double-click: opens Display Joblog action
- Right-click context menu:
  - `Copy job name`
  - `Display Joblog`

## Expected Limitations

- Interactive CL commands are not supported in this panel.
  - Example classes: commands requiring 5250 interactive display flows.
- Prompting does not auto-run.
  - After prompt returns command text, user must explicitly Run/Enter.
- SQL cancel is best-effort and depends on host-side interruptibility/state.

## Tester Checklist

### A. Basic CL Execution

1. Open Command Entry panel.
2. Run a known non-interactive CL command.
3. Confirm outcome, elapsed time, and message rows display correctly.

### B. Prompt Integration

1. Enter partial CL command.
2. Use `Prompt` or `F4`.
3. Return command to input and verify it does not auto-run.
4. Run manually and verify output.

### C. SQL Path

1. Enter `SQL: SELECT ...` statement.
2. Verify SQL Results panel opens and rows render.
3. Validate fetch behavior with defaults (`rows/fetch` + prefetch).
4. Change fetch settings and retest `Load more rows` behavior.
5. Use `Clear SQL History Log` and confirm only SQL entries are removed from results/history while CL entries remain.
6. Run at least one built-in SQL snippet and one user-defined snippet.
7. Verify variable substitution by using a snippet with `${sqlJobId}` or `${currentUser}`.

### D. Message Details Preference

1. Toggle `Collapse/Expand Message Details` from menu.
2. Run command(s) and verify command rows default to expanded/collapsed accordingly.

### E. Dedicated Mode / Server Mode Matrix

1. `commandEntryUseDedicatedJob=false`:
   - Validate normal execution using shared path.
2. `commandEntryUseDedicatedJob=true` and `mapepireUseServer=false`:
   - Validate limitation messaging.
3. `commandEntryUseDedicatedJob=true` and `mapepireUseServer=true`:
   - Validate dedicated job ID behavior.
   - Test `Reconnect Server Job`.
   - Test `Cancel Last SQL stmt` (best-effort).

### F. Job ID Interactions

1. Single-click SQL job ID and confirm full value selection/copy behavior.
2. Double-click SQL job ID and confirm Display Joblog action.
3. Right-click SQL job ID and verify context menu actions.

## Suggested Smoke SQL Statements

```sql
SELECT CURRENT SERVER AS SERVER_NAME, CURRENT USER AS USER_NAME
FROM SYSIBM.SYSDUMMY1
```

```sql
SELECT JOB_NAME, MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TEXT
FROM TABLE(QSYS2.JOBLOG_INFO('*'))
FETCH FIRST 50 ROWS ONLY
```

## Notes For Test Reporting

When reporting an issue, include:

- Exact command/SQL text used
- `commandEntryUseDedicatedJob` setting value
- Whether Code for IBM i Mapepire Server mode is enabled
- Any `...` menu action used just before the issue
- Screenshot of panel status text and SQL job ID (if visible)
