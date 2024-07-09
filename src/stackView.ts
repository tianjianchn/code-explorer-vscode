import * as vscode from 'vscode';
import {
  Marker,
  Stack,
  getMarkerClipboardText,
  getMarkerDesc,
  getMarkerTitle,
  markerService,
} from './markerService';
import { extensionEnv } from './extensionEnv';
import { getDateTimeStr, getRelativeFilePath } from './util';
import { vscodeIcons } from './icons';

interface LabelElement {
  type: 'label';
  label: string;
  chooseFolder?: boolean;
}

interface MarkerElement {
  type: 'marker';
  marker: Marker;
}

interface StackElement {
  type: 'stack';
  stack: Stack;
}

type TreeElement = MarkerElement | StackElement | LabelElement;

export const untitledStack = '<Untitled>';

export class MarkerTreeViewProvider
  implements
    vscode.TreeDataProvider<TreeElement>,
    vscode.TreeDragAndDropController<TreeElement>
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
    vscode.commands.registerCommand('codeExplorer.refresh', () => {
      this._provider.refresh();
    });
    markerService.onDataUpdated(() => this._provider.refresh());

    vscode.commands.registerCommand(
      'codeExplorer.chooseWorkspaceFolder',
      async () => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) return;
        if (folders.length === 1) {
          markerService.setWorkspaceFolder(folders[0].uri);
        } else {
          const pickItems: (vscode.QuickPickItem & { uri: vscode.Uri })[] =
            folders.map((f) => ({
              label: f.name,
              uri: f.uri,
            }));

          const selected = await vscode.window.showQuickPick(pickItems, {
            title: 'Choose the workspace folder for Code Explorer',
            matchOnDescription: true,
            matchOnDetail: true,
          });
          if (!selected) return;

          await markerService.setWorkspaceFolder(selected.uri);
        }
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.activateStack',
      async (el?: TreeElement) => {
        let stack: Stack | undefined = undefined;
        if (!el) {
          stack = await markerService.getActiveStack();
        } else if (el.type === 'stack') {
          stack = el.stack;
        }
        if (!stack) {
          const stacks = await markerService.getStacks();
          const pickItems: (vscode.QuickPickItem & { id: string | null })[] =
            stacks.map((s) => ({
              label: s.title ?? untitledStack,
              iconPath: s.isActive
                ? new vscode.ThemeIcon(
                    'circle-filled',
                    new vscode.ThemeColor('terminal.ansiGreen')
                  )
                : undefined,
              id: s.id,
            }));
          pickItems.unshift({
            label: 'Create new stack',
            id: null,
          });

          const selected = await vscode.window.showQuickPick(pickItems, {
            title: 'Activate Stack of Code Explorer',
            matchOnDescription: true,
            matchOnDetail: true,
          });
          if (!selected) return;

          if (!selected.id) {
            stack = await markerService.createStack();
          } else {
            stack = stacks.find((s) => s.id === selected.id);
            if (!stack) return;
          }
        }

        await markerService.activateStack(stack.id);
        if (el) this._view.reveal(el, { focus: true, expand: 1 });
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.renameStack',
      async (el?: TreeElement) => {
        let stack: Stack | undefined = undefined;
        if (!el) {
          stack = await markerService.getActiveStack();
        } else if (el.type === 'stack') {
          stack = el.stack;
        }

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
      'codeExplorer.copyMarkers',
      async (el?: TreeElement) => {
        let stack: Stack | undefined = undefined;
        if (!el) {
          stack = await markerService.getActiveStack();
        } else if (el.type === 'stack') {
          stack = el.stack;
        }
        if (!stack) return;

        const text = stack.markers
          .map((m) => getMarkerClipboardText(m))
          .join('\n');

        await vscode.env.clipboard.writeText(text);
      }
    );
vscode.commands.registerCommand(
      'codeExplorer.copyMarkersReversed',
      async (el?: TreeElement) => {
        let stack: Stack | undefined = undefined;
        if (!el) {
          stack = await markerService.getActiveStack();
        } else if (el.type === 'stack') {
          stack = el.stack;
        }
        if (!stack) return;

        const text = stack.markers
          .slice()
          .reverse()
          .map((m) => getMarkerClipboardText(m))
          .join('\n');

        await vscode.env.clipboard.writeText(text);
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.deleteStack',
      async (el?: TreeElement) => {
        let stack: Stack | undefined = undefined;
        if (!el) {
          stack = await markerService.getActiveStack();
        } else if (el.type === 'stack') {
          stack = el.stack;
        }
        if (!stack) return;

        if (stack.markers.length) {
          const ans = await vscode.window.showInformationMessage(
            'Do you really want to delete stack: ' +
              (stack.title ?? untitledStack) +
              '?',
            'Delete',
            'Cancel'
          );
          if (ans !== 'Delete') return;
        }
        await markerService.deleteStack(stack.id);
      }
    );

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

    vscode.commands.registerCommand(
      'codeExplorer.stackView.setMarkerTitle',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        const title = await vscode.window.showInputBox({
          title: 'Set Marker Title',
          placeHolder: 'Input the title',
          value: el.marker.title,
        });
        if (title === undefined) return;
        await markerService.setTitle(el.marker.id, title);
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.setMarkerIcon',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        const pickItems: vscode.QuickPickItem[] = vscodeIcons.map((t) => ({
          label: t,
          iconPath: new vscode.ThemeIcon(t),
        }));
        const icon = await vscode.window.showQuickPick(
          [{ label: '' }].concat(pickItems),
          {
            title: 'Set Marker Icon',
            placeHolder: 'Select an icon',
          }
        );
        if (icon === undefined) return;
        await markerService.setIcon(el.marker.id, icon.label);
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.addTag',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        const tag = await vscode.window.showInputBox({
          title: 'Add Marker Tag',
          placeHolder: 'Input the tag',
        });
        if (!tag) return;
        await markerService.addTag(el.marker.id, tag);
      }
    );

    vscode.commands.registerCommand(
      'codeExplorer.stackView.deleteTag',
      async (el?: TreeElement) => {
        if (!el || el.type !== 'marker') return;

        const tags = el.marker.tags;
        if (!tags || !tags.length) {
          return vscode.window.showInformationMessage('No tags to delete');
        }

        const pickItems: vscode.QuickPickItem[] = tags.map((t) => ({
          label: t,
        }));

        const item = await vscode.window.showQuickPick(pickItems, {
          title: 'Delete Marker Tag',
          placeHolder: 'Choose a tag to delete',
        });
        if (!item) return;
        await markerService.deleteTag(el.marker.id, item.label);
      }
    );
  }

  // =========================================================
  // Instance properties and methods below
  // =========================================================
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
      const folders = vscode.workspace.workspaceFolders;
      if (!folders?.length) {
        return [
          {
            type: 'label',
            label: 'No workspace opened',
          },
        ];
      } else if (folders.length > 1) {
        const selectedFolder = markerService.getWorkspaceFolder();
        if (!selectedFolder) {
          return [
            {
              type: 'label',
              label: 'Choose a workspace folder',
              chooseFolder: true,
            },
          ];
        } else {
          await markerService.setWorkspaceFolder(selectedFolder);
        }
      } else {
        await markerService.setWorkspaceFolder(folders[0].uri);
      }

      const stacks = await markerService.getStacks();
      if (stacks.length)
        return stacks.map((s) => ({ type: 'stack', stack: s }));
      else
        return [
          {
            type: 'label',
            label: 'No stacks',
          },
        ];
    }

    const type = element.type;
    if (type === 'label') {
      return [];
    } else if (type === 'stack') {
      const markers = element.stack.markers;
      if (!markers.length) {
        return [
          {
            type: 'label',
            label: 'No markers',
          },
        ];
      }
      return markers.map((m) => ({
        type: 'marker',
        marker: m,
      }));
    } else if (type === 'marker') {
      return [];
    } else {
      const exhaustedType: never = type;
      throw new Error('Unknown element: ' + exhaustedType);
    }
  }

  async getTreeItem(element: TreeElement): Promise<vscode.TreeItem> {
    const type = element.type;
    if (type === 'label') {
      if (element.chooseFolder) {
        return {
          label: {
            label: 'Click to choose a workspace folder to load data',
            highlights: [[0, 5]],
          },
          command: {
            command: 'codeExplorer.chooseWorkspaceFolder',
            title: 'Choose workspace folder',
          },
        };
      }
      return {
        label: element.label,
        contextValue: '',
      };
    } else if (type === 'stack') {
      const stack = element.stack;

      let tooltip: string | vscode.MarkdownString =
        'Created at ' + getDateTimeStr(stack.createdAt);
      if (stack.isActive)
        tooltip = new vscode.MarkdownString(
          '**ACTIVE**(Markers will be added in this stack). ' + tooltip
        );

      return {
        label: stack.title ?? untitledStack,
        iconPath: stack.isActive
          ? new vscode.ThemeIcon(
              'circle-filled',
              new vscode.ThemeColor('terminal.ansiGreen')
            )
          : undefined,
        description: stack.markers.length + ' markers',
        tooltip,
        collapsibleState: stack.isActive
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed,
        contextValue: 'stack',
      };
    } else if (type === 'marker') {
      const m = element.marker;
      const label = getMarkerTitle(m);

      const highlights: [number, number][] = [];
      let total = 0;
      m.tags?.forEach((t) => {
        let len = 1 + t.length + 1;
        highlights.push([total + 1, total + len - 1]);
        total += len;
      });

      let tooltip: string | vscode.MarkdownString =
        'Created at ' + getDateTimeStr(m.createdAt);
      if (m.title)
        tooltip = new vscode.MarkdownString(
          'Code: `' + m.code + '`. ' + tooltip
        );

      return {
        label: { label, highlights },
        iconPath: m.icon ? new vscode.ThemeIcon(m.icon) : undefined,
        command: {
          command: 'codeExplorer.stackView.openMarker',
          arguments: [element],
          title: 'Click to go',
        },
        description: getMarkerDesc(m),
        tooltip,
        collapsibleState: vscode.TreeItemCollapsibleState.None,
        contextValue: 'marker',
      };
    } else {
      const exhaustedType: never = type;
      throw new Error('Unknown element: ' + exhaustedType);
    }
  }

  dropMimeTypes = ['application/vnd.code.tree.codeExplorer'];
  dragMimeTypes = ['application/vnd.code.tree.codeExplorer'];

  handleDrag?(
    source: readonly TreeElement[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    const el = source[0];
    const type = el.type;
    if (type === 'label') {
      return;
    } else if (type === 'stack') {
      dataTransfer.set(
        'application/vnd.code.tree.codeExplorer',
        new vscode.DataTransferItem(source)
      );
    } else if (type === 'marker') {
      dataTransfer.set(
        'application/vnd.code.tree.codeExplorer',
        new vscode.DataTransferItem(source)
      );
    } else {
      const exhaustedType: never = type;
      throw new Error('Unknown element: ' + exhaustedType);
    }
  }

  handleDrop?(
    target: TreeElement | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken
  ): void | Thenable<void> {
    if (!target) return;

    const transferItem = dataTransfer.get(
      'application/vnd.code.tree.codeExplorer'
    );
    if (!transferItem) {
      return;
    }
    const treeItems = transferItem.value as TreeElement[];
    const srcEl = treeItems[0];
    if (!srcEl) return;

    let targetId: string | null = null;
    let targetType: 'stack' | 'marker' = 'marker';
    const dstElType = target.type;
    if (dstElType === 'label') {
      return;
    } else if (dstElType === 'stack') {
      targetId = target.stack.id;
      targetType = 'stack';
    } else if (dstElType === 'marker') {
      targetId = target.marker.id;
      targetType = 'marker';
    } else {
      const exhaustedType: never = dstElType;
      throw new Error('Unknown element: ' + exhaustedType);
    }

    const srcElType = srcEl.type;
    if (srcElType === 'label') {
      return;
    } else if (srcElType === 'stack') {
      markerService.moveStack(srcEl.stack.id, targetId, targetType);
    } else if (srcElType === 'marker') {
      markerService.moveMarker(srcEl.marker.id, targetId, targetType);
    } else {
      const exhaustedType: never = srcElType;
      throw new Error('Unknown element: ' + exhaustedType);
    }
  }
}
