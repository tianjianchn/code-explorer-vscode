import * as vscode from 'vscode';

class ExtensionEnv {
  private extensionContext!: vscode.ExtensionContext;

  private _onActivatedEmitter: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onActivated: vscode.Event<void> = this._onActivatedEmitter.event;

  setExtensionContext(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this._onActivatedEmitter.fire();
  }

  getExtensionContext() {
    return this.extensionContext;
  }

  isDev() {
    if (typeof this.extensionContext === 'undefined') {
      throw new Error('Code Explorer is not yet activated.');
    }
    return (
      this.extensionContext.extensionMode !== vscode.ExtensionMode.Production
    );
  }
}

export const extensionEnv = new ExtensionEnv();
