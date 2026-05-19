# vscode-clle Extension API Notes

## Repo
- Location: /Users/cozzi/Downloads/projects/vscode-clle
- Extension ID: `IBM.vscode-clle`
- Publisher: IBM, Name: vscode-clle

## GenCmdDoc — CL Command Documentation API

### What it does
Runs `GENCMDDOC` on IBM i to generate HTML help for a CL command, downloads it,
parses it into a structured `CLDoc` object (Markdown strings), and caches results.

### Key types (client/src/gencmddoc.ts)
```typescript
export interface CLDoc {
  command: { name: string; description: string }
  parameters: {
    overview: string;           // markdown table of all params
    details: {
      name: string;             // e.g. "FROMFILE"
      description: string;      // full markdown help text for that param
    }[]
  };
  examples: string;
  errorMessages: string;
}
export class GenCmdDoc {
  static getCLDoc(object: string, library?: string): Promise<{ html: string, doc: CLDoc } | undefined>
  static openClDoc(object: string, library?: string): Promise<boolean>
  static clearCLDocCache(): void
}
```

### Extension API export (client/src/extension.ts)
```typescript
export interface CLLE {
  genCmdDoc: typeof GenCmdDoc
}
// activate() returns { genCmdDoc: GenCmdDoc }
```

### How to get a single parameter's help text
```typescript
const clDoc = await GenCmdDoc.getCLDoc('CPYF', '*LIBL');
const param = clDoc?.doc.parameters.details.find(p => p.name === 'FROMFILE');
const helpText = param?.description; // Markdown string
```

### Consuming from CLPrompter extension
```typescript
import type { CLLE } from '...'; // path to vscode-clle types

const ext = vscode.extensions.getExtension<CLLE>('IBM.vscode-clle');
if (ext) {
  const api = ext.isActive ? ext.exports : await ext.activate();
  const clDoc = await api.genCmdDoc.getCLDoc('CPYF', '*LIBL');
  const param = clDoc?.doc.parameters.details.find(p => p.name === 'FROMFILE');
  const helpText = param?.description;
}
```

### Notes
- Requires active IBM i connection (runs GENCMDDOC on the host)
- Results are cached per command after first call
- `description` fields are Markdown (converted from IBM HTML via node-html-markdown)
- Parameter names in `details` array match IBM keyword names (e.g. FROMFILE, TOFILE, FROMMBR)
- fix applied: added `if (!instance) return;` guard in generateHtml() since getInstance() returns Instance | undefined
