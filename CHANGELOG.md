# Changelog

All notable changes to this project will be documented in this file.

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
