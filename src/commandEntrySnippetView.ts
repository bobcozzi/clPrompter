import * as vscode from 'vscode';
import { CodeSnippetRecord, CommandEntryViewProvider, DEFAULT_CODE_SNIPPET_GROUPS } from './commandEntryView';

type TreeClickAction = 'Run' | 'View full statement' | 'No-op';

function buildSnippetViewUri(label: string, language: 'sql' | 'clle'): vscode.Uri {
    const cleaned = label
        .trim()
        .replace(/[^a-zA-Z0-9._ -]+/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 48)
        .trim();
    const stem = cleaned.length > 0 ? cleaned : 'Code Snippet';
    const extension = language === 'sql' ? 'sql' : 'clle';
    return vscode.Uri.parse(`untitled:${stem}.${extension}`);
}

async function openSnippetViewDocument(uri: vscode.Uri, language: 'sql' | 'clle', content: string): Promise<vscode.TextDocument> {
    const document = await vscode.workspace.openTextDocument(uri);
    if (document.languageId !== language) {
        await vscode.languages.setTextDocumentLanguage(document, language);
    }
    const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, content);
    await vscode.workspace.applyEdit(edit);
    return document;
}

function getTreeClickAction(): TreeClickAction {
    const config = vscode.workspace.getConfiguration('clPrompter');
    const raw = String(config.get<string>('cmdEntryCodeSnippetTreeClickAction', 'Run') || 'Run').trim();
    if (raw === 'View full statement' || raw === 'No-op') {
        return raw;
    }
    return 'Run';
}

function commandForTreeClickAction(action: TreeClickAction, snippet: CodeSnippetRecord): vscode.Command | undefined {
    switch (action) {
        case 'View full statement':
            return {
                command: 'clprompter.codeSnippet.viewFullStatement',
                title: `Code Snippet: ${action}`,
                arguments: [snippet]
            };
        case 'No-op':
            return undefined;
        default:
            return {
                command: 'clprompter.codeSnippet.run',
                title: `Code Snippet: ${action}`,
                arguments: [snippet]
            };
    }
}

class GroupTreeItem extends vscode.TreeItem {
    constructor(public readonly groupName: string, public readonly count: number) {
        super(groupName, vscode.TreeItemCollapsibleState.Expanded);
        this.id = `group.${groupName}`;
        this.description = `${count}`;
        this.contextValue = 'codeSnippetGroup';
    }
}

class CodeSnippetPreviewTreeItem extends vscode.TreeItem {
    constructor(public readonly snippet: CodeSnippetRecord, clickAction: TreeClickAction) {
        const preview = snippet.codeTemplate.split(/\r?\n/, 1)[0] || '';
        super(preview, vscode.TreeItemCollapsibleState.None);
        this.id = `preview.${snippet.id}`;
        this.contextValue = snippet.source === 'built-in' ? 'codeSnippetPreviewBuiltIn' : 'codeSnippetPreviewUser';
        this.tooltip = new vscode.MarkdownString(['```text', snippet.codeTemplate, '```'].join('\n'));
        this.command = commandForTreeClickAction(clickAction, snippet);
    }
}

class CodeSnippetTreeItem extends vscode.TreeItem {
    constructor(public readonly snippet: CodeSnippetRecord, clickAction: TreeClickAction) {
        super(snippet.label, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = snippet.id;
        this.description = snippet.source === 'user' ? 'User' : undefined;
        this.tooltip = new vscode.MarkdownString([
            `**${snippet.label}**`,
            '',
            `Group: ${snippet.group}`,
            '',
            '```text',
            snippet.codeTemplate,
            '```'
        ].join('\n'));
        this.contextValue = snippet.source === 'built-in' ? 'codeSnippetBuiltIn' : 'codeSnippetUser';
        this.command = commandForTreeClickAction(clickAction, snippet);
    }
}

type SnippetNode = GroupTreeItem | CodeSnippetTreeItem | CodeSnippetPreviewTreeItem;

class CodeSnippetTreeDataProvider implements vscode.TreeDataProvider<SnippetNode> {
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SnippetNode | undefined>();
    public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;
    private cache: CodeSnippetRecord[] = [];

    constructor(private readonly commandEntry: CommandEntryViewProvider) {
        this.cache = this.commandEntry.listCodeSnippets();
    }

    refresh(): void {
        this.cache = this.commandEntry.listCodeSnippets();
        this.onDidChangeTreeDataEmitter.fire(undefined);
    }

    getCache(): CodeSnippetRecord[] {
        return [...this.cache];
    }

    private getGroupNames(): string[] {
        const seen = new Set<string>();
        for (const group of DEFAULT_CODE_SNIPPET_GROUPS) {
            seen.add(group);
        }
        for (const snippet of this.cache) {
            const group = String(snippet.group || '').trim();
            if (group) {
                seen.add(group);
            }
        }
        return [...seen];
    }

    getTreeItem(element: SnippetNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SnippetNode): SnippetNode[] {
        if (!element) {
            const groups = this.getGroupNames();
            return groups.map((groupName) => {
                const count = this.cache.filter((item) => item.group === groupName).length;
                return new GroupTreeItem(groupName, count);
            });
        }

        if (element instanceof GroupTreeItem) {
            const clickAction = getTreeClickAction();
            return this.cache
                .filter((snippet) => snippet.group === element.groupName)
                .map((snippet) => new CodeSnippetTreeItem(snippet, clickAction));
        }

        if (element instanceof CodeSnippetTreeItem) {
            return [new CodeSnippetPreviewTreeItem(element.snippet, getTreeClickAction())];
        }

        return [];
    }
}

class CodeSnippetDragAndDropController implements vscode.TreeDragAndDropController<SnippetNode> {
    public readonly dropMimeTypes = ['application/vnd.codeSnippetManager.item'];
    public readonly dragMimeTypes = ['application/vnd.codeSnippetManager.item'];

    constructor(
        private readonly commandEntry: CommandEntryViewProvider,
        private readonly provider: CodeSnippetTreeDataProvider
    ) { }

    async handleDrag(source: readonly SnippetNode[], dataTransfer: vscode.DataTransfer): Promise<void> {
        const snippetItems = source.filter((item): item is CodeSnippetTreeItem => item instanceof CodeSnippetTreeItem);
        if (snippetItems.length === 0) {
            return;
        }

        if (snippetItems.some((item) => item.snippet.source === 'built-in')) {
            void vscode.window.showInformationMessage('Only user-provided snippets can be reordered by dragging.');
            return;
        }

        const ids = snippetItems.map((item) => item.snippet.id);
        dataTransfer.set('application/vnd.codeSnippetManager.item', new vscode.DataTransferItem(JSON.stringify(ids)));
    }

    async handleDrop(target: SnippetNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
        const payload = dataTransfer.get('application/vnd.codeSnippetManager.item');
        if (!payload || !target) {
            return;
        }

        let draggedIds: string[] = [];
        try {
            const parsed = JSON.parse(await payload.asString());
            if (Array.isArray(parsed)) {
                draggedIds = parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
            }
        } catch {
            return;
        }

        const sourceId = draggedIds[0];
        if (!sourceId) {
            return;
        }

        const current = this.provider.getCache();
        const sourceSnippet = current.find((entry) => entry.id === sourceId);
        if (!sourceSnippet || sourceSnippet.source !== 'user') {
            return;
        }

        let targetGroup = sourceSnippet.group;
        let targetId: string | undefined;

        if (target instanceof GroupTreeItem) {
            targetGroup = target.groupName;
        } else if (target instanceof CodeSnippetTreeItem) {
            targetGroup = target.snippet.group;
            targetId = target.snippet.id;
        } else {
            return;
        }

        if (sourceSnippet.group !== targetGroup) {
            await this.commandEntry.updateCodeSnippet(sourceSnippet.id, sourceSnippet.label, sourceSnippet.codeTemplate, targetGroup);
        }

        const refreshed = this.commandEntry.listCodeSnippets();
        const reordered = [...refreshed];
        const sourceIndex = reordered.findIndex((entry) => entry.id === sourceId);
        if (sourceIndex < 0) {
            return;
        }

        const [sourceItem] = reordered.splice(sourceIndex, 1);

        if (targetId) {
            const targetIndex = reordered.findIndex((entry) => entry.id === targetId);
            if (targetIndex >= 0) {
                reordered.splice(targetIndex, 0, sourceItem);
            } else {
                reordered.push(sourceItem);
            }
        } else {
            const insertionIndex = reordered
                .map((entry, index) => ({ entry, index }))
                .filter((pair) => pair.entry.group === targetGroup)
                .map((pair) => pair.index)
                .pop();
            if (insertionIndex === undefined) {
                reordered.push(sourceItem);
            } else {
                reordered.splice(insertionIndex + 1, 0, sourceItem);
            }
        }

        await this.commandEntry.reorderCodeSnippets(reordered.map((entry) => entry.id));
    }
}

class CodeSnippetEditorPanel {
    private static panel: vscode.WebviewPanel | undefined;

    static show(
        context: vscode.ExtensionContext,
        commandEntry: CommandEntryViewProvider,
        snippet: CodeSnippetRecord | undefined,
        availableGroups: string[]
    ): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Active);
            this.panel.webview.postMessage({ type: 'load', snippet, availableGroups });
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'clprompter.codeSnippetEditor',
            snippet ? `Edit Code Snippet: ${snippet.label}` : 'New Code Snippet',
            vscode.ViewColumn.Active,
            { enableScripts: true }
        );
        this.panel = panel;

        panel.onDidDispose(() => {
            if (this.panel === panel) {
                this.panel = undefined;
            }
        });

        panel.webview.onDidReceiveMessage(async (message: any) => {
            try {
                switch (message?.type) {
                    case 'ready':
                        panel.webview.postMessage({ type: 'load', snippet, availableGroups });
                        break;
                    case 'save': {
                        const label = String(message.label || '').trim();
                        const codeTemplate = String(message.codeTemplate || '').trim();
                        const group = String(message.group || '').trim() || 'Admin';
                        if (!label || !codeTemplate) {
                            panel.webview.postMessage({ type: 'error', message: 'Label and Code Snippet text are required.' });
                            return;
                        }
                        const parsedOrder = Number.isFinite(Number(message.order))
                            ? Math.max(0, Math.trunc(Number(message.order)))
                            : undefined;

                        if (snippet && snippet.source === 'user') {
                            await commandEntry.updateCodeSnippet(snippet.id, label, codeTemplate, group, parsedOrder);
                        } else {
                            await commandEntry.createCodeSnippet(label, codeTemplate, group, parsedOrder);
                        }
                        panel.dispose();
                        break;
                    }
                    case 'saveRun': {
                        const label = String(message.label || '').trim();
                        const codeTemplate = String(message.codeTemplate || '').trim();
                        const group = String(message.group || '').trim() || 'Admin';
                        if (!label || !codeTemplate) {
                            panel.webview.postMessage({ type: 'error', message: 'Label and Code Snippet text are required.' });
                            return;
                        }
                        const parsedOrder = Number.isFinite(Number(message.order))
                            ? Math.max(0, Math.trunc(Number(message.order)))
                            : undefined;

                        if (snippet && snippet.source === 'user') {
                            await commandEntry.updateCodeSnippet(snippet.id, label, codeTemplate, group, parsedOrder);
                            await commandEntry.executeCodeSnippetById(snippet.id);
                        } else {
                            await commandEntry.createCodeSnippet(label, codeTemplate, group, parsedOrder);
                            const created = commandEntry.listCodeSnippets().find((entry) => entry.label.toUpperCase() === label.toUpperCase() && entry.source === 'user');
                            if (created) {
                                await commandEntry.executeCodeSnippetById(created.id);
                            }
                        }
                        panel.dispose();
                        break;
                    }
                    case 'cancel':
                        panel.dispose();
                        break;
                }
            } catch (error) {
                panel.webview.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
            }
        });

        panel.webview.html = this.editorHtml(panel.webview);
    }

    private static editorHtml(webview: vscode.Webview): string {
        const nonce = Array.from({ length: 32 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 62))).join('');
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
    <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 16px 18px; font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); }
        .form-shell { width: 100%; overflow-x: auto; }
        .form-table { border-collapse: separate; border-spacing: 0 10px; min-width: 1120px; width: 100%; }
        .form-table th { width: 220px; text-align: left; vertical-align: top; font-size: 12px; color: var(--vscode-descriptionForeground); padding: 10px 8px 0 0; letter-spacing: 0.02em; font-weight: 600; white-space: nowrap; }
        .form-table td { min-width: 860px; }
        input, textarea { font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); border-radius: 8px; padding: 9px 10px; }
        input { height: 38px; }
        input { width: 100%; }
        input:focus, textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 0; }
        textarea { width: min(100%, 80ch); min-height: calc(12 * 1.4em + 18px); resize: both; line-height: 1.4; font-family: var(--vscode-editor-font-family, var(--vscode-font-family)); }
        .vars { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
        button { height: 34px; border-radius: 8px; border: 1px solid var(--vscode-button-border, transparent); padding: 0 14px; font: inherit; font-weight: 600; letter-spacing: 0.01em; cursor: pointer; transition: background-color 120ms ease, transform 120ms ease; background: var(--vscode-button-secondaryBackground, var(--vscode-button-background)); color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground)); box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2); }
        button:hover { background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground)); transform: translateY(-1px); }
        button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
        button:disabled { opacity: 0.65; cursor: not-allowed; transform: none; }
        .vars button { height: 30px; padding: 0 10px; font-weight: 500; }
        .actions { display: flex; gap: 10px; margin-top: 2px; }
        .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-border, transparent); }
        .primary:hover { background: var(--vscode-button-hoverBackground); }
        .error { min-height: 1.3em; margin-top: 2px; color: var(--vscode-errorForeground, #f14c4c); }
        @media (max-width: 1120px) {
            .actions { flex-wrap: wrap; }
        }
    </style>
</head>
<body>
    <div class="form-shell">
        <table class="form-table" role="presentation">
            <tbody>
                <tr>
                    <th><label for="snippet-label">Title</label></th>
                    <td>
                        <input id="snippet-label" type="text" maxlength="120" />
                    </td>
                </tr>
                <tr>
                    <th><label for="snippet-group">Group</label></th>
                    <td>
                        <input id="snippet-group" type="text" list="group-options" />
                        <datalist id="group-options"></datalist>
                    </td>
                </tr>
                <tr>
                    <th><label for="snippet-order">Sequence</label></th>
                    <td>
                        <input id="snippet-order" type="number" min="0" step="1" placeholder="Optional sequence (lower appears first)" />
                    </td>
                </tr>
                <tr>
                    <th><label for="snippet-code">Code Snippet Text</label></th>
                    <td>
                        <textarea id="snippet-code" rows="12" cols="80" style="resize: both;"></textarea>
                        <div class="vars" id="vars">
                            <button type="button" data-token="\${sqlJobId}">+ \${sqlJobId}</button>
                            <button type="button" data-token="\${sqlJobName}">+ \${sqlJobName}</button>
                            <button type="button" data-token="\${sqlJobNumber}">+ \${sqlJobNumber}</button>
                            <button type="button" data-token="\${currentUser}">+ \${currentUser}</button>
                            <button type="button" data-token="\${currentLibrary}">+ \${currentLibrary}</button>
                        </div>
                    </td>
                </tr>
                <tr>
                    <th></th>
                    <td>
                        <div class="actions">
                            <button id="save" class="primary" type="button">Save</button>
                            <button id="save-run" type="button">Save + Run</button>
                            <button id="cancel" type="button">Cancel</button>
                        </div>
                    </td>
                </tr>
                <tr>
                    <th></th>
                    <td>
                        <div id="error" class="error"></div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const label = document.getElementById('snippet-label');
    const group = document.getElementById('snippet-group');
    const order = document.getElementById('snippet-order');
    const groupOptions = document.getElementById('group-options');
    const code = document.getElementById('snippet-code');
    const vars = document.getElementById('vars');
    const errorEl = document.getElementById('error');
    const save = document.getElementById('save');
    const saveRun = document.getElementById('save-run');
    const cancel = document.getElementById('cancel');
    let currentSnippet = null;

    function clearError() { errorEl.textContent = ''; }
    function setError(message) { errorEl.textContent = message || ''; }

    function insertToken(token) {
      if (!token) return;
      code.focus();
      const text = String(code.value || '');
      const start = Number(code.selectionStart ?? text.length);
      const end = Number(code.selectionEnd ?? start);
      code.setSelectionRange(start, end);
      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, token);
      } catch {
        inserted = false;
      }
      if (!inserted) {
        code.setRangeText(token, start, end, 'end');
      }
    }

    vars.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const token = target.dataset?.token;
      if (!token) return;
      insertToken(token);
    });

    save.addEventListener('click', () => {
      clearError();
            vscode.postMessage({ type: 'save', label: label.value, group: group.value, order: order.value, codeTemplate: code.value });
    });

    saveRun.addEventListener('click', () => {
      clearError();
            vscode.postMessage({ type: 'saveRun', label: label.value, group: group.value, order: order.value, codeTemplate: code.value });
    });

    cancel.addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));

    window.addEventListener('message', (event) => {
      const message = event.data || {};
      if (message.type === 'load') {
        currentSnippet = message.snippet || null;
        label.value = currentSnippet?.label || '';
        code.value = currentSnippet?.codeTemplate || '';
        group.value = currentSnippet?.group || 'Admin';
        order.value = Number.isFinite(Number(currentSnippet?.order)) ? String(Math.trunc(Number(currentSnippet.order))) : '';

        groupOptions.replaceChildren();
        const groups = Array.isArray(message.availableGroups) ? message.availableGroups : [];
        for (const groupName of groups) {
          const option = document.createElement('option');
          option.value = String(groupName || '').trim();
          groupOptions.append(option);
        }

        clearError();
      }
      if (message.type === 'error') {
        setError(message.message || 'Unexpected error.');
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
    }
}

function getAvailableGroups(commandEntry: CommandEntryViewProvider): string[] {
    const groups = new Set<string>(DEFAULT_CODE_SNIPPET_GROUPS);
    for (const snippet of commandEntry.listCodeSnippets()) {
        const name = String(snippet.group || '').trim();
        if (name) {
            groups.add(name);
        }
    }
    return [...groups];
}

export function registerCodeSnippetManagerView(
    context: vscode.ExtensionContext,
    commandEntry: CommandEntryViewProvider
): vscode.Disposable {
    const pinStateKey = 'clprompter.codeSnippetManagerPinned';
    const provider = new CodeSnippetTreeDataProvider(commandEntry);
    const dnd = new CodeSnippetDragAndDropController(commandEntry, provider);

    const view = vscode.window.createTreeView('clprompter.codeSnippetManagerView', {
        treeDataProvider: provider,
        dragAndDropController: dnd,
        showCollapseAll: true
    });

    const setVisible = async (visible: boolean) => {
        await vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetManagerVisible', visible);
    };

    const setPinned = async (pinned: boolean) => {
        await context.globalState.update(pinStateKey, pinned);
        await vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetManagerPinned', pinned);
    };

    const resolvePinnedVisibilityForSession = async () => {
        const pinned = context.globalState.get<boolean>(pinStateKey, false);
        await vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetManagerPinned', pinned);
        // Only show pinned snippets after CL Command Entry has actually been touched this session.
        const commandEntryTouched = context.workspaceState.get<boolean>('clprompter.commandEntryTouchedThisSession', false);
        await setVisible(commandEntryTouched ? pinned : false);
    };

    const refresh = () => provider.refresh();

    const updateSelectionContexts = async () => {
        const selected = view.selection[0];
        const selectedSnippet = selected instanceof CodeSnippetTreeItem || selected instanceof CodeSnippetPreviewTreeItem
            ? selected.snippet
            : undefined;
        const hasSnippet = Boolean(selectedSnippet);
        const isUserSnippet = selectedSnippet?.source === 'user';
        await vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetSelected', hasSnippet);
        await vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetUserSelected', isUserSnippet);
    };

    const resolveSnippet = (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord): CodeSnippetRecord | undefined => {
        if (item) {
            return 'snippet' in item ? item.snippet : item;
        }
        const selected = view.selection[0];
        if (selected instanceof CodeSnippetTreeItem || selected instanceof CodeSnippetPreviewTreeItem) {
            return selected.snippet;
        }
        return undefined;
    };

    const subscriptions: vscode.Disposable[] = [
        view,
        commandEntry.onDidChangeCodeSnippets(refresh),
        vscode.commands.registerCommand('clprompter.toggleCodeSnippetsTreeView', async () => {
            if (view.visible) {
                await setVisible(false);
                return;
            }
            await setVisible(true);
            provider.refresh();
            await vscode.commands.executeCommand('workbench.view.extension.ibmi-explorer');
            await vscode.commands.executeCommand('clprompter.codeSnippetManagerView.focus');
        }),
        vscode.commands.registerCommand('clprompter.manageCodeSnippets', async () => {
            await setVisible(true);
            provider.refresh();
            await vscode.commands.executeCommand('workbench.view.extension.ibmi-explorer');
            await vscode.commands.executeCommand('clprompter.codeSnippetManagerView.focus');
        }),
        vscode.commands.registerCommand('clprompter.closeCodeSnippetManager', async () => {
            await setPinned(false);
            await setVisible(false);
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.pin', async () => {
            await setPinned(true);
            await setVisible(true);
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.unpin', async () => {
            await setPinned(false);
            await resolvePinnedVisibilityForSession();
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.resolvePinnedVisibility', async () => {
            await resolvePinnedVisibilityForSession();
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('clprompter.codeSnippet.add', () => {
            CodeSnippetEditorPanel.show(context, commandEntry, undefined, getAvailableGroups(commandEntry));
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.openEditor', (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            CodeSnippetEditorPanel.show(context, commandEntry, snippet, getAvailableGroups(commandEntry));
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.edit', (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (!snippet) {
                return;
            }
            CodeSnippetEditorPanel.show(context, commandEntry, snippet, getAvailableGroups(commandEntry));
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.delete', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (!snippet) {
                return;
            }
            const choice = await vscode.window.showWarningMessage(`Delete Code Snippet '${snippet.label}'?`, { modal: true }, 'Delete');
            if (choice === 'Delete') {
                await commandEntry.deleteCodeSnippet(snippet.id);
            }
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.run', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (snippet) {
                await commandEntry.executeCodeSnippetById(snippet.id);
            }
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.viewFullStatement', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (!snippet) {
                return;
            }

            const resolution = commandEntry.resolveSnippetTemplateText(snippet.codeTemplate);
            if (resolution.missing.length > 0) {
                void vscode.window.showWarningMessage(`Snippet '${snippet.label}' requires unavailable value(s): ${resolution.missing.map((name) => `\${${name}}`).join(', ')}`);
                return;
            }

            const language = /^\s*(SELECT|VALUES|WITH|INSERT|UPDATE|DELETE|MERGE|CALL)\b/i.test(resolution.resolved)
                ? 'sql'
                : 'clle';
            const viewUri = buildSnippetViewUri(snippet.label, language);
            const document = await openSnippetViewDocument(viewUri, language, resolution.resolved);
            await vscode.window.showTextDocument(document, { preview: true });
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.copy', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (!snippet) {
                return;
            }
            const resolution = commandEntry.resolveSnippetTemplateText(snippet.codeTemplate);
            if (resolution.missing.length > 0) {
                void vscode.window.showWarningMessage(`Snippet '${snippet.label}' requires unavailable value(s): ${resolution.missing.map((name) => `\${${name}}`).join(', ')}`);
                return;
            }
            await vscode.env.clipboard.writeText(resolution.resolved);
            void vscode.window.showInformationMessage(`Copied Code Snippet text: ${snippet.label}`);
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.copyToCommandEntry', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (!snippet) {
                return;
            }
            const resolution = commandEntry.resolveSnippetTemplateText(snippet.codeTemplate);
            if (resolution.missing.length > 0) {
                void vscode.window.showWarningMessage(`Snippet '${snippet.label}' requires unavailable value(s): ${resolution.missing.map((name) => `\${${name}}`).join(', ')}`);
                return;
            }
            await vscode.commands.executeCommand('clprompter.openCommandEntry');
            commandEntry.setCommandText(resolution.resolved);
            void vscode.window.showInformationMessage(`Copied to CL Command Entry: ${snippet.label}`);
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.moveUp', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (snippet) {
                await commandEntry.moveCodeSnippet(snippet.id, 'up');
            }
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.moveDown', async (item?: CodeSnippetTreeItem | CodeSnippetPreviewTreeItem | CodeSnippetRecord) => {
            const snippet = resolveSnippet(item);
            if (snippet) {
                await commandEntry.moveCodeSnippet(snippet.id, 'down');
            }
        }),
        vscode.commands.registerCommand('clprompter.codeSnippet.import', () => commandEntry.requestImportCodeSnippets()),
        vscode.commands.registerCommand('clprompter.codeSnippet.export', () => commandEntry.requestExportCodeSnippets())
    ];

    void (async () => {
        const pinned = context.globalState.get<boolean>(pinStateKey, false);
        await setPinned(pinned);
        await setVisible(false);
    })();

    void updateSelectionContexts();

    subscriptions.push(
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('clPrompter.cmdEntryCodeSnippetTreeClickAction')) {
                provider.refresh();
            }
        }),
        view.onDidChangeSelection(() => {
            void updateSelectionContexts();
        })
    );

    view.onDidChangeVisibility((event) => {
        if (!event.visible) {
            const pinned = context.globalState.get<boolean>(pinStateKey, false);
            if (!pinned) {
                void setVisible(false);
            }
            void vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetSelected', false);
            void vscode.commands.executeCommand('setContext', 'clprompter.codeSnippetUserSelected', false);
        }
    });

    return new vscode.Disposable(() => {
        for (const subscription of subscriptions) {
            subscription.dispose();
        }
    });
}
