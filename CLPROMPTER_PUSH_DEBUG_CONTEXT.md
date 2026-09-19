# CL Prompter startup crash investigation

## Context
We traced an anonymous startup error of the form:

`rejected promise not handled within 1 second: TypeError: Cannot convert undefined or null to object`
`stack trace: TypeError: Cannot convert undefined or null to object`
`at push (<anonymous>)`

This appears in the user log during activation of other extensions, immediately before or around CL Prompter activation. The current source in the vscode-rpgle repo was validated and does not match this runtime path.

## What we know
- The current vscode-rpgle bug fix exists in source and builds successfully.
- The relevant log markers in vscode-rpgle do not appear in the user runtime log, which suggests the failing extension is not vscode-rpgle.
- The best suspect is CL Prompter because it activates immediately after the error.
- The failure signature is a startup `.push()` on an undefined array or similar object.

## Likely root cause pattern
Look for code like:
- `someArray.push(...)` where `someArray` is declared conditionally or initialized late
- `registerX.push(...)` in extension activation
- arrays that are set in a different module or lifecycle stage than expected
- event handler registration happening before initialization completes

## Suggested search targets
Search the CL Prompter repo for:
- `.push(`
- `onDid*` / `workspace.onDid*` / `commands.register*`
- startup activation code in `src/extension.ts` or similar
- global arrays or callback registries created at module scope

## Investigation goal
Confirm whether a startup array is undefined and guard it before the `.push` call, or initialize it before registration.

## Current assessment
This is likely a separate extension startup bug, not a vscode-rpgle runtime bug.

## Evidence update (2026-09-18)
- Startup log order now shows the `push (<anonymous>)` failure occurs before `CL Prompter extension activated`.
- New CL Prompter activation guards were added around component registration and event subscription.
- No CL Prompter guard failures were logged (`registerComponent failed ...` / `subscribe failed ...`).
- Immediately before the unhandled push error, VS Code logs repeated:
	- `Failed to load message bundle for file ... ms-edgedevtools.vscode-edge-devtools-2.1.12/out/extension`
- `ms-edgedevtools.vscode-edge-devtools` activates on `onStartupFinished`, which aligns with the failure window.

## Updated likely culprit
- The anonymous `push` failure is most likely not in CL Prompter.
- Highest-probability suspect from available evidence: `ms-edgedevtools.vscode-edge-devtools` startup path (broken or incompatible install/state).

## Fast validation sequence
1. Disable `Microsoft Edge Tools for VS Code` (`ms-edgedevtools.vscode-edge-devtools`).
2. Reload window and capture startup log.
3. If the push error disappears, re-enable and reinstall/update that extension.
4. If the push error persists, run Extension Bisect with CL Prompter enabled to identify the actual extension.

## CL Prompter status after this run
- CL Prompter activated successfully.
- CmdHelp/CmdXml/CmdRun component checks all reported `Installed`.
- Connected event handlers all ran (context, mapepire dump, startup mode, keepalive, prefetch, patch-runsql).
