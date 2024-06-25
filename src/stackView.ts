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

interface MarkerElement {
  type: 'marker';
  marker: Marker;
}

type TreeElement = MarkerElement | LabelElement;

export class MarkerTreeViewProvider
  implements
    vscode.TreeDataProvider<TreeElement>,
    vscode.TreeDragAndDropController<MarkerElement>
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
        const m = el.marker;

        const selection = new vscode.Selection(
          new vscode.Position(m.line, m.column),
          new vscode.Position(m.line, m.column)
        );

        // const doc = await vscode.workspace.openTextDocument(el.file);
        // vscode.window.showTextDocument(doc, {
        //   selection,
        // });

        await vscode.commands.executeCommand(
          // see https://code.visualstudio.com/api/references/commands
          'vscode.openWith',
          vscode.Uri.file(m.file),
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

        await vscode.env.clipboard.writeText(getMarkerClipboardText(el.marker));
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.deleteMarker',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        markerService.deleteMarker(el.marker.id);
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
      return markers.map((m) => ({ type: 'marker', marker: m }));
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

    const m = element.marker;
    const label = getMarkerTitle(m);

    return {
      label,
      command: {
        command: 'codeExplorer.stackView.openMarker',
        arguments: [element],
        title: 'Click to go',
      },
      description: getMarkerDesc(m),
      tooltip: 'Created at ' + getDateTimeStr(m.createdAt),
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      contextValue: 'marker',
    };
  }

  handleDrag?(
    source: readonly MarkerElement[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    dataTransfer.set(
      'application/vnd.code.tree.codeExplorerStackView',
      new vscode.DataTransferItem(source)
    );
  }

  handleDrop?(
    target: MarkerElement | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    if (!target || target.type !== 'marker') return;

    const transferItem = dataTransfer.get(
      'application/vnd.code.tree.codeExplorerStackView'
    );
    if (!transferItem) {
      return;
    }

    const treeItems = transferItem.value;
    markerService.moveMarker(treeItems[0].marker.id, target.marker.id);
  }
}
