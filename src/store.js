'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
function validate(data) {
  if (data.version !== 1 || !Array.isArray(data.entries)) throw Error('收藏文件格式不受支持，请先备份后检查文件。');
  const seen = new Set();
  for (const e of data.entries) {
    if (!e || typeof e.uri !== 'string' || !/^(file|vscode-remote):/.test(e.uri) ||
        typeof e.name !== 'string' || !e.name.trim() || !['folder','workspace'].includes(e.kind) || seen.has(e.uri)) {
      throw Error('收藏文件包含无效记录，原文件已保留。');
    }
    seen.add(e.uri);
  }
  return data;
}
class Store {
  constructor(dir) { this.dir = dir; this.file = path.join(dir, 'workspaces.json'); }
  async read() {
    try { return validate(JSON.parse(await fs.readFile(this.file, 'utf8'))); }
    catch (e) { if (e.code === 'ENOENT') return { version: 1, entries: [] }; throw e; }
  }
  async change(edit) {
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
    const lock = this.file + '.lock';
    let handle;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { handle = await fs.open(lock, 'wx', 0o600); break; }
      catch (e) { if (e.code !== 'EEXIST') throw e; await new Promise(r => setTimeout(r, 50)); }
    }
    if (!handle) throw Error('其他窗口正在更新收藏，或上次写入被中断。请稍后刷新；持续失败请查看 README 的恢复说明。');
    const tmp = this.file + '.' + randomUUID() + '.tmp';
    try {
      const data = await this.read();
      await edit(data.entries);
      validate(data);
      await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(tmp, this.file);
    } finally {
      await fs.rm(tmp, { force: true });
      await handle.close();
      await fs.unlink(lock);
    }
  }
  async save(entry) { await this.change(rows => { const i = rows.findIndex(e => e.uri === entry.uri); if (i < 0) rows.push(entry); else rows[i] = entry; }); }
  async rename(uri, name) { await this.change(rows => { const e = rows.find(e => e.uri === uri); if (!e) throw Error('记录已被其他窗口移除，请刷新。'); e.name = name; }); }
  async remove(uri) { await this.change(rows => { const i = rows.findIndex(e => e.uri === uri); if (i >= 0) rows.splice(i, 1); }); }
}
module.exports = { Store, validate };
