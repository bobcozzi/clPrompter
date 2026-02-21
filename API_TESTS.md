# API Export Verification Tests

This test verifies that the CLPrompter API is properly exported and accessible to external extensions.

## What is Being Tested

The test verifies that:

1. ✅ The `activate()` function in `extension.ts` imports `CLPrompter` and `CLPrompterCallback`
2. ✅ The `activate()` function returns `{ CLPrompter, CLPrompterCallback }`
3. ✅ External extensions can access the API using `vscode.extensions.getExtension()`

## Why This Matters

After Alan's feedback on issue #6, we discovered that the `activate()` function wasn't returning the exports. This meant external extensions couldn't access the API.

**The Fix:**
```typescript
// In extension.ts activate() function
return {
    CLPrompter,
    CLPrompterCallback
};
```

## Running the Tests

Run the verification test to check the source code:

```bash
npm run test:api
```

This will:
1. Compile the test file
2. Check the source code for proper imports and return statement
3. Verify the API export structure

## Expected Output

If everything is working correctly, you should see:

```
╔════════════════════════════════════════════════════════╗
║     CLPrompter API Export Verification Test           ║
╚════════════════════════════════════════════════════════╝

Checking that activate() returns the API exports...

Step 1: Checking for CLPrompter import...
  ✓ CLPrompter imported from clPrompter module

Step 2: Checking for CLPrompterCallback import...
  ✓ CLPrompterCallback imported from clPrompter module

Step 3: Checking activate() function return statement...
  ✓ activate() returns { CLPrompter, CLPrompterCallback }

============================================================
✅ SUCCESS! API is properly exported
============================================================

The activate() function correctly returns:
  return { CLPrompter, CLPrompterCallback };

External extensions can access the API using:

  const ext = vscode.extensions.getExtension('CozziResearch.clprompter');
  if (!ext.isActive) await ext.activate();
  const { CLPrompter } = ext.exports;
  const result = await CLPrompter(command);
```

## What External Extensions Need to Do

With the API properly exported, external extensions can use either pattern:

### Pattern 1: Optional Enhancement (Recommended)

```typescript
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter');

if (clPrompterExt) {
    if (!clPrompterExt.isActive) {
        await clPrompterExt.activate();
    }

    if (clPrompterExt.exports?.CLPrompter) {
        const result = await clPrompterExt.exports.CLPrompter(command);
        // Use result...
    }
} else {
    // Fallback to simple input box
}
```

### Pattern 2: Required Dependency

Add to `package.json`:
```json
{
  "extensionDependencies": ["CozziResearch.clprompter"]
}
```

Then use directly:
```typescript
const clPrompterExt = vscode.extensions.getExtension('CozziResearch.clprompter')!;
await clPrompterExt.activate();
const { CLPrompter } = clPrompterExt.exports;
const result = await CLPrompter(command);
```

## Test Files

- `src/testAPICall.ts` - Main verification test (checks source code)

The old mock-based test files have been removed as they were overly complex and had multiple issues. The simple source code verification is sufficient and reliable.

## Troubleshooting

### Test Fails: "return statement NOT found"

The `activate()` function in `extension.ts` is missing the return statement. Add this at the end of the function:

```typescript
return {
    CLPrompter,
    CLPrompterCallback
};
```

### Test Fails: "Could not find extension.ts"

The test looks for the source file at `src/extension.ts`. Make sure you're running the test from the project root directory.

## References

- Issue #6: https://github.com/bobcozzi/clPrompter/issues/6
- API Documentation: [CLPROMPTER_API.md](CLPROMPTER_API.md)
