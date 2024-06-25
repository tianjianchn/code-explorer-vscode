import * as vscode from 'vscode';
import {
  Marker,
  getMarkerClipboardText,
  getMarkerDesc,
  getMarkerTitle,
  markerService,
} from './markerService';
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
      'codeExplorer.stackView.openMarker',
      async (el?: TreeElement) => {
        if (!el) {
          return await vscode.commands.executeCommand(
            'codeExplorer.selectMarker'
          );
        }

        if (el.type !== 'marker') return;

        const selection = new vscode.Selection(
          new vscode.Position(el.line, el.column),
          new vscode.Position(el.line, el.column)
        );

        // const doc = await vscode.workspace.openTextDocument(el.file);
        // vscode.window.showTextDocument(doc, {
        //   selection,
        // });

        await vscode.commands.executeCommand(
          // see https://code.visualstudio.com/api/references/commands
          'vscode.openWith',
          vscode.Uri.file(el.file),
          'default',
          {
            selection,
          } as vscode.TextDocumentShowOptions
        );
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.copyMarker',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        await vscode.env.clipboard.writeText(getMarkerClipboardText(el));
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

    const label = getMarkerTitle(element);

    return {
      label,
      command: {
        command: 'codeExplorer.stackView.openMarker',
        arguments: [element],
        title: 'Click to go',
      },
      description: getMarkerDesc(element),
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
    if (!target) return;

    const transferItem = dataTransfer.get(
      'application/vnd.code.tree.codeExplorerStackView'
    );
    if (!transferItem) {
      return;
    }

    const treeItems: Marker[] = transferItem.value;
    markerService.moveMarker(treeItems[0].id, target.id);
  }
}
