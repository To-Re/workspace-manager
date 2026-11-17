'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { Store } = require('./store');
const { writeManaged, readManaged } = require('./managed');
const { captureWindow, restoreEditors } = require('./window');
function activate(context) {
  const store = new Store(context.globalStorageUri.fsPath);
  const event = new vscode.EventEmitter();
  const notify = e => vscode.window.showErrorMessage('工作区管理：' + e.message);
  const refresh = () => event.fire();
  const provider = {
    onDidChangeTreeData: event.event,
    async getChildren(item) {
      if (item) return [];
      try { return (await store.read()).entries; }
      catch (e) { notify(e); return []; }
    },
    getTreeItem(entry) {
      const uri = vscode.Uri.parse(entry.uri, true);
      const item = new vscode.TreeItem(entry.name, vscode.TreeItemCollapsibleState.None);
      item.id = entry.uri;
      item.description = uri.scheme === 'vscode-remote' ? uri.authority : '本机';
      item.tooltip = `${entry.name}\n${uri.toString(true)}`;
      item.iconPath = new vscode.ThemeIcon(entry.kind === 'workspace' ? 'window' : 'folder');
      item.contextValue = 'savedWorkspace';
      item.command = { command: 'workspaceShelf.open', title: '打开工作区', arguments: [entry] };
      return item;
    }
  };
  const register = (name, fn) => context.subscriptions.push(vscode.commands.registerCommand('workspaceShelf.' + name, async (...args) => {
    try { await fn(...args); } catch (e) { notify(e); }
  }));
  const choose = async () => {
    const rows = (await store.read()).entries;
    if (!rows.length) { vscode.window.showInformationMessage('还没有保存的工作区。点击“保存当前窗口”即可。'); return; }
    const choice = await vscode.window.showQuickPick(rows.map(e => ({ label: e.name, description: vscode.Uri.parse(e.uri).authority || '本机', detail: e.uri, entry: e })), { placeHolder: '搜索名称、主机或路径', matchOnDescription: true, matchOnDetail: true });
    return choice?.entry;
  };
  const open = async (entry, newWindow) => {
    entry ||= await choose();
    if (!entry) return;
    // Only open records that still exist; do not allow arbitrary command arguments to open URIs.
    const saved = (await store.read()).entries.find(e => e.uri === entry.uri);
    if (!saved) throw Error('记录已移除，请刷新后重试。');
    const uri = vscode.Uri.parse(saved.uri, true);
    if (uri.scheme === 'file') {
      try { await vscode.workspace.fs.stat(uri); }
      catch { throw Error('本地路径不存在或无法访问。请恢复路径，或从列表移除此记录。'); }
    }
    await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow, forceReuseWindow: !newWindow });
  };
  let lastSource;
  let saving = false;
  async function saveWindow() {
    if (saving) return;
    saving = true;
    try {
      const captured = await captureWindow(vscode, store.dir);
      await store.change(async rows => {
        const currentUri = vscode.workspace.workspaceFile?.toString();
        const old = rows.find(e => e.uri === currentUri || e.source === captured.source || (lastSource && e.source === lastSource));
        const name = old?.name || captured.name;
        const file = await writeManaged(store.dir, name, captured.data);
        const entry = { uri: vscode.Uri.file(file).toString(), name, kind: 'workspace', managed: true, source: old?.source || captured.source };
        if (old) rows[rows.indexOf(old)] = entry; else rows.push(entry);
        lastSource = entry.source;
      });
      refresh();
      vscode.window.showInformationMessage('当前窗口已保存，可点铅笔改名。');
    } finally { saving = false; }
  }
  register('save', saveWindow);
  // Legacy command IDs lead to the same one-click flow; no native Save As dialog.
  register('saveAs', saveWindow);
  register('import', saveWindow);
  register('open', e => open(e, true));
  register('reuse', e => open(e, false));
  register('pick', () => open(undefined, true));
  register('refresh', refresh);
  register('rename', async entry => {
    entry ||= await choose(); if (!entry) return;
    const name = await vscode.window.showInputBox({ title: '修改显示名称', value: entry.name, validateInput: v => v.trim() ? null : '请输入名称' });
    if (name?.trim()) {
      await store.change(async rows => {
        const saved = rows.find(e => e.uri === entry.uri);
        if (!saved) throw Error('记录已移除，请刷新。');
        if (saved.managed) {
          const data = await readManaged(store.dir, vscode.Uri.parse(saved.uri).fsPath);
          const file = await writeManaged(store.dir, name.trim(), data);
          saved.uri = vscode.Uri.file(file).toString();
        }
        saved.name = name.trim();
      });
      refresh();
    }
  });
  register('remove', async entry => {
    entry ||= await choose(); if (!entry) return;
    await store.remove(entry.uri); refresh();
    if (await vscode.window.showInformationMessage('已从工作区列表删除，原项目文件未删除。', '撤销') === '撤销') {
      // Do not overwrite a newer entry created in another window.
      await store.change(rows => { if (!rows.some(e => e.uri === entry.uri)) rows.push(entry); }); refresh();
    }
  });
  context.subscriptions.push(event, vscode.window.createTreeView('workspaceShelf.list', { treeDataProvider: provider }),
    vscode.window.onDidChangeWindowState(e => { if (e.focused) refresh(); }));
  const ready = (async () => {
    const current = vscode.workspace.workspaceFile;
    if (!current || current.scheme !== 'file') return;
    const entry = (await store.read()).entries.find(e => e.managed && e.uri === current.toString());
    if (!entry) return;
    lastSource = entry.source;
    const data = await readManaged(store.dir, current.fsPath);
    await restoreEditors(vscode, data.workspaceShelf?.editors);
  })().catch(notify);
  return { ready };

}
module.exports = { activate };
