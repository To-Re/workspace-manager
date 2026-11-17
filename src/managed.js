'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parse } = require('jsonc-parser');
function untitledSource(storageDir, uriPath) {
  // VS Code exposes only the untitled workspace ID, not the backing absolute path.
  const id = uriPath.replace(/^\//, '');
  if (!id || id === '.' || id === '..' || /[/\\]/.test(id)) throw Error('未命名工作区标识无效，未保存任何内容。');
  let user = path.resolve(storageDir);
  for (let depth = 0; depth < 8; depth++) {
    if (path.basename(user) === 'User') return path.join(path.dirname(user), 'Workspaces', id, 'workspace.json');
    user = path.dirname(user);
  }
  throw Error('无法定位当前 VS Code 用户数据目录，未保存任何内容。');
}
function parseWorkspace(text) {
  const errors = [];
  const data = parse(text, errors, { allowTrailingComma: true });
  if (errors.length || !data || !Array.isArray(data.folders)) throw Error('当前工作区配置无法解析，未覆盖任何内容。请修正工作区配置后重试。');
  return data;
}
function snapshot(text, folders) {
  const data = parseWorkspace(text);
  // Resolve folders with VS Code, rather than retaining paths relative to the old file.
  data.folders = folders.map(f => ({ name: f.name, uri: f.uri.toString() }));
  return data;
}
async function writeManaged(dir, name, data) {
  const filename = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/,'').slice(0,60) || '工作区';
  const folder = path.join(dir, 'managed', randomUUID());
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, filename + '.code-workspace');
  await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return file;
}
async function readManaged(dir, file) {
  const root = await fs.realpath(path.join(dir, 'managed'));
  const actual = await fs.realpath(file);
  const rel = path.relative(root, actual);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw Error('工作区文件不在插件保存目录内，未修改。');
  return parseWorkspace(await fs.readFile(actual, 'utf8'));
}
module.exports = { parseWorkspace, snapshot, writeManaged, readManaged, untitledSource };
