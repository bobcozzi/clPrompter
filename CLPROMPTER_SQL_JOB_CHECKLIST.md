# CLPROMPTER SQL job implementation checklist

## Goal
Carry over the useful parts of the db2i SQL-job/session pattern without importing the saved-profile UI or large JDBC configuration model. The existing CLPROMPTER implementation already has the right high-level architecture, so the goal is to strengthen it with explicit session state and context handling rather than rewriting it around a different design.

## Current CLPROMPTER architecture review
The repo already contains the core pieces needed for a safe managed SQL runtime:

- `CommandEntryJobManager` owns the dedicated/shared SQL job selection logic, job state, reconnect tracking, and retry behavior.
- The manager tracks `job`, `dedicatedJobId`, `status`, and per-connection state in a way that is already resilient to reconnect churn.
- `CommandEntryService` centralizes SQL execution and schema helper queries that rely on the chosen job route.
- `src/extension.ts` already performs keep-alive pings, monitors shared Mapepire job status, and refreshes the UI when the connection or SQL job changes.
- The project already uses a route decision model (`dedicated` vs `shared`) and exposes a display job ID and current status for the UI.

This is important: CLPROMPTER does not need a wholesale db2i clone. It needs a small enhancement layer on top of the current architecture.

## Keep and enhance

### 1. Managed SQL job lifecycle
Keep the current job creation and reconnect flow, but formalize it as a managed runtime object rather than an implicit side effect of `connection.runSQL()`.

Required behavior:
- keep the current `CommandEntryJobManager` as the coordinator
- add a lightweight `ManagedSqlSession`/`SqlSessionState` model alongside it
- store:
  - `jobId`
  - `status` (`ready`, `busy`, `ended`, `closed`)
  - `namingMode` (`sql` vs `system`)
  - `currentSchema`
  - `defaultLibrary`
  - `libraryList`
  - `startupSql` hooks that run once per session
- provide lifecycle methods: `start()`, `ensureConnected()`, `close()`, `reconnect()`, `cancel()`, `refreshStatus()`, `execute()`

Compatibility rule:
- do not replace `readDedicatedJobId()`, `ensureJob()`, `restartJob()`, or the shared-job fallback logic
- instead, add session metadata on top of those existing transitions and status checks

### 2. Naming-aware current schema tracking
The repo already recognizes the need to refresh state after connection changes. Extend that with schema awareness without disturbing the current job selection behavior.

Add:
- `currentSchema` tracked per session
- `namingMode` stored from the active SQL job state or system metadata
- a helper like `resolveCurrentSchema()` that prefers the current connection/job state before falling back to defaults
- invalidation when a statement changes context, such as `SET CURRENT SCHEMA`, `SET SCHEMA`, `SET OPTION`, or other library/schema switching SQL

Rule of thumb:
- with SQL naming active, default object resolution should favor the schema context
- with system naming active, resolve from the library list/default library

### 3. Library/default context bootstrap
This should be layered onto the current job flow and should not force a separate connection model.

Recommended bootstrap sequence:
1. read the active connection and current job state
2. query default library and library list from the system
3. normalize the values into a `SessionContext` object
4. use that context for command help, object resolution, and parameter lookup
5. refresh when the connection reconnects or the library list changes

Important compatibility detail:
- the current router already determines whether to target the dedicated or shared SQL job
- the bootstrap logic should piggyback on that decision instead of trying to own the whole lifecycle

### 4. Optional startup SQL hooks
Add an explicit startup hook list at the session layer instead of auto-running ad hoc SQL on every connect.

Examples:
- `SET SYSIBMADM.SELFCODES = ...`
- session-specific initialization
- host/job-specific settings that are intentionally not part of generic execution

Rules:
- keep this as a small optional array or config object
- run once per job/session, not on every query
- do not make startup SQL a hidden global side effect
- keep the hook explicit and easy to disable/reset on reconnect

### 5. Status and cancellation handling
CLPROMPTER already has the right pattern for status visibility and cancellation, but it should be made more formal and reusable.

Add or strengthen:
- `jobStatus` mapping from the underlying Mapepire/shared job state to `ready`, `busy`, `ended`, `closed`
- a guard to avoid sending new SQL while a statement is active
- a central `cancelCurrentQuery()` or cancel helper that uses the active SQL/job ID when available
- graceful fallback when the chosen job is invalid or already ended
- a small job-status signal surfaced through the prompt host or output channel

This should complement, not replace, the current `requestCancelSqlJob()` and `buildCancelSqlJobCommand()` flows.

### 6. Central query execution wrapper
The repo already has several direct SQL callers. The missing piece is a single wrapper that enforces session selection and consistent status handling.

The wrapper should centralize:
- selected job lookup
- statement creation and normalization
- batch/array handling
- cleanup and timeout behavior
- result parsing and continuation handling
- error classification and retry/fallback decisions
- logging of connection or job state changes

This should serve as the one front door for SQL calls used by command-entry helpers, lookup services, and prompt assistance.

## Recommended CLPROMPTER integration pattern
Implement the changes as an enhancement layer to the current design:

- `CommandEntryJobManager` remains the lifecycle owner and route selector
- `CommandEntryService` becomes the default caller-facing SQL wrapper
- a small `SqlSessionContext` object tracks library/default context and schema
- the startup SQL hook is attached to session creation or reconnect, not to every `runSQL` call
- cancellation and status are surfaced from the job manager into the UI layer

That preserves the current architecture and compatibility while adding the db2i-style discipline that matters operationally.

## Concrete implementation plan

### Phase 1: minimal managed session model
- add `SqlSessionState` or `ManagedSqlSession` to track session metadata
- store job id, status, naming mode, schema, default library, and library list
- keep current dedicated/shared job flow intact

### Phase 2: context tracking and invalidation
- add `resolveCurrentSchema()` and `resolveSessionContext()` helpers
- track schema changes from `SET` operations and reconnect events
- use schema/default library as the object lookup context in help and SQL assistance

### Phase 3: startup hook support
- add `startupSql?: string[]` or an init hook object
- execute it once per session when the job starts.
- keep it optional and explicit

### Phase 4: status and cancel plumbing
- expose a status summary to the UI
- make `cancel` paths consistent with the existing job cancel commands
- ensure queued work does not fire while the active job is busy

### Phase 5: wrapper hardening
- centralize SQL execution through a consistent wrapper
- handle busy/ended jobs and connection restarts gracefully
- log connector/jvm/session transitions for diagnostics

## Scope to defer for now
These are useful in a general SQL IDE, but not required for CLPROMPTER at this point:
- saved SQL job profiles
- named per-connection preset configurations
- large JDBC configuration screens
- user-managed driver/profile selection UI
- a broad db2i-style job manager with a full saved-state model

## Quick summary for the repo
If I reopen this repo later, the target upgrade is:
1. managed SQL job/session lifecycle
2. naming-aware schema tracking
3. library/default context bootstrap
4. startup SQL hooks
5. cancellation and status handling
6. central SQL execution wrapper

And the rule is: keep the current architecture, extend it, and avoid cloning the entire db2i extension UI or saved-profile system.

## Implementation note for this repo
The strongest compatibility approach is to evolve the current `CommandEntryJobManager` and `CommandEntryService` rather than inserting an unrelated session model. The current code already has the right connectivity and reconnect behavior; the missing improvement is explicit runtime context and a more formal execution wrapper around the active SQL job.
