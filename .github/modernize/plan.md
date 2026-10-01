# Plan: generic CL prompter registration (Sebjulliand request)

## Goal

Align the CL Prompter integration with the design discussed in vscode-ibmi PR #3307 so the dependency graph stays one-way:

- CL Prompter depends on the Core
- the Core does not hard-code CL Prompter by extension ID
- CLLE / editor F4 flows continue to work when no custom prompter is registered

## Scope

This change is limited to the generic registration / fallback mechanism and compatibility validation for the current CLLE integration path.

## Tasks

1. Inspect the current CL Prompter entrypoints and extension-ID lookups.
   - Confirm where direct extension coupling exists.
   - Identify all current callers / assumptions tied to `CozziResearch.clprompter`.

2. Define the generic registration API shape.
   - Add a small, optional API surface in the core that accepts a custom command prompter function.
   - Preserve the existing default behavior using `vscode.window.showInputBox()` when no custom prompter is registered.

3. Wire CL Prompter to the new API.
   - Register the CL Prompter function at activation time.
   - Keep the CL Prompter public API intact for direct callers.

4. Validate compatibility with CLLE / CL source editing flows.
   - Confirm F4 and other command-prompt paths still work when the custom prompter is absent.
   - Confirm the new registration is additive and non-breaking for current consumers.

5. Prepare the PR guidance summary.
   - Note that the current CLLE repo appears to have no direct CL Prompter dependency.
   - Note that this should be safe as an additive migration, not a breaking change.

## Success criteria

- No direct extension-ID coupling remains in the core flow.
- A default fallback remains available.
- CL Prompter can register itself without forcing the core to know its extension name.
- Current CLLE behavior remains unaffected unless it explicitly opts into the new prompter hook.

## Risks

- Breaking older consumers if we remove the existing API too aggressively.
- Accidentally changing F4 fallback behavior for editors without a registered prompter.

## Mitigation

- Keep the fallback path explicit.
- Add the new hook in an additive manner.
- Avoid removing the current CL Prompter API until compatibility has been verified.
