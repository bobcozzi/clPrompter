# Multi SQL Job Approach in CL Prompter

## Purpose
This document describes how CL Prompter creates and manages a dedicated SQL job, and how that job is used to execute both:

- CL commands through CMD_RUN
- SQL statements from the Command Entry panel (sql: prefix path)

It also explains how this capability is exposed to other extensions as a supported external API.

## Audience

- Code for IBM i team
- IBM CLLE extension team
- Extension developers integrating IBM i command and SQL execution patterns

## Design Summary
CL Prompter supports two execution modes for Command Entry:

1. Shared mode
- Uses the default Code for IBM i connection SQL runner.
- No dedicated CL Prompter-owned SQL job is created.

2. Dedicated mode
- Creates and owns a separate Mapepire SQL job.
- Uses that owned job for Command Entry CL and SQL execution paths.
- Keeps dedicated job identity and lifecycle in CL Prompter.

The mode is controlled by setting:

- clPrompter.commandEntryUseDedicatedJob

## Key Components and Responsibilities

### src/commandEntryJobManager.ts
Owns dedicated job lifecycle and direct SQL execution plumbing.

- Create/reuse/end dedicated Mapepire job
- Maintain dedicated job id and state
- Execute SQL through dedicated job when enabled
- Fallback to connection.runSQL when dedicated mode is disabled
- Cancel active SQL in dedicated mode using:
  - CALL QSYS2.CANCEL_SQL(?) via connection.runSQL with bindings

### src/commandEntryService.ts
Owns Command Entry execution orchestration.

- Detect sql: statements vs CL command path
- Execute CL command path through CMD_RUN UDTF query
- Execute SQL statement path with chunking/prefetch/session logic
- Delegate low-level SQL execution to CommandEntryJobManager when present

### src/commandEntryView.ts
Owns Command Entry UI message routing and feature gating.

- Initializes dedicated job when needed
- Triggers execution through CommandEntryService
- Exposes menu actions like Start New Server Job and Cancel SQL for Server Job
- Disables dedicated-only menu actions when shared mode is active

### src/sqlResultPanel.ts
Owns SQL result rendering and paging/prefetch UX for result sets.

## End-to-End Execution Flow

### A) Dedicated job creation and reuse
1. Command Entry view loads.
2. If dedicated mode is enabled, initialization calls restart/create path.
3. Job manager obtains Mapepire component from active connection.
4. Job manager creates a new job with mapepire.newJob(connection, jdbc options).
5. Job manager reads and stores the dedicated job id.
6. Later operations reuse that job while connection key matches.

### B) CL command path in Command Entry
1. User runs CL command.
2. Service builds CMD_RUN SELECT statement with bindings.
3. Service routes SQL execution through job manager.
4. In dedicated mode, execution is done on owned dedicated job.
5. In shared mode, execution falls back to connection.runSQL.

### C) SQL statement path in Command Entry
1. User runs statement with sql: prefix.
2. Service normalizes statement and applies fetch settings.
3. For selectable queries, service uses chunk/prefetch/session paging.
4. Chunk fetch calls are routed through job manager execution path.
5. Dedicated mode behavior accounts for 100-row backend page behavior by aggregating chunks.

### D) Cancel SQL path
1. User chooses Cancel SQL for Server Job from menu.
2. View checks dedicated mode capability.
3. Job manager uses the stored dedicated job id.
4. Job manager sends direct SQL through Code for IBM i API:
   - CALL QSYS2.CANCEL_SQL(?)
   - bindings: [dedicatedJobId]

No SBMJOB or RUNSQL wrapper is used in the active cancel path.

## How Other Extensions Can Leverage This Pattern

## Option 1: Replicate the pattern in your own extension today
Use Code for IBM i exported APIs to:

1. Get active connection.
2. Acquire mapepire component.
3. Create and hold your own Mapepire job.
4. Route your extension's CL and SQL paths through that owned job.
5. Keep fallback path to connection.runSQL for compatibility.

Recommended practical structure:

- Job manager class (own lifecycle, state, cancel)
- Service class (orchestration, chunking, command-vs-sql routing)
- View/controller class (capability gating and UX)

## Option 2: Consume CL Prompter as an external API
This is now available through the extension export object as `multiSqlJob`.

## External Accessibility Status
Current status: externally accessible.

The activation return object now exposes:

- CLPrompter
- CLPrompterCallback
- multiSqlJob

`multiSqlJob` is backed by the same shared runtime objects used by Command Entry in this extension (job manager + command service), so external callers and Command Entry operate on the same dedicated/shared mode state.

## What Is Public Today
- CLPrompter
- CLPrompterCallback
- multiSqlJob (apiVersion 1.0.0)

### multiSqlJob methods
- isDedicatedModeEnabled()
- getJobState()
- ensureDedicatedJob()
- restartDedicatedJob()
- cancelDedicatedJobSql()
- runSql(statements, options)
- executeCommandEntry(command, mode, executionId?)
- closeSqlSession(sessionId?)
- loadMoreSql(sessionId, fetchAll?, fetchRowsOverride?)
- getConfiguredPrefetchRows()

## What Is Internal Today
- Dedicated SQL job creation/reuse/end logic
- Dedicated job id/state retrieval
- Command Entry SQL session and paging internals
- Dedicated-only cancel behavior

## Remaining TODO for API Maturity
1. Add contract tests for `multiSqlJob` external API surface.
2. Add versioned TypeScript declaration snippet to CLPROMPTER_API.md.
3. Add one end-to-end external consumer sample extension.
4. Add formal semantic-version compatibility notes for API changes.

## Operational Notes

- QSYS2.CANCEL_SQL can only cancel interruptible SQL requests.
- It does not cancel arbitrary CL program flow by itself.
- Dedicated mode isolates Command Entry workload from shared SQL runner contention.
- Shared mode remains useful for conservative compatibility and lower state footprint.

## Recommended Next Step
If external reuse is a near-term goal, prioritize publishing a minimal sample that consumes `multiSqlJob` and validates dedicated vs shared behavior in both modes.
