import * as vscode from 'vscode';
import { MarkerTreeViewProvider } from './stackView';
import { extensionEnv } from './extensionEnv';
import { registerCommands } from './commands';
import { output } from './output';
import { markerService } from './markerService';
import { activateDecoration } from './editor-decoration';

export function activate(context: vscode.ExtensionContext) {
  extensionEnv.setExtensionContext(context);

  registerCommands();
  MarkerTreeViewProvider.register();

  output.activate();

  activateDecoration();

  output.log('Code Explorer is activated');

  context.subscriptions.push(output);
  context.subscriptions.push(markerService);
}

export function deactivate() {}
