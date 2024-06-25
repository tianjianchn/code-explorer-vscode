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
    vscode.commands.registerCommand(
      'codeExplorer.stackView.actions',
      async () => {
        const { stack } = await markerService.getCurrentStack();

        const pickItems: (vscode.QuickPickItem & {
          id:
            | 'rename'
            | 'remove'
            | 'switch'
            | 'refresh'
            | 'selectMarker'
            | 'selectMarkerAll';
        })[] = [
          { label: 'Goto a marker of current stack', id: 'selectMarker' },
          { label: 'Goto a marker of all stacks', id: 'selectMarkerAll' },
          { label: 'Rename current stack', id: 'rename' },
          { label: 'Remove current stack', id: 'remove' },
          { label: 'Switch stack', id: 'switch' },
          { label: 'Refresh stacks', id: 'refresh' },
        ];

        const selected = await vscode.window.showQuickPick(pickItems, {
          title: 'Stack Actions of Code Explorer',
          placeHolder: 'Current stack: ' + (stack ? stack.title : '<none>'),
        });
        if (!selected) return;

        switch (selected.id) {
          case 'selectMarker':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.selectMarker'
            );
          case 'selectMarkerAll':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.selectMarkerAll'
            );
          case 'rename':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.renameStack'
            );
          case 'remove':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.removeStack'
            );
          case 'refresh':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.refresh'
            );
          case 'switch':
            return vscode.commands.executeCommand(
              'codeExplorer.stackView.loadStack'
            );
          default:
            const exhausted: never = selected.id;
            throw new Error('Unhandled action: ' + exhausted);
        }
      }
    );

    vscode.commands.registerCommand('codeExplorer.stackView.refresh', () => {
      this._provider.refresh();
    });
    markerService.onDataUpdated(() => this._provider.refresh());

    vscode.commands.registerCommand(
      'codeExplorer.stackView.loadStack',
      async () => {
        const [stacks, { stack: curr }] = await Promise.all([
          markerService.getStacks(),
          markerService.getCurrentStack(),
        ]);
        const pickItems: (vscode.QuickPickItem & { id: string | null })[] =
          stacks.map((s) => ({
            label: (s.id === curr?.id ? '* ' : '') + s.title,
            id: s.id,
          }));
        pickItems.unshift({
          label: 'Create new stack',
          id: null,
          picked: false,
        });

        const selected = await vscode.window.showQuickPick(pickItems, {
          title: 'Switch Stack of Code Explorer',
          placeHolder: 'Current stack: ' + (curr?.title ?? '<none>'),
          matchOnDescription: true,
          matchOnDetail: true,
        });
        if (!selected) return;

        if (!selected.id) {
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
      'codeExplorer.stackView.selectMarker',
      async () => {
        const { stack, markers } = await markerService.getCurrentStack();

        await showMarkers(
          'Select a marker of current stack: ' + stack?.title,
          markers
        );
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.selectMarkerAll',
      async () => {
        const markers = await markerService.getAllMarkers();
        await showMarkers('Select a marker in ALL stacks', markers);
      }
    );

    async function showMarkers(title: string, markers: Marker[]) {
      if (!markers.length) {
        await vscode.window.showQuickPick([{ label: 'No markers' }]);
        return;
      }

      const pickItems: (vscode.QuickPickItem & { marker: Marker })[] =
        markers.map((m) => ({
          label: getMarkerTitle(m),
          description: getMarkerDesc(m),
          marker: m,
        }));

      const selected = await vscode.window.showQuickPick(pickItems, {
        title,
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!selected) return;

      const selectedMarker = selected.marker;
      await vscode.commands.executeCommand(
        'codeExplorer.stackView.openMarker',
        selectedMarker
      );
    }

    vscode.commands.registerCommand(
      'codeExplorer.stackView.openMarker',
      async (el?: TreeElement) => {
        if (!el) {
          return await vscode.commands.executeCommand(
            'codeExplorer.stackView.selectMarker'
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

function getMarkerTitle(marker: Marker) {
  return marker.title ?? marker.text;
}

function getMarkerDesc(marker: Marker) {
  return `${getRelativeFilePath(marker.file)}:${marker.line + 1}:${
    marker.column + 1
  }`;
}
