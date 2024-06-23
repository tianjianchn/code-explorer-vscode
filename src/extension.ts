import * as vscode from 'vscode';
import { MarkerTreeViewProvider } from './treeView';
import { extensionEnv } from './extensionEnv';
import { registerCommands } from './commands';
import { output } from './output';

export function activate(context: vscode.ExtensionContext) {
  extensionEnv.setExtensionContext(context);

  registerCommands();
  MarkerTreeViewProvider.register();

  output.activate();

  output.log('Code Explorer is activated');
}

export function deactivate() {}
