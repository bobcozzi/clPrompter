# Issue #20 investigation notes

## Summary

The messages in issue #20 are not custom clPrompter text. They are IBM i compiler/replacement messages caused by a target-release mismatch.

The extension is creating host-side UDTF objects in a temp library using commands such as:

- CRTSQLCPPI
- CRTPGM
- CRTBNDRPG
- RUNSQLSTM

If the IBM i server job that runs those commands has a lower default target release (for example V7R3M0) than the objects being created or replaced (for example V7R5M0), IBM i emits messages like:

- Module CMDHELP has a previous release V7R5M0 later than the specified target release V7R3M0.
- Program CMDHELP not created.
- Module CMDXML has a previous release V7R5M0 later than the specified target release V7R3M0.

This matches the report from issue #20.

## Root cause

The generated host support objects were being created without forcing `TGTRLS(*CURRENT)`. The commands inherited the default target release of the host job instead of the current system release.

That caused the newer objects to be treated as incompatible with the lower default target release during create/replace.

## Fix applied

The compile/install commands were updated to force the current release:

- `CRTSQLCPPI ... TGTRLS(*CURRENT)`
- `CRTPGM ... TGTRLS(*CURRENT)`
- `CRTBNDRPG ... TGTRLS(*CURRENT)`
- `RUNSQLSTM ... TGTRLS(*CURRENT)`

This keeps the generated support objects aligned with the active IBM i release and avoids the stale job-default target problem seen in issue #20.

## Why deleting the temp library helped

Deleting or rebuilding the temp library forces a fresh install, which clears any older objects created under the wrong target-release default. That explains why the workaround in the issue comment helped.

## Scope

This fix is primarily relevant when a user sees the host-job target-release mismatch illustrated by issue #20. It is not necessary for normal installations where the job default target release already matches the current system release.

## Notes

- The error appears in the host job (for example `QZDASOINIT`) because that is the job executing the background install commands.
- The wording looks odd because it is a raw IBM i system message, not a custom extension message.
- The proper long-term fix is to force `TGTRLS(*CURRENT)` in all host-side create/recreate operations.

## Relevant repo files

- `src/components/hostFunctions.ts`
- `CHANGELOG.md`
