# Changelog

All notable changes to this project will be documented in this file.

## [0.0.40] - 2026-02-03
### Added
- **Visual Focus Indicator**: Arrow (▶) appears at the right edge of field labels to clearly show which input has focus
- **Tab Navigation**: TAB key now moves sequentially between input fields for efficient keyboard navigation
- **Diagnostic Settings**: New settings for saving command XML and prompter HTML to assist with troubleshooting:
  - `clPrompter.saveCmdXMLtoFile` - Save command definition XML (default: false)
  - `clPrompter.savedCmdXMLFileLocation` - Configure where XML files are saved
  - `clPrompter.savePrompterHTMLtoFile` - Save prompter HTML for diagnostics (default: false)
  - `clPrompter.savedPrompterHTMLFileLocation` - Configure where HTML files are saved
  - All location settings support variables: `${tmpdir}`, `${userHome}`, `${workspaceFolder}`
  - Nested prompting is now supported. Commands like SBMJOB that have a CMD parameter can have the command in that parameter prompted as well. This is called `nested prompting`.

### Changed
- **Improved Comment Handling**: Trailing comments on CL commands are now properly preserved and formatted
  - Multi-line comments are correctly indented on continuation lines
  - Comment indentation fixed to use proper column positioning (contCol-1 for 0-based indexing)
- **Enhanced ELEM Parameter Formatting**: ELEM parameters (LOG, EXTRA, etc.) now stay together on one line when possible
  - Fixed detection of ELEM parameters stored as expression objects
  - Added atomic value protection to prevent internal line breaks
  - Improved preemptive wrapping logic for better readability
- **Renamed Settings** (for clarity):
  - `enableDebugXml` → `saveCmdXMLtoFile`
  - `debugXmlPath` → `savedCmdXMLFileLocation`

### Fixed
- **Initial Focus State**: Focus indicator now appears correctly on the first field (clLabel) when prompter opens
- **Tab Order**: cbInput dropdown buttons no longer interfere with tab navigation (tabIndex=-1)
- **Comment Indentation**: Fixed extra space issue in continuation lines of multi-line comments
- **ELEM Parameter Breaking**: Resolved issue where ELEM parameters were wrapping internally despite being marked atomic
  - Corrected token extraction from expression objects
  - Added formatValue-level protection against chunking
  - Improved fullParamText construction for accurate matching

### Technical Improvements
- Refactored focus indicator implementation with blur/refocus cycle for correct initial state
- Now prompt all command parameter variations.
- Enhanced tab order configuration with proper tabindex management for all input elements
- Improved atomic value detection for complex parameter types
- Added comprehensive token filtering and joining for expression object parameters

## [0.0.13] - 2025-07-06
### Changed
- All hardcoded color styles was removed from JavaScript; all visual styling is now handled in CSS using VS Code theme variables.
- Added `.nested-elem-group` CSS class to `style.css` for theme-aware background, border, and foreground, matching `.elem-group` and `.qual-group`.
- Updated `main.js` to only set the class for nested ELEM fieldsets, with no inline style properties.

### Fixed
- Ensured nested ELEM group appearance is consistent and accessible in all VS Code theme modes (light, dark, high-contrast).

### Notes
- You can now further refine the `.nested-elem-group` style in `style.css` for spacing or contrast as needed. All color and border logic is now theme-driven.

### Added
- New `kwdColorAutoAdjust` setting: allows users to control whether the keyword highlight color is auto-adjusted for contrast between different VS Code themes or strictly uses their custom user-specified color (specified on the existing `kwdColor` setting).
- `F3=Cancel` is now enabled during prompting, giving end-users a more natural "muscle memory" way of cancelling out of the prompter.

## [0.0.12] - 2025-07-05
### Added
- Initial CHANGELOG.md file.

### Changed
- Major refactor of the webview JavaScript:
  - Migrated all inline scripts from `prompter.html` into a single ES module entry point (`main.js`).
  - All helper logic is now modularized and imported via ES modules (`tooltips.js`, `promptHelpers.js`).
  - All function calls to helpers/tooltips are now properly qualified with their module namespace.
  - Removed duplicate and incomplete function definitions (notably `setElementValue`).
  - Added missing utility functions (e.g., `isContainerType`).
  - Fixed all references to `currentTooltip` and other helper state to use the correct module namespace.
  - Fixed typo: replaced all `toolTips` with `tooltips` for correct module usage.
- Updated `prompter.html` to only load `main.js` as a module, removing all inline scripts.

### Fixed
- Resolved runtime errors due to missing or unqualified helper/module references.
- Fixed ReferenceError for `toolTips` (now `tooltips`).
- Fixed ReferenceError for `isContainerType` and `setElementValue`.
- Fixed issues with tooltip display and hiding after modularization.

### Notes
- This version is not yet considered stable for public use. See README for details.

---

## [0.0.11] - 2024-??-??
- Previous versions (see earlier commit history for details).
