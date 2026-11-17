'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { Store } = require('./store');
function currentTarget(workspace) {
  if (workspace.workspaceFile) {
    if (workspace.workspaceFile.scheme === 'untitled') throw Error('请先使用“将当前工作区另存为”，再收藏，以保留多文件夹和工作区设置。');
    return { uri: workspace.workspaceFile, kind: 'workspace' };
  }
  const folders = workspace.workspaceFolders || [];
  if (folders.length !== 1) throw Error('请先打开项目文件夹或已保存的工作区。');
  return { uri: folders[0].uri, kind: 'folder' };
}
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
    if (!rows.length) { vscode.window.showInformationMessage('还没有收藏的工作区。先打开项目，再点“收藏当前工作区”。'); return; }
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
  async function save(target) {
    if (!['file','vscode-remote'].includes(target.uri.scheme)) throw Error('目前只支持本地与远程开发工作区。');
    const name = await vscode.window.showInputBox({ title: '收藏工作区', prompt: '显示名称（不会重命名文件夹）', value: path.posix.basename(target.uri.path).replace(/\.code-workspace$/, ''), validateInput: v => v.trim() ? null : '请输入名称' });
    if (!name?.trim()) return;
    await store.save({ uri: target.uri.toString(), kind: target.kind, name: name.trim() });
    refresh();
    vscode.window.showInformationMessage('已收藏，关闭窗口或重启后仍会保留。');
  }
  register('save', () => save(currentTarget(vscode.workspace)));
  register('saveAs', () => vscode.commands.executeCommand('workbench.action.saveWorkspaceAs'));
  register('import', async () => {
    const uris = await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFolders: false, filters: { 'VS Code 工作区': ['code-workspace'] }, title: '添加已有工作区文件' });
    if (uris?.[0]) await save({ uri: uris[0], kind: 'workspace' });
  });
  register('open', e => open(e, true));
  register('reuse', e => open(e, false));
  register('pick', () => open(undefined, true));
  register('refresh', refresh);
  register('rename', async entry => {
    entry ||= await choose(); if (!entry) return;
    const name = await vscode.window.showInputBox({ title: '修改显示名称', value: entry.name, validateInput: v => v.trim() ? null : '请输入名称' });
    if (name?.trim()) { await store.rename(entry.uri, name.trim()); refresh(); }
  });
  register('remove', async entry => {
    entry ||= await choose(); if (!entry) return;
    await store.remove(entry.uri); refresh();
    if (await vscode.window.showInformationMessage('已从列表移除，项目文件保持不变。', '撤销') === '撤销') {
      // Do not overwrite a newer entry created in another window.
      await store.change(rows => { if (!rows.some(e => e.uri === entry.uri)) rows.push(entry); }); refresh();
    }
  });
  context.subscriptions.push(event, vscode.window.createTreeView('workspaceShelf.list', { treeDataProvider: provider }),
    vscode.window.onDidChangeWindowState(e => { if (e.focused) refresh(); }));
}
module.exports = { activate, currentTarget };
