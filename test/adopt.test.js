'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { adoptUntitled } = require('../src/adopt');
function fixture() {
  const source = { scheme: 'untitled', toString: () => 'untitled:/example' };
  const target = { scheme: 'file', toString: () => 'file:///saved.code-workspace' };
  const writes = [];
  const v = { ConfigurationTarget: { Workspace: 2 }, workspace: {
    workspaceFile: source,
    getConfiguration: () => ({ inspect: () => ({ workspaceValue: true }), update: async (...args) => writes.push(args) })
  }, commands: { executeCommand: async (id, uri, options) => {
    assert.equal(id, 'vscode.openFolder'); assert.equal(uri, target); assert.equal(options.forceReuseWindow, true);
    v.workspace.workspaceFile = target;
  } } };
  return { v, target, writes };
}
test('adopts untitled workspace, suppressing only the already-saved source prompt', async () => {
  const { v, target, writes } = fixture();
  await adoptUntitled(v, target);
  assert.equal(v.workspace.workspaceFile, target);
  assert.deepEqual(writes, [['confirmSaveUntitledWorkspace', false, 2]]);
});
for (const failed of [false, true]) test(`restores prompt when workspace switch is ${failed ? 'rejected' : 'cancelled'}`, async () => {
  const { v, target, writes } = fixture();
  v.commands.executeCommand = async () => { if (failed) throw Error('switch rejected'); };
  if (failed) await assert.rejects(adoptUntitled(v, target), /switch rejected/);
  else await adoptUntitled(v, target);
  assert.deepEqual(writes, [['confirmSaveUntitledWorkspace', false, 2], ['confirmSaveUntitledWorkspace', true, 2]]);
});
test('saved and folder-only windows do not switch or change prompt preferences', async () => {
  const { v, target, writes } = fixture();
  v.commands.executeCommand = async () => assert.fail('unexpected switch');
  for (const current of [undefined, target]) { v.workspace.workspaceFile = current; await adoptUntitled(v, target); }
  assert.deepEqual(writes, []);
});
