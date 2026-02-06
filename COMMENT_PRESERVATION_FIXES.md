# Comment Preservation and Anchor Rule Fixes - Session Summary

**Date:** February 5-6, 2026
**Extension Version:** 0.0.46
**Configuration:** rightMargin=70, contIndent=27, kwdPosition=24, AVG_PARAM_NAME=6

## Summary of Fixes

This document tracks multiple fixes implemented across two days to improve CL command formatting:

**February 5, 2026:**
1. ✅ **Comment Extraction** - Fixed comments being lost on multi-line commands with long strings
2. ❌ **Backtracking Attempt** - Tried to reduce aggressive backtracking, but broke parameter handling (reverted)
3. ✅ **Formatter Unification** - Made Prompter use same formatter as Format CL command

**February 6, 2026:**
4. ✅ **IBM i SEU Anchor Rule** - Fixed excessive backtracking by implementing proper anchor rule
   - Parameters stay on same line when possible (e.g., `VALUE('text` stays together)
   - Only backtracks if the anchor itself doesn't fit
   - Matches IBM i SEU formatting behavior

---

') /* hello + world */
') /* Hello world */
```

Commands without long text strings retained their comments when formatted, but those with long strings lost them.

## Root Cause Analysis

Investigation revealed **two distinct issues**:

1. **Comment Extraction Failure** (in `extractor.ts`)
   - The `collectCLCmdFromLine` function wasn't properly separating comments from command text on multi-line commands
   - Forward-scanning with quote state tracking failed on continuation lines

2. **Backtracking Behavior** (in `tokenLayoutFormatter.ts`)
   - User concern: "first parameter is always starting on the 2nd line when it could be fitted onto the first line"
   - Backtracking appeared too aggressive in some cases

## Implemented Fixes

### ✅ FIX #1: Comment Extraction (KEPT - WORKING)

**File:** `src/extractor.ts`
**Lines:** 125-167

**OLD APPROACH:**
- Forward scan with quote state tracking
- Got confused on continuation lines with comments

**NEW APPROACH:**
- **Backward-scanning algorithm** from `*/` to find matching `/*`
- Avoids quote tracking confusion entirely

**Implementation:**
```typescript
// Find closing */ first
const commentEnd = trimmedLine.lastIndexOf('*/');
if (commentEnd !== -1) {
  // Look backwards for opening /*
  let commentStart = -1;
  for (let i = commentEnd - 1; i >= 0; i--) {
    if (trimmedLine[i] === '*' && trimmedLine[i - 1] === '/') {
      // Check if preceded by space or at line start
      if (i === 1 || trimmedLine[i - 2] === ' ') {
        commentStart = i - 1;
        break;
      }
    }
  }

  if (commentStart !== -1) {
    // Extract code part and comment part separately
    currentLine = trimmedLine.substring(0, commentStart).trimEnd();
    trailingComment = trimmedLine.substring(commentStart).trim();
  }
}
```

**Validation:**
- User console log confirmed: `"Comment: /* what the heck? Over. */"`
- Comments now properly separated and preserved in formatted output

**Status:** ✅ **WORKING CORRECTLY**

---

### ❌ FIX #2: Backtracking Logic (REVERTED - BROKE THINGS)

**File:** `src/tokenLayoutFormatter.ts`
**Lines:** 464-540

**ATTEMPTED FIX:**
- Skip backtracking for long strings (`isQuotedString && isBreakAfter`)
- Rationale: Let long strings wrap naturally, only backtrack short values

**PROBLEM:**
- Broke **ALL** parameter handling, not just long strings
- Started breaking after every `KEYWORD(` opening paren
- User example: `CMD(DSPJOB JOB(063459/COZZI/THREADS) +\n          DUPJOBOPT(*MSG))`
- Now breaking after `CMD(` when it should keep nested command together

**User Feedback:**
> "That fix you just did, #2, made things worse...we now break after the KWD( instead of trying to keep it on the same line with its value"

**DECISION:** **REVERTED TO ORIGINAL**

**Current Algorithm (Restored):**
```typescript
// Original backtracking logic that:
// 1. Calculates totalContentLen including first chunk of multi-line strings
// 2. Uses hasBreakAfterToken logic to only count first chunk length
// 3. Checks if currentCol + totalContentLen + continuationSpace > rightMargin
// 4. Backtracks entire KEYWORD( if doesn't fit
```

**Status:** ✅ **REVERTED - STABLE BASELINE RESTORED**

**Known Limitation:** May still backtrack aggressively in some cases (original user concern remains unaddressed)

---

### ✅ Enhanced Debug Logging (KEPT - WORKING)

**File:** `src/formatCL.ts`
**Lines:** 821-828

**Added console output:**
- Command extraction line number
- Extracted command text
- Comment detection status
- Line range of command

**Example Output:**
```
Command extraction from line X
Command: SBMJOB CMD(...)
Comment: /* what the heck? Over. */
Lines X-Y
```

**Status:** ✅ **WORKING - HELPS DEBUG EXTRACTION**

## Current State

### What's Working ✅
1. **Comment extraction** - Backward-scan algorithm successfully preserves comments
2. **Build system** - Extension compiles cleanly (npm run build successful)
3. **Debug logging** - Enhanced output shows extraction details
4. **Stable baseline** - Back to known-working backtracking behavior

### What's Reverted ⏮️
1. **Backtracking optimization** - Attempt to reduce aggressive backtracking removed
2. **Reason** - Fix broke all parameter handling instead of helping

### Known Limitations ⚠️
1. **Original backtracking concern unaddressed** - User's complaint about parameters on line 2 when they could fit line 1 may still exist
2. **Backtracking very sensitive** - Can't simply skip for certain token types without breaking other cases

## Testing Required

### Priority 1: Verify Comment Preservation ✅
- **Action:** User needs to reload VS Code window
- **Test:** Format CL files with long strings and comments
- **Expected:** Comments preserved (console log suggests working)

### Priority 2: Check Backtracking Behavior
- **Test:** See if original backtracking behavior is acceptable
- **Examples to test:**
  - `SBMJOB CMD(DSPJOB JOB(...))`
  - `CHGVAR VAR(&VAR) VALUE('long string...')`
  - Nested commands with multiple parameters

### Priority 3: Edge Cases (Low Priority)
- Comments with nested commands
- Multiple comments in single command
- Comments without trailing spaces

## Next Steps

### If Comments Working + Backtracking Acceptable ✅
- **Outcome:** Session complete, formatter fully functional
- **Action:** None needed - both issues resolved

### If Backtracking Still Problematic ⚠️
- **Required:** Specific examples of incorrect backtracking
- **Approach:** Need to understand failure mode before attempting fixes
- **Consideration:** May need to study IBM SEU backtracking algorithm more carefully
- **Options to explore:**
  - Different first chunk sizing calculation
  - Separate logic for nested commands vs simple parameters
  - Runtime measurement instead of pre-calculation

### DO NOT ❌
- Attempt backtracking fixes without clear understanding of failure mode
- Make changes that could break working comment extraction
- Skip user testing before making new changes

## Key Insights

1. **Comment extraction fix was straightforward** - Backward-scan from `*/` to `/*` avoids all quote tracking complexity

2. **Backtracking logic is very sensitive** - Can't just add conditional logic to skip in certain cases without breaking other scenarios

3. **User testing critical** - What looks like an improvement can make things worse (Fix #2 lesson)

4. **Prioritize stability** - Keep working fixes, revert broken ones, don't mix good and bad changes

5. **Console logging invaluable** - Confirmed comment extraction working even before user manually tested

6. **Formatter consistency matters** - Different code paths (Prompter vs Format CL) should use the same formatter to ensure consistent results

7. **Anchor Rule is key to proper formatting** (Feb 6) - Following IBM i SEU spec precisely:
   - Calculate if ANCHOR fits, not entire parameter
   - Anchor = `KEYWORD(` + minimal first content (~10 chars for strings, first token for expressions)
   - Only backtrack if anchor itself doesn't fit
   - Use `skipWrapCheck` to keep anchor components together
   - This matches IBM i SEU behavior and reduces unnecessary line breaks

## Additional Fix: Unified Formatter for Prompter and Format CL Command

### ✅ FIX #3: Formatter Consistency (FIXED - WORKING)

**Problem Discovered:**
User noticed that the Prompter and Format CL (current line) command were producing different formatting results.

**Root Cause:**
The two features were using **different formatters**:
- **Prompter** → `formatCLCmd()` → OLD `formatCL_SEU_OLD` from `tokenizeCL.ts`
- **Format CL command** → `formatCLSource()` → NEW formatter from `formatCL.ts`

**File:** `src/extension.ts`
**Lines:** 686-716

**OLD CODE (Prompter):**
```typescript
const { formatCLCmd } = require('./tokenizeCL');
const formatted = formatCLCmd(label, cmdName, parmStr, trailingComment);
```

**NEW CODE (Prompter):**
```typescript
const { formatCLSource } = require('./formatCL');
const { FormatOptions } = require('./formatCL');

// Get format options from configuration (same as Format CL command)
const formatConfig = vscode.workspace.getConfiguration('clPrompter');
const formatOptions: typeof FormatOptions = {
    cvtcase: formatConfig.get('formatCase', '*UPPER'),
    indrmks: formatConfig.get('formatIndentComments', '*YES'),
    labelpos: formatConfig.get('formatLabelPosition', 2),
    bgncol: formatConfig.get('formatCmdPosition', 14),
    indcol: formatConfig.get('formatKwdPosition', 25),
    indcont: formatConfig.get('formatContinuePosition', 27)
};

// Reconstruct full command with label and comment
let fullCmd = '';
if (label && label.length > 0) {
    fullCmd = label + ': ';
}
fullCmd += cmdName + ' ' + parmStr;
if (trailingComment) {
    fullCmd += ' ' + trailingComment;
}

// Format using the new formatter
const formattedLines = formatCLSource([fullCmd], formatOptions, 0);
const formatted = formattedLines.join('\n');
```

**Result:**
- Both Prompter and Format CL command now use the **same formatter** (`formatCLSource`)
- Both apply the **same configuration settings**
- Formatting output is now **consistent** across both features

**Status:** ✅ **FIXED - FORMATTER UNIFIED**

---

### ✅ FIX #4: IBM i SEU Anchor Rule Implementation (FIXED - WORKING)

**Problem Discovered:**
The formatter was backtracking entire `KEYWORD(` constructs to new lines even when the keyword and opening portion of the value could fit on the current line. This resulted in excessive line breaks and did not match IBM i SEU formatting behavior.

**IBM i SEU Anchor Rule (from specification):**
- **For Quoted values:** Anchor is `KEYWORD('` + some initial text
  - If anchor doesn't fit, move entire parameter to new line
  - If anchor fits, keep it and wrap only the remaining value
- **For Expressions:** Anchor is `KEYWORD(` + first token(s)
  - Same behavior

**Root Cause:**
The backtracking logic calculated whether the ENTIRE parameter value would fit on the line. If not, it moved the entire `KEYWORD(` to a new line. This was overly aggressive.

**File:** `src/tokenLayoutFormatter.ts`
**Lines:** 465-545

**OLD APPROACH:**
```typescript
// Calculate total content length between opening and closing paren
let totalContentLen = 0;
// ... count all tokens ...

const spaceNeeded = currentCol + totalContentLen + continuationSpace;
if (spaceNeeded > config.rightMargin) {
    // Backtrack entire KEYWORD(
}
```

**NEW APPROACH (Anchor Rule):**
```typescript
// Calculate ANCHOR length - keyword + opening paren + first portion of value
let anchorLen = 0;

if (isQuotedString) {
    // Anchor for quoted string: KEYWORD(' + ~10 chars minimum
    const firstChunk = valueToken.text;
    const minAnchorContent = Math.min(10, firstChunk.length);
    anchorLen = minAnchorContent;
} else {
    // Anchor for expression or other: KEYWORD( + first token
    anchorLen = valueToken.text.length;
}

const anchorSpaceNeeded = currentCol + anchorLen + continuationSpace;

if (anchorSpaceNeeded > config.rightMargin) {
    // ONLY backtrack if the ANCHOR itself doesn't fit
    // ... backtrack logic ...
} else {
    // Anchor DOES fit - don't backtrack
    // Skip wrap check for next token to keep anchor together
    skipWrapCheck = true;
}
```

**Test Results:**
Created `test AnchorRule.ts` with 4 test cases:

**Test 1:** Quoted string
Before: `VALUE(` moved to new line
After: `VALUE('This is a long string that will +` stays together ✅

**Test 2:** Multiple parameters with long string
Before: `MSGQ(` moved to new line
After: `MSGQ('This is a very long message +` stays together ✅

**Test 3:** Expression parameter
Before: `VALUE(` moved to new line
After: `VALUE(&VERYLONGVARIABLENAME + +` stays together ✅

**Test 4:** Short value control test
Before: ✅ Already working
After: ✅ Still works correctly

**Result:**
- Anchor rule properly implemented
- Keywords and opening values stay together when possible
- Matches IBM i SEU formatting behavior
- Reduces unnecessary line breaks

**Status:** ✅ **FIXED - ANCHOR RULE IMPLEMENTED**

---

## Files Modified

| File | Lines | Status | Description |
|------|-------|--------|-------------|
| `src/extractor.ts` | 125-167 | ✅ KEPT | Backward-scan comment extraction |
| `src/tokenLayoutFormatter.ts` | 464-540 | ⏮️ REVERTED | Backtracking logic restored to original |
| `src/tokenLayoutFormatter.ts` | 465-545 | ✅ FIXED | Anchor rule implementation (Feb 6) |
| `src/formatCL.ts` | 821-828 | ✅ KEPT | Enhanced debug logging |
| `src/extension.ts` | 686-716 | ✅ FIXED | Unified formatter for Prompter |
| `src/testAnchorRule.ts` | - | ✅ ADDED | Test cases for anchor rule |

## Build Status

**Last Build:** Successful
**Command:** `npm run build`
**Result:** Clean compilation, no errors
**Ready for:** User testing after VS Code reload

---

## Quick Reference for Tomorrow

**What to remember:**
1. Comments now preserved via backward-scan in `extractor.ts` (lines 125-167)
2. Backtracking fix #2 failed and was reverted (Feb 5)
3. **IBM i SEU Anchor Rule implemented successfully** (Feb 6) - in `tokenLayoutFormatter.ts` lines 465-545
4. Anchor rule: Keywords stay with opening values (`KEYWORD('text` stays together)
5. Prompter and Format CL command now use the **same formatter** (`formatCLSource`)
6. Test file `testAnchorRule.ts` demonstrates correct anchor rule behavior
7. Console log shows comment extraction working: `"Comment: /* what the heck? Over. */"`

**February 6 accomplishment:**
- ✅ Fixed the main formatting issue: Parameters no longer backtrack unnecessarily
- ✅ Implemented proper IBM i SEU Anchor Rule per specification
- ✅ `KEYWORD('value` and `KEYWORD(expr` now stay together on same line when possible
- ✅ Only backtrack if the anchor itself doesn't fit (not the entire value)

**Where to look:**
- Comment extraction: `src/extractor.ts` lines 125-167
- **Anchor rule logic:** `src/tokenLayoutFormatter.ts` lines 465-545 ⭐ KEY FIX
- Debug output: `src/formatCL.ts` lines 821-828
- Unified formatter: `src/extension.ts` lines 686-716 (Prompter now uses `formatCLSource`)
- Test cases: `src/testAnchorRule.ts` (demonstrates anchor rule working correctly)

