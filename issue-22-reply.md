The `CLPrompter()` API was **not** removed — but its return type changed in v1.0.48 and the docs weren't updated. That's on me; it's fixed now.

**What changed:** `CLPrompter()` used to resolve with `Promise<string | null>`. It now resolves with `Promise<CLPrompterResult>`:

```ts
interface CLPrompterResult {
    command: string;   // updated on submit; original on cancel/error
    action: 'submit' | 'cancel' | 'error';
}
```

**Migration is one line** — `result.command` is always safe to use:

```ts
// Before
const newCommand = await CLPrompter(command);
if (null !== newCommand) { command = newCommand; }

// After
const result = await CLPrompter(command);
command = result.command;
```

**Handling all three outcomes** (not possible with the old API):

```ts
const result = await CLPrompter(command);

switch (result.action) {
    case 'submit':
        // User made changes — use the updated command
        command = result.command;
        break;
    case 'cancel':
        // User cancelled — result.command is the original command
        return '';
    case 'error':
        // Error (e.g., command definition not found) — result.command is the original
        console.error('CLPrompter failed for:', command);
        return '';
}
```

Updated API docs are in v1.0.64. The error in your log (`CMD_XML ... type *N not found`) means the `CMD_XML` UDTF isn't installed on that IBM i host — the prompter fell back to `QCDRCMDD` which also failed. If the host is at the latest component level, let me know and I'll dig into it separately.
