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
  implements
    vscode.TreeDataProvider<TreeElement>,
    vscode.TreeDragAndDropController<Marker>
{
  private static _view: vscode.TreeView<TreeElement>;
  private static _provider: MarkerTreeViewProvider;

  static register() {
    const context = extensionEnv.getExtensionContext();

    this._provider = new MarkerTreeViewProvider();
    const view = vscode.window.createTreeView('codeExplorer.stackView', {
      treeDataProvider: this._provider,
      dragAndDropController: this._provider,
      showCollapseAll: true,
    });
    context.subscriptions.push(view);
    this._view = view;

    this.registerCommands();
  }

  private static registerCommands() {
    vscode.commands.registerCommand('codeExplorer.stackView.refresh', () => {
      this._provider.refresh();
    });
    markerService.onDataUpdated(() => this._provider.refresh());

    vscode.commands.registerCommand(
      'codeExplorer.stackView.actions',
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
              'codeExplorer.stackView.renameStack'
            );
          case 'Remove':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.removeStack'
            );
          case 'Refresh':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.refresh'
            );
          case 'Switch':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.loadStack'
            );
        }
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.loadStack',
      async () => {
        const [stacks, { stack: curr }] = await Promise.all([
          markerService.getStacks(),
          markerService.getCurrentStack(),
        ]);
        const pickItems: (vscode.QuickPickItem & { id: number })[] = stacks.map(
          (s) => ({
            label: (s.id === curr?.id ? '* ' : '') + s.title,
            id: s.id,
          })
        );
        pickItems.unshift({ label: 'Create new stack', id: -1, picked: false });

        const selected = await vscode.window.showQuickPick(pickItems, {
          title: 'Switch Stack of Code Explorer',
          placeHolder: 'Current stack: ' + (curr?.title ?? '<none>'),
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
      'codeExplorer.stackView.renameStack',
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
      'codeExplorer.stackView.removeStack',
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
      'codeExplorer.stackView.clickMarker',
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
      'codeExplorer.stackView.removeMarker',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        markerService.removeMarker(el.id);
      }
    );
  }

  // =========================================================
  // Instance properties and methods below
  // =========================================================
  dropMimeTypes = ['application/vnd.code.tree.codeExplorerStackView'];
  dragMimeTypes = ['application/vnd.code.tree.codeExplorerStackView'];

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
        command: 'codeExplorer.stackView.clickMarker',
        arguments: [element],
        // command: 'vscode.open',
        // arguments: [
        //   vscode.Uri.file(element.file).with({
        //     fragment: 'L' + element.line + ',' + element.column,
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

  handleDrag?(
    source: readonly Marker[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    dataTransfer.set(
      'application/vnd.code.tree.codeExplorerStackView',
      new vscode.DataTransferItem(source)
    );
  }
  handleDrop?(
    target: Marker | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    const transferItem = dataTransfer.get(
      'application/vnd.code.tree.codeExplorerStackView'
    );
    if (!transferItem) {
      return;
    }

    const treeItems: Marker[] = transferItem.value;
    markerService.moveMarker(treeItems[0].id, target?.id);
  }
}
