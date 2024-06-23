import * as vscode from 'vscode';
import { Marker, markerService } from './markerService';
import { extensionEnv } from './extensionEnv';
import { getDateTimeStr, getRelativeFilePath } from './util';

interface LabelElement {
  type: 'label';
  label: string;
}

type TreeElement = Marker | LabelElement;

export class MarkerTreeViewProvider
  implements vscode.TreeDataProvider<TreeElement>
{
  private static _view: vscode.TreeView<TreeElement>;
  private static _provider: MarkerTreeViewProvider;

  static register() {
    const context = extensionEnv.getExtensionContext();

    this._provider = new MarkerTreeViewProvider();
    const view = vscode.window.createTreeView('codeExplorer.markerTreeView', {
      treeDataProvider: this._provider,
      showCollapseAll: true,
    });
    context.subscriptions.push(view);
    this._view = view;

    this.registerCommands();
  }

  private static registerCommands() {
    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.refresh',
      () => {
        this._provider.refresh();
      }
    );
    markerService.onDataUpdated(() => this._provider.refresh());

    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.actions',
      async () => {
        const { stack } = await markerService.getCurrentStack();

        const pickItems: vscode.QuickPickItem[] = [
          { label: 'Rename' },
          { label: 'Remove' },
          { label: 'Switch' },
          // { label: 'Refresh' },
        ];

        const selected = await vscode.window.showQuickPick(pickItems, {
          title: 'Stack Actions of Code Explorer',
          placeHolder:
            'Select an action for current stack: ' +
            (stack ? stack.title : '<none>'),
        });
        if (!selected) return;

        switch (selected.label) {
          case 'Rename':
            return vscode.commands.executeCommand(
              'codeExplorer.markerTreeView.renameStack'
            );
          case 'Remove':
            return vscode.commands.executeCommand(
              'codeExplorer.markerTreeView.removeStack'
            );
          case 'Refresh':
            return vscode.commands.executeCommand(
              'codeExplorer.markerTreeView.refresh'
            );
          case 'Switch':
            return vscode.commands.executeCommand(
              'codeExplorer.markerTreeView.loadStack'
            );
        }
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.loadStack',
      async () => {
        const [stacks, { stack: curr }] = await Promise.all([
          markerService.getStacks(),
          markerService.getCurrentStack(),
        ]);
        const pickItems: (vscode.QuickPickItem & { id: number })[] = stacks.map(
          (s) => ({
            label: s.title,
            id: s.id,
            picked: s.id === curr?.id,
          })
        );
        pickItems.unshift({ label: 'Create new stack', id: -1, picked: false });

        const selected = await vscode.window.showQuickPick(pickItems, {
          title: 'Switch Stack of Code Explorer',
        });
        if (!selected) return;

        if (selected.id < 0) {
          await markerService.createStack();
        } else {
          await markerService.switchStack(selected.id);
        }
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.renameStack',
      async () => {
        const { stack } = await markerService.getCurrentStack();
        if (!stack) {
          return;
        }
        const ans = await vscode.window.showInputBox({
          placeHolder: stack.title,
        });
        if (!ans) return;
        await markerService.renameStack(stack.id, ans);
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.removeStack',
      async () => {
        const { stack, markers } = await markerService.getCurrentStack();
        if (!stack) {
          return;
        }
        const ans = await vscode.window.showInformationMessage(
          'Do you really want to delete stack: ' + stack.title + '?',
          'Delete',
          'Cancel'
        );
        if (ans === 'Delete') {
          await markerService.removeStack(stack.id);
        }
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.clickMarker',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        const doc = await vscode.workspace.openTextDocument(el.file);
        vscode.window.showTextDocument(doc, {
          selection: new vscode.Selection(
            new vscode.Position(el.line, el.column),
            new vscode.Position(el.line, el.column)
          ),
        });
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.markerTreeView.removeMarker',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        markerService.removeMarker(el.id);
      }
    );
  }

  private _onDidChangeTreeData: vscode.EventEmitter<TreeElement | void> =
    new vscode.EventEmitter<TreeElement | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeElement | void> =
    this._onDidChangeTreeData.event;

  constructor() {}

  async refresh() {
    this._onDidChangeTreeData.fire();
  }

  async getChildren(element?: TreeElement): Promise<TreeElement[]> {
    if (!element) {
      const { stack, markers } = await markerService.getCurrentStack();

      if (markers.length <= 0) {
        let label = 'No markers';
        if (stack?.title) {
          label += ' for stack ' + stack.title;
        }

        return [
          {
            type: 'label',
            label,
          },
        ];
      }
      return markers;
    }
    return [];
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    if (element.type === 'label') {
      return {
        label: element.label,
        contextValue: '',
      };
    }

    const label = `${element.title ?? element.text}`;

    return {
      label,
      command: {
        command: 'codeExplorer.markerTreeView.clickMarker',
        arguments: [element],
        // command: 'vscode.open',
        // arguments: [
        //   vscode.Uri.file(element.file).with({
        //     fragment: ':' + element.line + ':' + element.column,
        //   }),
        // ],
        title: 'Click to go',
      },
      description: `${getRelativeFilePath(element.file)}:${element.line + 1}:${
        element.column + 1
      }`,
      tooltip: 'Created at ' + getDateTimeStr(element.createdAt),
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      contextValue: 'marker',
    };
  }
}
