const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const Module=require('node:module');
const {pathToFileURL,fileURLToPath}=require('node:url');
const {Store}=require('../src/store');
function uri(value){ const u=new URL(value);return {scheme:u.protocol.slice(0,-1),path:decodeURIComponent(u.pathname),authority:u.host,fsPath:u.protocol==='file:'?fileURLToPath(u):u.pathname,toString:()=>u.href,with:({scheme})=>uri(scheme+':'+value.slice(value.indexOf(':')+1))}; }
test('one save command captures untitled workspace; rename updates durable bookmark and filename',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'shelf-flow-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const backing=path.join(dir,'Workspaces','sample');await fs.mkdir(backing,{recursive:true});
 await fs.writeFile(path.join(backing,'workspace.json'),'{"folders":[],"settings":{"editor.tabSize":8},"tasks":{"version":"2.0.0","tasks":[]}}');
 const commands=new Map(),errors=[];let input='我的工作区';let inputCount=0;
 const folders=[{name:'a',uri:uri('file:///example/a')},{name:'b',uri:uri('vscode-remote://ssh-remote+example/home/b')}];
 const mock={ConfigurationTarget:{Workspace:2},Uri:{parse:uri,file:p=>uri(pathToFileURL(p).href),joinPath:(u,p)=>uri(pathToFileURL(path.join(u.fsPath,p)).href)},
  EventEmitter:class{event=()=>{};fire(){};dispose(){}},
  workspace:{getConfiguration:()=>({inspect:()=>({}),update:async()=>{}}),workspaceFile:uri('untitled:/sample'),workspaceFolders:folders,textDocuments:[],fs:{readFile:u=>fs.readFile(u.fsPath)}},
  window:{tabGroups:{all:[]},showInputBox:async()=>{inputCount++;return input;},showInformationMessage:async()=>undefined,showErrorMessage:m=>errors.push(m),createTreeView:()=>({dispose(){}}),onDidChangeWindowState:()=>({dispose(){}})},
  commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return {dispose(){}}},executeCommand:async(id,target,options)=>{assert.equal(id,'vscode.openFolder');assert.equal(options.forceReuseWindow,true);await fs.stat(target.fsPath);}}};
 const previous=Module._load;Module._load=function(id,...args){return id==='vscode'?mock:previous.call(this,id,...args)};
 delete require.cache[require.resolve('../src/extension')];let extension;try{extension=require('../src/extension')}finally{Module._load=previous}
 const storage=path.join(dir,'User','globalStorage','to-re.workspace-manager');extension.activate({extension:{packageJSON:{version:'test'}},globalStorageUri:{fsPath:storage},subscriptions:[]});
 await commands.get('workspaceShelf.save')();assert.equal(inputCount,0);assert.deepEqual(errors,[]);
 const store=new Store(storage);let entries=(await store.read()).entries;assert.equal(entries.length,1);assert.equal(entries[0].managed,true);
 const firstFile=fileURLToPath(entries[0].uri);const data=JSON.parse(await fs.readFile(firstFile,'utf8'));assert.equal(data.settings['editor.tabSize'],8);assert.ok(data.tasks);assert.equal(data.folders[1].uri,folders[1].uri.toString());
 input='改名后的工作区';await commands.get('workspaceShelf.rename')(entries[0]);entries=(await new Store(storage).read()).entries;assert.equal(entries[0].name,input);assert.equal(path.basename(fileURLToPath(entries[0].uri)),input+'.code-workspace');assert.deepEqual(errors,[]);await fs.stat(firstFile);
 // Saving this same untitled workspace again updates its record instead of duplicating it.
 await commands.get('workspaceShelf.save')();assert.equal((await store.read()).entries.length,1);
});
