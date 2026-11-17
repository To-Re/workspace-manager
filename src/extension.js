'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { Store } = require('./store');
const { snapshot, writeManaged, readManaged, untitledSource } = require('./managed');
function currentTarget(workspace) {
  if (workspace.workspaceFile) {
    if (workspace.workspaceFile.scheme === 'untitled') return { uri: workspace.workspaceFile, kind: 'workspace', needsSave: true };
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
    if (!target.needsSave && !['file','vscode-remote'].includes(target.uri.scheme)) throw Error('目前只支持本地与远程开发工作区。');
    const name = await vscode.window.showInputBox({ title: '收藏工作区', prompt: '显示名称（不会重命名文件夹）', value: target.needsSave ? '我的工作区' : path.posix.basename(target.uri.path).replace(/\.code-workspace$/, ''), validateInput: v => v.trim() ? null : '请输入名称' });
    if (!name?.trim()) return;
    let entry = { uri: target.uri.toString(), kind: target.kind, name: name.trim() };
    if (target.needsSave) {
      // Desktop VS Code exposes the untitled workspace ID; locate it under this profile's user-data root.
      // Read the existing JSONC rather than reconstructing settings (which would lose tasks/launch).
      const source = vscode.Uri.file(untitledSource(store.dir, target.uri.path));
      let text;
      const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === source.toString());
      try { text = document ? document.getText() : Buffer.from(await vscode.workspace.fs.readFile(source)).toString('utf8'); }
      catch { throw Error('无法读取当前工作区配置，未保存收藏。请重试；若仍失败，可使用“将当前工作区另存为”。'); }
      const data = snapshot(text, vscode.workspace.workspaceFolders || []);
      const file = await writeManaged(store.dir, entry.name, data);
      entry = { ...entry, uri: vscode.Uri.file(file).toString(), managed: true, source: target.uri.toString() };
      await store.change(rows => { const index = rows.findIndex(e => e.source === entry.source); if (index < 0) rows.push(entry); else rows[index] = entry; });
    } else {
      // Re-collecting a managed workspace must retain its management metadata.
      await store.change(rows => { const i = rows.findIndex(e => e.uri === entry.uri); if (i < 0) rows.push(entry); else rows[i] = { ...rows[i], ...entry }; });
    }
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
    if (await vscode.window.showInformationMessage('已删除工作区收藏，磁盘上的项目文件未删除。', '撤销') === '撤销') {
      // Do not overwrite a newer entry created in another window.
      await store.change(rows => { if (!rows.some(e => e.uri === entry.uri)) rows.push(entry); }); refresh();
    }
  });
  context.subscriptions.push(event, vscode.window.createTreeView('workspaceShelf.list', { treeDataProvider: provider }),
    vscode.window.onDidChangeWindowState(e => { if (e.focused) refresh(); }));
}
module.exports = { activate, currentTarget };
