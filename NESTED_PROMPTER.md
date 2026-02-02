# Nested Prompter Feature

## Overview
The nested prompter feature allows you to press **F4** within a CMD/CMDSTR textarea field to open a new prompter for that nested command. When you submit the nested prompter, it returns the completed command string (unformatted) back to the parent prompter's textarea.

## How to Use

1. Open a CL command that has a CMD or CMDSTR parameter (e.g., `SBMJOB CMD()`)
2. In the prompter, enter a command name in the CMD/CMDSTR textarea (e.g., `CALL PGM(MYPGM)`)
3. Press **F4** while the cursor is in that textarea
4. A new prompter opens in a side-by-side panel titled with "(nested)"
5. Fill in the parameters for the nested command
6. Click **Submit**
7. The completed command string is returned to the parent prompter's textarea (unformatted)

## Technical Implementation

### Extension Side (extension.ts)

#### New Method: `promptNestedCommand()`
```typescript
public static async promptNestedCommand(
    extensionUri: vscode.Uri,
    commandString: string,
    parentPanel: ClPromptPanel
): Promise<string | null>
```
- Creates a new webview panel for the nested command
- Extracts the command name from the command string
- Gets the XML definition for that command
- Returns a Promise that resolves when the user submits or cancels
- Panel title includes "(nested)" to distinguish from regular prompter

#### Constructor Updates
- Added `isNested?: boolean` parameter
- Added `nestedResolver?: (value: string | null) => void` parameter
- Stores these in private fields `_isNested` and `_nestedResolver`

#### Message Handlers

**New: 'promptNested'**
```typescript
case 'promptNested': {
    const result = await ClPromptPanel.promptNestedCommand(
        this._extensionUri,
        message.commandString,
        this
    );
    this._panel.webview.postMessage({
        type: 'nestedResult',
        fieldId: message.fieldId,
        commandString: result
    });
    break;
}
```
- Receives request from webview to prompt a nested command
- Opens nested prompter and waits for result
- Sends result back to parent webview

**Updated: 'submit'**
```typescript
if (this._isNested && this._nestedResolver) {
    this._nestedResolver(cmd);
    this._panel.dispose();
    break;
}
```
- If this is a nested prompter, resolves the promise with the unformatted command
- Disposes the panel immediately (doesn't try to insert into editor)

**Updated: 'cancel'**
```typescript
case 'cancel': {
    if (this._isNested && this._nestedResolver) {
        this._nestedResolver(null);
    }
    this._panel.dispose();
    break;
}
```
- If nested, resolves promise with null on cancel

### Webview Side (prompter.js)

#### F4 Key Detection
Added to both locations where CMD/CMDSTR textareas are created:
```javascript
if (isCmdType) {
    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'F4') {
            e.preventDefault();
            const commandString = textarea.value.trim();
            if (commandString) {
                vscode?.postMessage({
                    type: 'promptNested',
                    fieldId: name,
                    commandString: commandString
                });
            }
        }
    });
}
```
- Detects F4 key press on CMD/CMDSTR textareas
- Sends 'promptNested' message with field ID and command string

#### Message Handler: 'nestedResult'
```javascript
else if (message.type === 'nestedResult') {
    console.log('[clPrompter] Received nested result for field:',
        message.fieldId, 'value:', message.commandString);
    if (message.commandString && message.fieldId) {
        const field = document.querySelector(`[name="${message.fieldId}"]`);
        if (field && (field.tagName === 'TEXTAREA' || field.tagName === 'INPUT')) {
            field.value = message.commandString;
            field.focus();
            state.touchedFields.add(message.fieldId);
        }
    }
}
```
- Receives the completed command from nested prompter
- Updates the appropriate textarea field
- Focuses the field and marks it as touched

## Message Flow

1. **User presses F4** in CMD/CMDSTR textarea
   ```
   Webview → Extension: { type: 'promptNested', fieldId: 'CMD', commandString: 'CALL PGM(MYPGM)' }
   ```

2. **Extension creates nested prompter**
   - Calls `ClPromptPanel.promptNestedCommand()`
   - Opens new panel with command XML
   - Waits for promise to resolve

3. **User fills in nested prompter and clicks Submit**
   ```
   Nested Webview → Extension: { type: 'submit', values: {...} }
   ```

4. **Extension resolves promise with command string**
   - Builds unformatted command: `CALL PGM(MYPGM) PARM('VALUE')`
   - Resolves promise (does NOT format or insert into editor)
   - Closes nested panel

5. **Extension sends result back to parent**
   ```
   Extension → Parent Webview: { type: 'nestedResult', fieldId: 'CMD', commandString: 'CALL PGM(MYPGM) PARM(\'VALUE\')' }
   ```

6. **Parent webview updates textarea**
   - Finds textarea by field ID
   - Sets value to returned command string
   - Focuses field

## Examples

### Example 1: SBMJOB with nested CALL
1. Prompt `SBMJOB`
2. In the CMD parameter textarea, type `CALL PGM(MYPGM)`
3. Press F4
4. Nested prompter opens for CALL command
5. Fill in PARM, LIB, etc.
6. Click Submit
7. Parent prompter's CMD field now contains: `CALL PGM(MYLIB/MYPGM) PARM('VALUE1' 'VALUE2')`

### Example 2: IF with nested CHKOBJ
1. Prompt `IF COND(%BIN(&VAR 1 4) *GT 0) THEN()`
2. In the THEN parameter (which is CMDSTR type), type `CHKOBJ OBJ(MYOBJ)`
3. Press F4
4. Nested prompter opens for CHKOBJ
5. Fill in OBJTYPE, etc.
6. Click Submit
7. Parent prompter's THEN field contains: `CHKOBJ OBJ(MYLIB/MYOBJ) OBJTYPE(*FILE)`

## Key Differences from Regular Prompter

| Aspect | Regular Prompter | Nested Prompter |
|--------|-----------------|-----------------|
| Panel Title | `CMDNAME Prompt` | `CMDNAME Prompt (nested)` |
| Submit Action | Formats command, inserts into editor | Returns unformatted command to parent |
| Cancel Action | Just closes panel | Resolves promise with null |
| Input Source | Active editor selection | Command string from parent textarea |
| Output Target | Active editor | Parent prompter textarea |

## Technical Notes

- **No Formatting**: Nested prompters return the raw built command without SEU-style formatting
- **Promise-based**: Uses async/await pattern for clean request/response flow
- **Side-by-side**: Opens in `vscode.ViewColumn.Beside` for easy comparison
- **Recursive**: Nested prompters can theoretically have their own nested prompters (untested)
- **CMD vs CMDSTR**: Both parameter types support F4 prompting (IBM uses CMD for system commands, CMDSTR for user commands)
