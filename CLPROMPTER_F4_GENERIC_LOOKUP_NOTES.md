# F4 + Generic Command Lookup Patch Notes

Date: 2026-09-24

## Why this note exists
A targeted code change was created to handle generic command lookup (for examples like `WRK*` or `GO CMDWRK`) before the F4 prompt action attempts to launch CL prompt parsing.

After introducing the change, extension startup timeout symptoms were observed in VS Code 1.139.0 in this environment. The change was reverted as a safety rollback while VS Code version behavior is being validated.

## Saved patch artifact
- Patch file: `patches/f4-generic-lookup-before-prompt.patch`
- Target file: `src/commandEntryView.ts`

## What the patch does
1. Adds a shared helper that detects generic command patterns and runs the existing command selection lookup flow.
2. Calls that helper from the F4 prompt path first, so generic tokens resolve to a concrete command before invoking the prompter.
3. Reuses the same helper in the run path to avoid duplicated logic.

## Re-apply steps
From repository root:

```bash
git apply patches/f4-generic-lookup-before-prompt.patch
npm run build
```

If you want to back it out again:

```bash
git apply -R patches/f4-generic-lookup-before-prompt.patch
npm run build
```

## Validation checklist after re-apply
- Enter `wrk*` in Command Entry and press F4.
- Confirm command picker appears first.
- Select a concrete command and verify prompt opens for that command.
- Enter `go cmdwrk` and press F4; confirm same behavior.
- Confirm extension starts normally after VS Code reload.
