const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
async function setup(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-shelf-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return new Store(dir); }
const entry = (uri = 'file:///example/project', name = '项目') => ({ uri, name, kind: 'folder' });
test('save survives restart; same URI updates without duplicates', async t => { const s = await setup(t); await s.save(entry()); await s.save(entry(undefined, '新名字')); assert.deepEqual((await new Store(s.dir).read()).entries, [entry(undefined,'新名字')]); });
test('different SSH hosts with the same path remain separate', async t => { const s = await setup(t); await s.save(entry('vscode-remote://ssh-remote+one/home/project')); await s.save(entry('vscode-remote://ssh-remote+two/home/project')); assert.equal((await s.read()).entries.length, 2); });
test('concurrent windows do not lose writes', async t => { const s = await setup(t); await Promise.all(Array.from({length: 10}, (_,i) => new Store(s.dir).save(entry('file:///project'+i)))); assert.equal((await s.read()).entries.length, 10); });
test('rename and removal survive re-open', async t => { const s = await setup(t); await s.save(entry()); await s.rename(entry().uri,'changed'); assert.equal((await s.read()).entries[0].name,'changed'); await s.remove(entry().uri); assert.deepEqual((await new Store(s.dir).read()).entries,[]); });
test('corrupt storage is not overwritten and lock is released', async t => { const s = await setup(t); await fs.writeFile(s.file,'not json'); await assert.rejects(s.save(entry())); assert.equal(await fs.readFile(s.file,'utf8'),'not json'); await assert.rejects(fs.stat(s.file+'.lock'), { code: 'ENOENT' }); });
test('unsafe URI is rejected without damaging valid storage', async t => { const s = await setup(t); await s.save(entry()); await assert.rejects(s.save(entry('command:delete'))); assert.deepEqual((await s.read()).entries, [entry()]); });
