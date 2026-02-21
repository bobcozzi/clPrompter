# CLPrompter API for External Extensions

The CLPrompter extension provides a simple API that allows other VS Code extensions to programmatically invoke the CL prompter and receive the updated command string.

## Two Integration Approaches

You can integrate CLPrompter in two ways depending on your needs:

### Option 1: Optional Enhancement (Recommended)

Your extension works without CLPrompter but provides enhanced functionality when it's installed. This gives users flexibility.

**Benefits:**
- ✅ Your extension works for everyone
- ✅ Enhanced experience when CLPrompter is installed
- ✅ No forced dependency
- ✅ Users can install CLPrompter later if they want

**Setup:** Do NOT add to `extensionDependencies` in package.json. Instead, check for the extension at runtime:

```typescript
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');
if (clPrompterExt) {
    // Use CLPrompter
} else {
    // Fallback to simple input box or alternative UI
}
```

### Option 2: Required Dependency

CLPrompter is mandatory for your extension to work. VS Code will prompt users to install it automatically.

**Benefits:**
- ✅ Simpler code - no fallback logic needed
- ✅ Guaranteed full functionality
- ✅ VS Code handles installation prompts

**Setup:** Add to `package.json`:

```json
{
  "extensionDependencies": [
    "CozziResearch.clprompter"
  ]
}
```

## How the API Works

### Accessing CLPrompter from Your Extension

The CLPrompter extension exports its API through the extension's `activate()` function. To use it in your extension, you access it via VS Code's extension API:

```typescript
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

if (clPrompterExt) {
    if (!clPrompterExt.isActive) {
        await clPrompterExt.activate();
    }
    const { CLPrompter } = clPrompterExt.exports;
    // Now you can use CLPrompter
}
```

**How it works:**

1. **No npm package needed** - This is NOT an npm package. VS Code resolves it to the installed extension.
2. **Extension must be installed** - Users must have the CozziResearch.clprompter extension installed from the VS Code marketplace.
3. **Manual activation check** - Your code needs to ensure the extension is activated before accessing exports.
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
│     const ext = vscode.extensions.getExtension(...);        │
│     const { CLPrompter } = ext.exports;                     │
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
│    1. VS Code has CozziResearch.clprompter installed        │
│    2. Your code gets the extension via getExtension()       │
│    3. Activates it if needed                                │
│    4. Accesses exports.CLPrompter() function                │
│    5. Everything just works! ✓                              │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

**Key Point**: The `.d.ts` file is ONLY for TypeScript compilation. At runtime, VS Code handles everything automatically by finding the installed extension.

## Usage

### Method 1: Simple API (Recommended)

The simplest way to use the CLPrompter is by accessing it through the extension API:

```typescript
import * as vscode from 'vscode';

async function promptCommand(command: string): Promise<string | null> {
    // Get the CLPrompter extension
    const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

    if (!clPrompterExt) {
        vscode.window.showErrorMessage('CLPrompter extension not installed');
        return null;
    }

    // Ensure it's activated
    if (!clPrompterExt.isActive) {
        await clPrompterExt.activate();
    }

    // Access the exported API
    const { CLPrompter } = clPrompterExt.exports;

    if (typeof CLPrompter !== 'function') {
        vscode.window.showErrorMessage('CLPrompter API not available');
        return null;
    }

    // Prompt the command
    return await CLPrompter(command);
}

// Use it
const result = await promptCommand('CRTPF FILE(MYLIB/MYFILE)');

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
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');
if (clPrompterExt?.isActive) {
    const { CLPrompter } = clPrompterExt.exports;
    const result = await CLPrompter(
        context.extensionUri,  // Your extension's URI (optional)
        'CRTPF FILE(MYLIB/MYFILE)'
    );
}
```

### Method 3: Callback API

If you prefer callbacks over promises:

```typescript
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');
if (clPrompterExt?.isActive) {
    const { CLPrompterCallback } = clPrompterExt.exports;
    CLPrompterCallback(
        context.extensionUri,
        'CRTPF FILE(MYLIB/MYFILE)',
        (result) => {
            if (result) {
                console.log('Result:', result);
            }
        }
    );
}
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

      // Get the CLPrompter extension
      const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

      if (!clPrompterExt) {
        vscode.window.showErrorMessage('CLPrompter extension not installed');
        return;
      }

      // Ensure it's activated
      if (!clPrompterExt.isActive) {
        await clPrompterExt.activate();
      }

      try {
        // Access the exported API
        const { CLPrompter } = clPrompterExt.exports;

        if (typeof CLPrompter !== 'function') {
          vscode.window.showErrorMessage('CLPrompter API not available');
          return;
        }

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

Choose the integration approach that fits your needs:

### Quick Start: Option 1 - Optional Enhancement

**Step 1: Create Type Definitions (Optional, for IntelliSense)**

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

**Step 2: Use with Fallback in Your Code**

```typescript
import * as vscode from 'vscode';

async function promptCommand(command: string): Promise<string | null> {
    const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

    if (clPrompterExt) {
        if (!clPrompterExt.isActive) {
            await clPrompterExt.activate();
        }

        if (clPrompterExt.exports?.CLPrompter) {
            try {
                return await clPrompterExt.exports.CLPrompter(command);
            } catch (error) {
                console.error('CLPrompter error:', error);
            }
        }
    }

    // Fallback: Simple input box
    return await vscode.window.showInputBox({
        prompt: 'Edit CL Command',
        value: command,
        placeHolder: 'Install CozziResearch.clprompter for full prompting'
    }) || command;
}
```

**Step 3: Optionally Recommend the Extension**

In your extension's README or when users first use the feature, you can suggest installing CLPrompter for the best experience.

That's it! Your extension works for everyone with graceful enhancement.

---

### Quick Start: Option 2 - Required Dependency

**Step 1: Update package.json**

Add the extension dependency:
```json
{
  "name": "your-extension",
  "extensionDependencies": [
    "CozziResearch.clprompter"
  ]
}
```

**Step 2: Create Type Definitions**

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
import * as vscode from 'vscode';

// In your command handler
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

if (clPrompterExt) {
  if (!clPrompterExt.isActive) {
    await clPrompterExt.activate();
  }

  const { CLPrompter } = clPrompterExt.exports;

  if (typeof CLPrompter === 'function') {
    const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');
    if (result && result !== 'CRTPF FILE(MYLIB/MYFILE)') {
      console.log('Updated:', result);
    }
  }
}
```

### Step 4: Test

1. Install **CozziResearch.clprompter** extension from marketplace (if testing)
2. Press F5 to run your extension
3. Call your command - the prompter will open automatically!

**Note:** When declared as a required dependency, VS Code will automatically prompt users to install CLPrompter if it's missing.

---

**Key Difference:**
- **Option 1 (Optional):** Users can use your extension without CLPrompter installed - it falls back to a simple input box
- **Option 2 (Required):** VS Code forces users to install CLPrompter before using your extension - full prompter always available

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

// Access the API
const { CLPrompter } = clPrompterExt.exports;

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
import * as vscode from 'vscode';

interface BuildStep {
    name: string;
    command: string;
}

const buildSteps: BuildStep[] = [
    { name: 'Create Program', command: 'CRTBNDRPG PGM(MYLIB/MYPGM) SRCFILE(QRPGLESRC)' },
    { name: 'Create Service Program', command: 'CRTSRVPGM SRVPGM(MYLIB/MYSRVPGM)' },
    { name: 'Create Binding Directory', command: 'CRTBNDDIR BNDDIR(MYLIB/MYBNDDIR)' }
];

// Get CLPrompter
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');
if (!clPrompterExt) return;

if (!clPrompterExt.isActive) {
    await clPrompterExt.activate();
}

const { CLPrompter } = clPrompterExt.exports;

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

async function promptCommand(command: string): Promise<string | null> {
    // Check if clPrompter is available
    const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

    if (clPrompterExt) {
        // clPrompter is installed - use it
        if (!clPrompterExt.isActive) {
            await clPrompterExt.activate();
        }

        if (clPrompterExt.exports) {
            const CLPrompter = clPrompterExt.exports.CLPrompter;

            if (typeof CLPrompter === 'function') {
                try {
                    return await CLPrompter(command);
                } catch (error) {
                    console.error('CLPrompter error:', error);
                    // Fall through to fallback
                }
            }
        }
    }

    // Fallback: Simple input box if extension not installed or error occurred
    return await vscode.window.showInputBox({
        prompt: 'Edit CL Command',
        value: command,
        placeHolder: 'Install CozziResearch.clprompter for full IBM i prompting',
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

// In your code - access via extension API
import * as vscode from 'vscode';

const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter')!;
if (!clPrompterExt.isActive) {
    await clPrompterExt.activate();
}

const { CLPrompter } = clPrompterExt.exports;
const result = await CLPrompter('CRTPF FILE(MYLIB/MYFILE)');
```

VS Code will automatically prompt users to install the extension if it's missing.

## Features

The CLPrompter API provides:

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

When you publish your extension that uses CLPrompter, requirements depend on your integration choice:

### If Using Option 1 (Optional Enhancement):

✅ **Users need to install:**
1. Your extension
2. halcyontechltd.code-for-ibmi (Code for IBM i)

✅ **Optionally can install for enhanced experience:**
- CozziResearch.clprompter (from marketplace)

✅ **Your extension works either way** - with graceful fallback to simple input box

### If Using Option 2 (Required Dependency):

✅ **Users MUST have these extensions installed:**
1. Your extension
2. CozziResearch.clprompter (from marketplace)
3. halcyontechltd.code-for-ibmi (Code for IBM i)

✅ **VS Code will prompt users** to install missing dependencies automatically when they install your extension (thanks to `extensionDependencies`).

### In Both Cases:

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
