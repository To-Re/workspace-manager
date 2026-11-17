'use strict';
const path = require('node:path');
const { createHash } = require('node:crypto');
const { snapshot, untitledSource } = require('./managed');
const allowed = uri => ['file', 'vscode-remote'].includes(uri.scheme);
function editorsOf(vscode) {
  const editors = [];
  const seen = new Set();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const uri = tab.input?.uri;
      if (!uri || (!allowed(uri) && uri.scheme !== 'untitled')) continue;
      const key = uri.toString() + ':' + group.viewColumn;
      if (seen.has(key)) continue;
      seen.add(key);
      const doc = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
      const entry = { uri: uri.toString(), column: group.viewColumn, active: tab.isActive && group.isActive };
      if (doc && (doc.isDirty || uri.scheme === 'untitled')) {
        entry.draft = { content: doc.getText(), language: doc.languageId };
      }
      if (uri.scheme !== 'untitled' || entry.draft) editors.push(entry);
    }
  }
  return editors;
}
async function captureWindow(vscode, storageDir) {
  const workspace = vscode.workspace;
  const folders = workspace.workspaceFolders || [];
  const editors = editorsOf(vscode);
  if (!folders.length && !editors.length && !workspace.workspaceFile) throw Error('当前窗口没有可保存的文件或文件夹。');
  let data = { folders: folders.map(f => ({ name: f.name, uri: f.uri.toString() })) };
  const source = workspace.workspaceFile;
  if (source) {
    const file = source.scheme === 'untitled' ? vscode.Uri.file(untitledSource(storageDir, source.path)) : source;
    const doc = workspace.textDocuments.find(d => d.uri.toString() === file.toString());
    const text = doc ? doc.getText() : Buffer.from(await workspace.fs.readFile(file)).toString('utf8');
    data = snapshot(text, folders);
  }
  data.workspaceShelf = { version: 1, editors };
  const sourceKey = source ? source.toString() : 'window:' + createHash('sha256').update(JSON.stringify(folders.length ? folders.map(f=>f.uri.toString()).sort() : editors.map(e=>e.uri).sort())).digest('hex');
  const name = folders.length ? folders.map(f=>f.name).join(' + ') : editors.slice(0,2).map(e=>path.posix.basename(vscode.Uri.parse(e.uri).path)).join(' + ') || '工作区';
  return { data, source: sourceKey, name };
}
async function restoreEditors(vscode, editors) {
  if (!Array.isArray(editors)) return;
  // Restore the active editor last so it gets focus, keeping other tabs pinned.
  for (const e of [...editors].sort((a,b)=>Number(!!a.active)-Number(!!b.active))) {
    const uri = vscode.Uri.parse(e.uri);
    const options = { preview: false, preserveFocus: !e.active, viewColumn: Number.isInteger(e.column) && e.column>=1 && e.column<=9 ? e.column : 1 };
    if (e.draft && typeof e.draft.content === 'string' && typeof e.draft.language === 'string') {
      // Never overwrite the original file or an existing dirty buffer when restoring a snapshot.
      const original = vscode.workspace.textDocuments.find(d=>d.uri.toString()===e.uri);
      if (original && original.isDirty && original.getText() === e.draft.content) continue;
      const document = await vscode.workspace.openTextDocument({ content: e.draft.content, language: e.draft.language });
      await vscode.window.showTextDocument(document, options);
    } else if (allowed(uri)) {
      await vscode.commands.executeCommand('vscode.open', uri, options);
    }
  }
}
module.exports = { editorsOf, captureWindow, restoreEditors };
