# CLPrompter API for External Extensions

The CLPrompter extension provides a simple API that allows other VS Code extensions to programmatically invoke the CL prompter and receive the updated command string.

## Installation

First, ensure your extension declares a dependency on the clPrompter extension in your `package.json`:

```json
{
  "extensionDependencies": [
    "CozziResearch.clprompter"
  ]
}
```

## How the Import Works

### Runtime Import (The Extension Itself)

When you write:
```typescript
import { CLPrompter } from 'CozziResearch.clprompter';
```

This import is resolved **at runtime** by VS Code's extension host. Here's what happens:

1. **No npm package needed** - This is NOT an npm package import. VS Code resolves it to the installed extension.
2. **Extension must be installed** - Users must have the CozziResearch.clprompter extension installed from the VS Code marketplace.
3. **Automatic activation** - When your extension imports from another extension, VS Code automatically activates that extension first.
4. **Access to exports** - You get access to whatever the extension exported from its `activate()` function.

**Important**: The extension itself just needs to be *installed* - no additional source code downloads required at runtime!

### TypeScript Type Definitions (For Development)

For **TypeScript compilation** to work, you need type definitions. There are two approaches:

#### Option 1: Declare Types Manually (Simplest)

Create a file `clprompter.d.ts` in your extension's source directory:

```typescript
// clprompter.d.ts
declare module 'CozziResearch.clprompter' {
  import * as vscode from 'vscode';

  /**
   * Prompt a CL command and return the updated command string
   * @param commandString - The CL command to prompt
   * @returns Promise with updated command string or original if cancelled
   */
  export function CLPrompter(commandString: string): Promise<string | null>;

  /**
   * Prompt a CL command and return the updated command string
   * @param extensionUri - The URI of the calling extension
   * @param commandString - The CL command to prompt
   * @returns Promise with updated command string or original if cancelled
   */
  export function CLPrompter(
    extensionUri: vscode.Uri,
    commandString: string
  ): Promise<string | null>;

  /**
   * Callback-based version of CLPrompter
   * @param extensionUri - The URI of the calling extension
   * @param commandString - The CL command to prompt
   * @param callback - Called with the result
   */
  export function CLPrompterCallback(
    extensionUri: vscode.Uri,
    commandString: string,
    callback: (result: string | null) => void
  ): void;
}
```

Then just use it in your code - TypeScript will compile successfully:

```typescript
import { CLPrompter } from 'CozziResearch.clprompter';

const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');
```

#### Option 2: Copy Type Files from Repository (Advanced)

If you want the complete type definitions:

1. Download these files from the [clPrompter repository](https://github.com/bobcozzi/clPrompter):
   - `src/clPrompter.ts` (or just the exported function signatures)
   - `src/types.ts` (if you need detailed types)

2. Place them in your extension's type definitions directory (e.g., `typings/`)

3. Reference them in your `tsconfig.json`:
   ```json
   {
     "compilerOptions": {
       "typeRoots": ["./typings", "./node_modules/@types"]
     }
   }
   ```

**Note**: This is optional and only needed for enhanced IntelliSense. The simple declaration from Option 1 is sufficient for most cases.

## Summary: What Developers Need

### At Development Time (TypeScript compilation):
- ✅ Add type declaration file (`clprompter.d.ts`) to their project (Option 1 above)
- ✅ OR copy type files from the repository (Option 2 above)

### At Runtime:
- ✅ Declare `extensionDependencies` in package.json
- ✅ Users must have **CozziResearch.clprompter extension installed** (from VS Code marketplace)
- ❌ NO source code download needed
- ❌ NO npm package installation needed
- ❌ NO manual file copying needed

**The extension import is resolved entirely by VS Code - it's not npm, not GitHub, just the VS Code extension system!**

## How It Works: Visual Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Your Extension Development                                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. package.json:                                            │
│     "extensionDependencies": ["CozziResearch.clprompter"]   │
│                                                               │
│  2. src/clprompter.d.ts:                                     │
│     declare module 'CozziResearch.clprompter' { ... }       │
│                                                               │
│  3. Your code:                                               │
│     import { CLPrompter } from 'CozziResearch.clprompter';  │
│     const result = await CLPrompter('CRTPF FILE(...)');     │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    TypeScript compiles ✓
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  End User's VS Code                                          │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Installed Extensions:                                       │
│    ✓ Your Extension                                          │
│    ✓ CozziResearch.clprompter (from marketplace)           │
│    ✓ halcyontechltd.code-for-ibmi                          │
│                                                               │
│  When your extension runs:                                   │
│    1. VS Code activates CozziResearch.clprompter            │
│    2. Import resolves to extension's exports                │
│    3. CLPrompter() function is available                    │
│    4. Everything just works! ✓                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Point**: The `.d.ts` file is ONLY for TypeScript compilation. At runtime, VS Code handles everything automatically by finding the installed extension.

## Usage

### Method 1: Simple API (Recommended)

The simplest way to use the CLPrompter is with just a command string. The extension will automatically find the clPrompter extension and handle all the setup:

```typescript
import { CLPrompter } from 'CozziResearch.clprompter';

// Prompt a CL command
const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');

if (result && result !== 'CRTPF FILE(MYLIB/MYFILE)') {
  // User submitted changes
  console.log('Updated command:', result);
} else {
  // User cancelled or no changes made
  console.log('Command unchanged');
}
```

### Method 2: Explicit Extension URI

If you prefer to pass the extension URI explicitly, you can use this overload:

```typescript
import * as vscode from 'vscode';
import { CLPrompter } from 'CozziResearch.clprompter';

const result = await CLPrompter(
  context.extensionUri,  // Your extension's URI (not required)
  'CRTPF FILE(MYLIB/MYFILE)'
);
```

### Method 3: Callback API

If you prefer callbacks over promises:

```typescript
import { CLPrompterCallback } from 'CozziResearch.clprompter';

CLPrompterCallback(
  context.extensionUri,
  'CRTPF FILE(MYLIB/MYFILE)',
  (result) => {
    if (result) {
      console.log('Result:', result);
    }
  }
);
```

## Return Values

The `CLPrompter` function returns a Promise that resolves with:

- **Updated command string** - if the user makes changes and clicks OK
- **Original command string** - if the user cancels without making changes
- **null** - if an error occurs (rare)

## Complete Example

Here's a complete example of a command that prompts a CL command:

```typescript
import * as vscode from 'vscode';
import { CLPrompter } from 'CozziResearch.clprompter';

export function activate(context: vscode.ExtensionContext) {
  const disposable = vscode.commands.registerCommand(
    'myExtension.promptCommand',
    async () => {
      // Get command from user input or current editor
      const command = await vscode.window.showInputBox({
        prompt: 'Enter CL command',
        value: 'CRTPF FILE(MYLIB/MYFILE)'
      });

      if (!command) {
        return;
      }

      try {
        // Prompt the command
        const result = await CLPrompter(command);

        if (result && result !== command) {
          // User made changes
          vscode.window.showInformationMessage(
            `Command updated to: ${result}`
          );

          // Insert into active editor or use the result
          const editor = vscode.window.activeTextEditor;
          if (editor) {
            editor.edit(editBuilder => {
              editBuilder.insert(editor.selection.active, result);
            });
          }
        } else if (result === command) {
          // User cancelled
          vscode.window.showInformationMessage('Prompt cancelled');
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `CLPrompter error: ${error}`
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}
```

## Quick Start Guide for Extension Developers

Here's a complete step-by-step guide to add CLPrompter support to your extension:

### Step 1: Update package.json

Add the extension dependency:
```json
{
  "name": "your-extension",
  "extensionDependencies": [
    "CozziResearch.clprompter"
  ]
}
```

### Step 2: Create Type Definitions

Create `src/clprompter.d.ts` in your extension:
```typescript
declare module 'CozziResearch.clprompter' {
  import * as vscode from 'vscode';

  export function CLPrompter(commandString: string): Promise<string | null>;
  export function CLPrompter(
    extensionUri: vscode.Uri,
    commandString: string
  ): Promise<string | null>;
}
```

### Step 3: Use in Your Code

```typescript
import { CLPrompter } from 'CozziResearch.clprompter';

// In your command handler
const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');
if (result && result !== 'CRTPF FILE(MYLIB/MYFILE)') {
  console.log('Updated:', result);
}
```

### Step 4: Test

1. Install **CozziResearch.clprompter** extension from marketplace
2. Press F5 to run your extension
3. Call your command - the prompter will open automatically!

That's it! No npm packages, no source downloads, no complex setup.

## Real-World Use Case: Prompting Build Commands

This API is perfect for scenarios where you need to let users edit CL commands programmatically, such as:
- Build/compilation scripts
- IBM i "make" tools
- Command configuration dialogs
- Migration from RDi CLPrompter

### Example: Migrating from RDi CLPrompter

**Original RDi Java Code:**
```java
IBMiConnection system = subsystem.getConnection();
CLPrompter cp = new CLPrompter(shell, system, compileCommand);

if(cp.showDialog() == CLPrompter.OK) {
    compileCommand = cp.getCommandString();
    // Run compile...
} else {
    okToRun = false;
}
```

**VS Code Equivalent (Much Simpler!):**
```typescript
import * as vscode from 'vscode';
import { CLPrompter } from 'CozziResearch.clprompter';

// Check if clPrompter is installed
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');
if (!clPrompterExt) {
    vscode.window.showErrorMessage('CL Prompter extension not installed');
    return;
}

// Ensure it's activated
if (!clPrompterExt.isActive) {
    await clPrompterExt.activate();
}

// Prompt the command (no editor document needed!)
let compileCommand = 'CRTBNDRPG PGM(MYLIB/MYPGM) SRCFILE(QRPGLESRC)';
const result = await CLPrompter(compileCommand);

if (result && result !== compileCommand) {
    // User made changes - update and run
    compileCommand = result;
    console.log('Running updated command:', compileCommand);
    // ... run compile
} else if (result === compileCommand) {
    // User cancelled (no changes)
    console.log('User cancelled prompt');
} else {
    // Error occurred
    console.log('Prompter error');
}
```

**Key Advantages:**
- ✅ No editor document required (no `openTextDocument()` or `showTextDocument()`)
- ✅ No file save dialogs
- ✅ Clean async/await API
- ✅ Works with any CL command string
- ✅ No webview code in your extension
- ✅ Returns the exact command string to execute

### Example: Multiple Commands in a Build Script

```typescript
import { CLPrompter } from 'CozziResearch.clprompter';

interface BuildStep {
    name: string;
    command: string;
}

const buildSteps: BuildStep[] = [
    { name: 'Create Program', command: 'CRTBNDRPG PGM(MYLIB/MYPGM) SRCFILE(QRPGLESRC)' },
    { name: 'Create Service Program', command: 'CRTSRVPGM SRVPGM(MYLIB/MYSRVPGM)' },
    { name: 'Create Binding Directory', command: 'CRTBNDDIR BNDDIR(MYLIB/MYBNDDIR)' }
];

// Let user select and prompt any step
const selected = await vscode.window.showQuickPick(
    buildSteps.map(s => s.name),
    { placeHolder: 'Select build step to prompt' }
);

if (selected) {
    const step = buildSteps.find(s => s.name === selected)!;

    // Prompt the selected command
    const updated = await CLPrompter(step.command);

    if (updated && updated !== step.command) {
        // Update the build step
        step.command = updated;
        vscode.window.showInformationMessage(`Updated: ${step.name}`);

        // Optionally save to configuration
        // await saveConfig(buildSteps);
    }
}
```

### Example: With Fallback for Users Without Extension

```typescript
import * as vscode from 'vscode';
import { CLPrompter } from 'CozziResearch.clprompter';

async function promptCommand(command: string): Promise<string | null> {
    // Check if clPrompter is available
    const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

    if (clPrompterExt) {
        // clPrompter is installed - use it
        if (!clPrompterExt.isActive) {
            await clPrompterExt.activate();
        }

        try {
            return await CLPrompter(command);
        } catch (error) {
            console.error('CLPrompter error:', error);
            // Fall through to manual input
        }
    }

    // Fallback: Simple input box if extension not installed or error occurred
    return await vscode.window.showInputBox({
        prompt: 'Edit CL Command (Install CozziResearch.clprompter for full prompter)',
        value: command,
        validateInput: (value) => {
            return value.trim() === '' ? 'Command cannot be empty' : null;
        }
    }) || command;
}

// Use it
const editedCommand = await promptCommand('CRTPF FILE(MYLIB/MYFILE)');
```

**This approach allows:**
- Graceful degradation if clPrompter isn't installed
- Full prompter experience when available
- Simple input box as fallback
- Your extension works either way

**Alternative: Make CLPrompter Required**

If you want to require the CLPrompter extension (simpler approach):

```typescript
// In your package.json
{
  "extensionDependencies": [
    "CozziResearch.clprompter"
  ]
}

// In your code - just use it directly!
import { CLPrompter } from 'CozziResearch.clprompter';

const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');
```

VS Code will automatically prompt users to install the extension if it's missing.
- **Parameter Validation** - Validates parameters according to command definitions
- **Special Values** - Provides dropdowns for parameters with special values
- **CL Variables** - Supports CL variables (&VAR) in parameter values
- **Nested Prompting** - Supports F4 prompting for nested commands (e.g., CMD parameters)
- **Cancel Support** - Returns original command if user cancels
- **Error Handling** - Returns original command on errors

## Requirements

- Code for IBM i extension must be installed and connected to an IBM i system
- The clPrompter extension must be installed and activated
- Connection to IBM i is required to retrieve command definitions

## API Reference

### CLPrompter(commandString: string): Promise<string | null>

Prompts a CL command and returns the updated command string.

**Parameters:**
- `commandString` - The CL command to prompt (e.g., "CRTPF FILE(MYLIB/MYFILE)")

**Returns:**
- Promise that resolves with the updated command string, original command if cancelled, or null on error

### CLPrompter(extensionUri: vscode.Uri, commandString: string): Promise<string | null>

Alternative signature that accepts an explicit extension URI (for advanced use).

### CLPrompterCallback(extensionUri: vscode.Uri, commandString: string, callback: Function): void

Callback-based API as an alternative to Promises.

## Troubleshooting

### TypeScript Compilation Error: "Cannot find module 'CozziResearch.clprompter'"

**Cause**: TypeScript doesn't have the type definitions.

**Solution**: Create the `clprompter.d.ts` file (see Step 2 in Quick Start Guide above).

### Runtime Error: "CLPrompter extension not found"

**Cause**: The extension isn't installed.

**Solution**:
- Install **CozziResearch.clprompter** from the VS Code marketplace
- Add `"CozziResearch.clprompter"` to your `extensionDependencies` in package.json
- Ensure users of your extension also have it installed

### Error: "CLPrompter not initialized"

**Cause**: The extension hasn't been activated yet.

**Solution**: This should happen automatically if you declared the dependency. If not:
```typescript
// Manually ensure extension is activated
const ext = vscode.extensions.getExtension('CozziResearch.clprompter');
if (ext && !ext.isActive) {
  await ext.activate();
}
```

### Import Works at Runtime but Not in TypeScript

**Cause**: This is expected! Runtime resolution is handled by VS Code, compilation needs type definitions.

**Solution**: Create the `clprompter.d.ts` type declaration file as shown above.

## What Users of Your Extension Need

When you publish your extension that uses CLPrompter:

✅ **Users MUST have these extensions installed:**
1. Your extension
2. CozziResearch.clprompter (from marketplace)
3. halcyontechltd.code-for-ibmi (Code for IBM i)

✅ **VS Code will prompt users** to install missing dependencies automatically when they install your extension (thanks to `extensionDependencies`).

❌ **Users do NOT need:**
- Source code
- npm packages
- Manual file downloads
- GitHub repository access

## Support

For issues or feature requests, please visit:
https://github.com/bobcozzi/clPrompter

## License

This API is provided as part of the clPrompter extension and follows the same license terms.
