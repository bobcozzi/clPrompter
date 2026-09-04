# CL Command Entry Panel (Tester Guide)

## Purpose

This guide explains how to test CL Command Entry in plain terms.

CL Command Entry lets you run non-interactive CL commands and SQL statements from a VS Code side panel and review results quickly.

## What It Is (and Is Not)

Use it for:

- Running CL commands such as `CPYF`, `CHGJOB`, and similar non-interactive commands.
- Prompting a command with `F4` or the `Prompt` button.
- Running SQL statements and viewing SQL results.

Do not use it for:

- Commands that require an interactive 5250 screen.

## Open and Close

In **VS Code Settings** (`Ctrl+,` or `Cmd+,`) search for `clPrompter` or specifically the `clPrompter.cmdEntryShow` entry. Then adjust when you'd like to have the Command Entry panel appear.

This setting controls when the CL Command Entry panel opens automatically:

- `At Start Up`
- `After IBM i Connection`
- `No` (on demand only)

Command Palette entries:

- `CLPROMPTER: Open CL Command Entry`
- `CLPROMPTER: Close CL Command Entry`

## Core Behavior

- `Run` runs the current command text.
- `Prompt` opens CL prompt support for the current command text.
- `SEV` filters messages by minimum severity.
- Modes:
  - `Run` runs the CL or SQL Command
  - `Limit` runs the CL command as a Limited User
  - `Check` Syntax checks the CL command
- Note that SQL statements are only supported in `Run` mode.

History and keyboard:

- `ArrowUp` / `F9`: previous command
- `ArrowDown` / `F8`: next command
- `F10`: toggle message section collapse/expand default
- Right-click history arrows: open full CL history picker

## SQL Behavior

You can run SQL in two ways:

- Prefix with `SQL:`
- Start directly with `SELECT` or `VALUES` (auto-detected as SQL)

Example:

```text
SQL: SELECT * FROM QSYS2.JOBLOG_INFO FETCH FIRST 25 ROWS ONLY
```

SQL results open in the SQL Results panel.

## SQL Fetch Settings

- `clPrompter.cmdEntryLimitSqlFetch` (default `true`)
  - `true`: load rows incrementally
  - `false`: equivalent to `*NOMAX` (fetch all rows on run)
- `clPrompter.cmdEntrySqlFetchRowLimit` (default `1000`)
  - max rows per fetch
- `clPrompter.cmdEntrySqlFirstPageRowsToFetch` (default `200`)
  - first-page rows only for a query run
  - this value is used once when the query starts, then no longer used for that same query
  - after first page, each load-more uses `clPrompter.cmdEntrySqlFetchRowLimit`

## Code Snippets

- `Code Snippets` button opens built-in and user-defined snippets.
- Snippets can contain CL or SQL.
- Selected snippet runs immediately.
- Supported snippet variables:
  - `${sqlJobId}`
  - `${sqlJobName}`
  - `${sqlJobNumber}`
  - `${currentUser}`
  - `${currentLibrary}`
- Snippet tools include add, manage, import, and export.

## Command Menu (...)

Current menu items:

- `Collapse Message Details` / `Expand Message Details`
- `View CL History`
- `Clear CL Cmd History`
- `Clear SQL Stmt History`
- `Clear Log Messages`
- `Reconnect Server Job`
- `Cancel Last SQL stmt`

Message detail default behavior is controlled by `clPrompter.cmdEntryMessageDetails`:

- `SHOW`: command rows start expanded
- `HIDE`: command rows start collapsed

## Dedicated SQL Job Mode

Setting:

- `clPrompter.cmdEntryUseSharedSQLJob` (default `true`)

Behavior:

- By default, Command Entry uses the shared Code for IBM i SQL job.
- Set `clPrompter.cmdEntryUseSharedSQLJob` to `false` to use a CLPROMPTER-managed dedicated SQL job.
- Requires Code for IBM i Mapepire Server mode.
- If server mode is unavailable, Command Entry falls back to shared-job behavior.

Dedicated menu actions:

- `Reconnect Server Job`: ends the current dedicated SQL job and starts a new one.
- `Cancel Last SQL stmt`: sends a best-effort cancel request.

## Command Log Appearance

- CL command text color is configurable with `clPrompter.cmdEntryCommandTextColor`.
- Default command color is `#569CD6`.
- Command text is intentionally non-bold.
- In collapsed rows, the log uses a compact layout so more rows are visible in short panels.

## SQL Job ID Field

Right-side SQL job ID behavior:

- Single-click: copy/select job ID
- Double-click: run `Display Joblog`
- Right-click menu:
  - `Copy job name`
  - `Display Joblog`

## Known Limits

- Prompting returns text to the input box but does not auto-run.
- SQL cancel is best-effort and depends on host state.

## Quick Test Checklist

1. Run a known non-interactive CL command and verify outcome/messages.
2. Use `Prompt` (or `F4`) and verify prompt returns text without auto-run.
3. Run SQL with `SQL:` and with direct `SELECT`.
4. Verify SQL results appear and `Load more rows` works with default fetch settings.
5. Toggle `Collapse/Expand Message Details` and verify default row state changes.
6. In dedicated mode (`clPrompter.cmdEntryUseSharedSQLJob=false`) + server mode, test `Reconnect Server Job` and `Cancel Last SQL stmt`.
7. Verify SQL job ID click, double-click, and right-click actions.

## Suggested Smoke SQL

```sql
SELECT CURRENT SERVER AS SERVER_NAME, CURRENT USER AS USER_NAME
FROM SYSIBM.SYSDUMMY1
```

```sql
SELECT JOB_NAME, MESSAGE_ID, MESSAGE_TYPE, MESSAGE_TEXT
FROM TABLE(QSYS2.JOBLOG_INFO('*'))
FETCH FIRST 50 ROWS ONLY
```

## Issue Report Notes

Include:

- Exact CL/SQL text used
- `clPrompter.cmdEntryUseSharedSQLJob` value
- Mapepire Server mode state in Code for IBM i
- Any `...` menu action used immediately before the issue
- Screenshot of status text and SQL job ID
