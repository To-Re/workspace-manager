const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { snapshot, writeManaged, readManaged } = require('../src/managed');
const folders = [{name:'项目甲',uri:{toString:()=> 'file:///example/a'}},{name:'项目乙',uri:{toString:()=> 'vscode-remote://ssh-remote+example/home/b'}}];
test('snapshot preserves JSONC settings, tasks, launch, extensions and remote authority', () => {
 const text = '{ // comment\n "folders":[{"path":"../old"}],"settings":{"editor.tabSize":4},"tasks":{"version":"2.0.0","tasks":[]},"launch":{"configurations":[]},"extensions":{"recommendations":["example.tool"]},"remoteAuthority":"ssh-remote+example",}';
 const data = snapshot(text, folders);
 assert.deepEqual(data.folders,folders.map(f=>({name:f.name,uri:f.uri.toString()})));
 assert.equal(data.settings['editor.tabSize'],4);assert.ok(data.tasks);assert.ok(data.launch);assert.ok(data.extensions);assert.equal(data.remoteAuthority,'ssh-remote+example');
});
test('invalid source fails instead of dropping settings', () => { assert.throws(()=>snapshot('{"folders":[],broken}',folders)); });
test('managed renamed copy retains content and original, safe filenames cannot escape storage', async t => {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shelf-managed-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const data=snapshot('{"folders":[],"settings":{"x":1}}',folders);
 const old=await writeManaged(dir,'原名',data);const next=await writeManaged(dir,'新名字',await readManaged(dir,old));
 assert.equal(path.basename(next),'新名字.code-workspace');assert.deepEqual(await readManaged(dir,next),data);assert.deepEqual(await readManaged(dir,old),data);
 const unsafe=await writeManaged(dir,'../../escape',data);assert.ok(unsafe.startsWith(path.join(dir,'managed')+path.sep));assert.equal(path.basename(unsafe),'.._.._escape.code-workspace');
 const outside=path.join(dir,'outside.json');await fs.writeFile(outside,'{"folders":[]}');await assert.rejects(readManaged(dir,outside));
});
