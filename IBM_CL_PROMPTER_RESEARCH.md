# IBM CL Prompter Research (from JT400/JTOpen + ACS jar analysis, 2026-11-04)

Findings from analyzing IBM's own CL prompter implementation. Reference material
extracted into `docs/`: `qcdrcmdd.dtd` (IBM's DTD for the QCDRCMDD XML — the
authoritative parse contract) and `guiprompt-ibm.html` (IBM's GUI prompt doc).

## Where IBM's prompter actually lives

- NOT in jt400.jar (checked ACS-bundled and JTOpen 21.0.7 — zero prompter classes).
- It is in ACS's `acsbundle.jar` → `lib/util400.jar` → package `com.ibm.as400.ui.util`
  (131 classes). Closed-source, Swing-only, package-private internals, not present on
  IBM i. Cannot be reused from VS Code/mapepire — but is a proven blueprint.
- Entry point: `com.ibm.as400.ui.util.CommandPrompter`
  `new CommandPrompter(Window, AS400, String)` → `showDialog()` → `getCommandString()`.
- ACS bundle kept for analysis: `~/Downloads/projects/mapepire-server/hostACSJar/`
  (nested jars in `hostACSJar/x/`, extracted `Cl*.class` files in `hostACSJar/x/cls/`).

## IBM's architecture (mirror of what this extension does)

ClCommand (fetch QCDRCMDD XML) → ClDocument (SAX parse) → node model
(ClCmd / ClParm / ClQual / ClElem / ClDep / ClPmtCtl+Cond / ClSngVal / ClSpcVal /
ClValues) → Swing panel layout → serialize back with `getCLString()`.
Runtime: `ClChoicePgmValues` calls CHOICEPGM; `ClPromptOverride` calls the
prompt-override program (PMTOVRPGM); `qcapcmd.pcml.ser` bundled → they use the
QCAPCMD host API for prompt-accurate parse/validation.

## IBM ClTypes — complete CL type list (from bytecode constants)

DEC, LGL, CHAR, NAME, SNAME, CNAME, PNAME, GENERIC, CMDSTR, DATE, TIME, HEX, X,
INT2, INT4, UINT2, UINT4, VARNAME, CMD, ELEM, QUAL, ZELEM(zero-element), plus
UNSUPPORTED. Relation constants: ALWAYS, SPCFD, UNSPCFD, GT, EQ, NL, LT, NE, LE, NG, GE.

Our `CL_DATA_TYPES` in src/promptHelpers.ts covers all of these except naming:
IBM's `ZELEM` == our `ZEROELEM`. Also IBM has `HEX` distinct from `X` — ours has
both 'HEX' and 'X' too. No gaps found.

## Gaps / possible improvements for this extension

1. **No CHOICEPGM runtime invocation.** IBM calls the command's choice program at
   prompt time to populate dynamic dropdown values (`ClChoicePgmValues`,
   `ClSyntax.getChoicePgmValue`). Our populator has no choicepgm handling — choices
   come only from static `SpcVal`/`Values` and `Choice=` prompt text. Commands whose
   values are dynamic (e.g. object lists) will show no/limited dropdowns.
   Fix: add a mapepire request that runs the choice program (or call it via
   `runCommand`), passing current parm values.
2. **No PMTOVRPGM (prompt override program) support.** IBM's `ClPromptOverride` +
   `CommandPrompter.setUsePromptPrograms()` run the PMT OVR program to replace
   defaults with current actual values (e.g. CHGxxx commands showing current
   settings). We don't do this — worth adding for change-type commands.
3. ~~**QCAPCMD validation**~~ **ALREADY DONE.** We validate via the CMD_RUN SQL UDTF
   (written for this extension) which wraps QCAPCMD. When the IBM i team's planned
   mapepire wrapper for JT400's CommandCall/run-command interface lands, consider
   switching CMD_RUN to that transport.
4. **PMTOVRPGM: dropped.** IBM's `ClPromptOverride` class is package-private with
   only `javap` signatures visible (no source/decompile in scope), and PMTOVRPGM's
   input/output parameter protocol is not documented publicly. Not implementable
   without reverse-engineering effort disproportionate to the value.

## getcmdxml transport (already in use here)

- Server: mapepire-server GetCmdXml.java → JT400 `Command.getXMLExtended()`
  (QCDRCMDD CMDD0200). Server PR Mapepire-IBMi/mapepire-server#204.
- Client: mapepire-js `SQLJob.getCmdXml(path)`, PR Mapepire-IBMi/mapepire-js#126.
- CMDD0200 vs CMDD0100: 0200 adds DEP/choice-program detail. If host throws
  CPF3C21 (old OS), fall back to plain getXML() format CMDD0100.
- XML arrives UTF-8 (CCSID 1208) regardless of job CCSID.
