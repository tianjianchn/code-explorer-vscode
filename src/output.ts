import * as vscode from 'vscode';
import { extensionEnv } from './extensionEnv';
import { getDateTimeStr } from './util';

class Output {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel('Code Explorer');
  }

  dispose() {
    this.channel.dispose();
  }

  log(message: string) {
    const str = `${getDateTimeStr(new Date())} ${message}`;
    this.channel.appendLine(str);
    return str;
  }

  activate() {
    const context = extensionEnv.getExtensionContext();

    vscode.commands.registerCommand('codeExplorer.showOutput', async () => {
      this.channel.show(false);
    });
  }
}

export const output = new Output();
