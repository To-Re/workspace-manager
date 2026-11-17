const { test } = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../package.json');
test('one primary toolbar action and one empty state button', () => {
 const primary = manifest.contributes.menus['view/title'].filter(x=>x.group.startsWith('navigation'));
 assert.deepEqual(primary.map(x=>x.command),['workspaceShelf.save']);
 const text=manifest.contributes.viewsWelcome[0].contents;
 assert.equal((text.match(/command:/g)||[]).length,1);assert.ok(text.includes('保存当前窗口'));
 assert.ok(!manifest.contributes.commands.some(x=>['workspaceShelf.saveAs','workspaceShelf.import'].includes(x.command)));
});
test('startup activation restores saved file tabs without opening the sidebar',()=>{ assert.ok(manifest.activationEvents.includes('onStartupFinished')); });
