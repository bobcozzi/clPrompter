# CL Prompt — Prompt IBM i CL Commands (PREVIEW)

A professional CL (Control Language) prompter for VS Code that brings the familiar IBM i F4 CL prompter experience to your modern development environment. Works seamlessly with the vscode-for-ibmi extension (Code4i/Code4IBMi).
**CURRENTLY in PREVIEW** so keep your Cmd+Z (or Ctrl+Z on Windows) UNDO key ready.

## Getting Started

To prompt a CL command:
1. Open a CLP, CLLE, CMD, or BND source member.
2. Place your cursor on the line with the command you want to prompt.
3. Press **F4** or use the context menu right-click -> "CL Prompter" to prompt.
4. Fill in the parameters in the prompter.
5. Press **Enter** to update your code or **F3/Cancel** to cancel (the `ESC` key also cancels).

## Features

### Enhanced User Experience
- **Visual Focus Indicator** — Clear arrow (▶) indicator shows which input field currently has focus, making it easy to navigate through complex command parameters
- **Tab Navigation** — Press TAB to move seamlessly between input fields, just like traditional 5250 prompting
- **Comment Preservation** — Trailing comments on your CL commands are automatically preserved and properly formatted when you submit the prompter
- **F3=Cancel** — Press F3 during prompting to cancel and return to your code without changes
- **Enter=Apply** - Press Enter during a prompter to apply the changes to the CL source

### Intelligent Formatting
- **ELEM Parameter Handling** — Complex ELEM parameters (like LOG, EXTRA, etc.) stay together on a single line when possible for better readability
- **Multi-line Comment Support** — Long comments are automatically wrapped and properly indented on continuation lines
- **Qualified Name Formatting** — Properly handles qualified objects like LIB/OBJECT throughout the prompter

### Customization & Configuration
- **Theme-Aware Colors** — Keyword and value colors automatically adapt to your VS Code theme (light/dark/high-contrast) or use your custom colors
- **Configurable Formatting** — Control label position, command position, keyword position, continuation position, and right margin
- **Case Conversion** — Choose between uppercase, lowercase, or no case conversion for your CL code
- **Custom Color Settings** — Set your preferred colors for keywords and values with optional automatic theme adjustment

### Diagnostic Tools (for troubleshooting)
- **Save Command XML** — Optionally save the IBM i command definition XML to a file for analysis
- **Save Prompter HTML** — Optionally save the generated prompter HTML for diagnostic purposes when reporting issues

## Links

- [Source Code](https://github.com/bobcozzi/clPrompter)
- [Issues](https://github.com/bobcozzi/clPrompter/issues)

## Contributing

Contributions are welcome! To contribute:

1. Fork this repository and clone it locally.
2. Create a new branch for your feature or bugfix.
3. Make your changes, then commit and push to your branch.
4. Open a [pull request](https://github.com/bobcozzi/clPrompter/pulls) describing your changes.

For bug reports or feature requests, please open an issue in the [Issues](https://github.com/bobcozzi/clPrompter/issues) page.

- If you are unsure or have questions, feel free to start a discussion or reach out via issues.

Thanks for your interest in improving CL Prompter!

-Bob

