# CL Prompter / Mapepire LOB notes

## Key finding
The DB2i extension does not expose a custom `getClob()`/`getBlob()` method. Instead, it exposes a SQL job configuration option called `lob threshold` in the job performance settings UI.

Evidence:
- In `vscode-db2i/src/views/jobManager/editJob/perfTab.ts`, the UI defines:
  - `lob threshold`
  - description: "Specifies the maximum LOB (large object) size (in bytes) that can be retrieved as part of a result set. LOBs larger than this threshold will be retrieved in pieces using extra communication to the system."
- The SQL job is created by passing a JDBC options object into Mapepire:
  - `mapepire.newJob(connection, { jdbc: options })`
- So the effective setting is a job-level JDBC option, not a per-query SQL helper parameter.

## Implication for CL Prompter
If CL Prompter creates a Mapepire SQL job, it can control large-object behavior by setting a job-level config similar to:

```ts
const job = await mapepire.newJob(connection, {
  jdbc: {
    "lob threshold": 32768,
    // other JDBC/job options...
  }
});
```

This is the right pattern if the goal is to protect `SELECT *`-style queries from unexpectedly pulling large CLOB/BLOB values as fully materialized result-set payloads.

## Contrast with current vscode-rpgle wrapper
The current wrapper in `vscode-ibmi/src/api/IBMi.ts` does:

```ts
query = this.sqlJob.query(statement, { parameters: options.bindings });
const rs = await query.execute(options.rows ?? 99999);
```

and then materializes `rs.data` as normal JS rows.

This means the generic `runSQL()` abstraction is not exposing a locator/streaming LOB API; it is doing standard row materialization. A CLOB(1M) can therefore be expensive as part of the row payload unless the underlying Mapepire job is configured to chunk/threshold LOB fetches.

## Recommended mental model
- `row limit` = per-query count cap
- `lob threshold` = per-job large-object fetch behavior
- these are different concerns

For CL Prompter, the useful control is the `lob threshold` job property, because it softens the risk of large result retrieval when users accidentally do broad `SELECT *` queries.
