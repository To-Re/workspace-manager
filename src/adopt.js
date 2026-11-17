'use strict';

// Only the untitled source needs adopting. Change its workspace-scoped prompt
// setting after the durable snapshot exists, never the user's global preference.
async function adoptUntitled(vscode, target) {
  const source = vscode.workspace.workspaceFile;
  if (source?.scheme !== 'untitled') return;
  const config = vscode.workspace.getConfiguration('window');
  const previous = config.inspect('confirmSaveUntitledWorkspace')?.workspaceValue;
  try {
    await config.update('confirmSaveUntitledWorkspace', false, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('vscode.openFolder', target, { forceReuseWindow: true });
  } finally {
    // A cancelled/failed switch leaves this host running: restore its prompt.
    // A successful switch unloads this host; the new snapshot has the original settings.
    if (vscode.workspace.workspaceFile?.toString() === source.toString()) {
      await config.update('confirmSaveUntitledWorkspace', previous, vscode.ConfigurationTarget.Workspace);
    }
  }
}

module.exports = { adoptUntitled };
