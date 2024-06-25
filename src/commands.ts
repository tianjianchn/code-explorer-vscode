import * as vscode from 'vscode';
import {
  Marker,
  getMarkerClipboardText,
  getMarkerDesc,
  getMarkerTitle,
  markerService,
} from './markerService';

export function registerCommands() {
  vscode.commands.registerCommand('codeExplorer.addMarker', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    let range: vscode.Range;
    let column = 0;
    if (!editor.selection.isEmpty) {
      range = editor.selection;
      column = range.start.character;
    } else {
      range = editor.document.lineAt(editor.selection.active.line).range;
      column = editor.selection.start.character;
    }

    let text = editor.document.getText(range);
    if (!text) return;
    text = text.trim();
    if (!text) return;

    markerService.addMarker({
      line: range.start.line,
      column,
      text,
      file: editor.document.fileName,
    });
  });

  vscode.commands.registerCommand('codeExplorer.actions', async () => {
    const { stack } = await markerService.getCurrentStack();

    const pickItems: (vscode.QuickPickItem & {
      id:
        | 'rename'
        | 'delete'
        | 'switch'
        | 'refresh'
        | 'selectMarker'
        | 'selectMarkerAll'
        | 'openDataFile'
        | 'copyMarkersIntoClipboard';
    })[] = [
      { label: 'Goto a marker of current stack', id: 'selectMarker' },
      { label: 'Goto a marker of ALL stacks', id: 'selectMarkerAll' },
      {
        label: 'Copy markers of current stack',
        id: 'copyMarkersIntoClipboard',
      },
      { label: 'Rename current stack', id: 'rename' },
      { label: 'Delete current stack', id: 'delete' },
      { label: 'Switch stack', id: 'switch' },
      { label: 'Refresh stacks', id: 'refresh' },
      { label: 'Open Data File (Edit carefully)', id: 'openDataFile' },
    ];

    const selected = await vscode.window.showQuickPick(pickItems, {
      title: 'Stack Actions of Code Explorer',
      placeHolder: 'Current stack: ' + (stack ? stack.title : '<none>'),
    });
    if (!selected) return;

    switch (selected.id) {
      case 'selectMarker':
        return vscode.commands.executeCommand('codeExplorer.selectMarker');
      case 'selectMarkerAll':
        return vscode.commands.executeCommand('codeExplorer.selectMarkerAll');
      case 'rename':
        return vscode.commands.executeCommand(
          'codeExplorer.stackView.renameStack'
        );
      case 'delete':
        return vscode.commands.executeCommand('codeExplorer.deleteStack');
      case 'refresh':
        return vscode.commands.executeCommand('codeExplorer.stackView.refresh');
      case 'switch':
        return vscode.commands.executeCommand('codeExplorer.loadStack');
      case 'copyMarkersIntoClipboard':
        return vscode.commands.executeCommand(
          'codeExplorer.copyMarkersIntoClipboard'
        );
      case 'openDataFile':
        return vscode.commands.executeCommand('codeExplorer.openDataFile');
      default:
        const exhausted: never = selected.id;
        throw new Error('Unhandled action: ' + exhausted);
    }
  });

  vscode.commands.registerCommand('codeExplorer.loadStack', async () => {
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
  });

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

  vscode.commands.registerCommand('codeExplorer.deleteStack', async () => {
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
      await markerService.deleteStack(stack.id);
    }
  });

  vscode.commands.registerCommand('codeExplorer.selectMarker', async () => {
    const { stack, markers } = await markerService.getCurrentStack();

    await showMarkers(
      'Select a marker of current stack: ' + stack?.title,
      markers
    );
  });

  vscode.commands.registerCommand('codeExplorer.selectMarkerAll', async () => {
    const markers = await markerService.getAllMarkers();
    await showMarkers('Select a marker in ALL stacks', markers);
  });

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
    'codeExplorer.copyMarkersIntoClipboard',
    async () => {
      const { stack, markers } = await markerService.getCurrentStack();
      if (!stack) return;

      const text = markers.map((m) => getMarkerClipboardText(m)).join('\n');

      await vscode.env.clipboard.writeText(text);
    }
  );

  vscode.commands.registerCommand('codeExplorer.openDataFile', async () => {
    const file = markerService.getDataFilePath();
    if (!file) {
      vscode.window.showWarningMessage(
        'No folder is opened in this VSCode window'
      );
      return;
    }
    await vscode.commands.executeCommand('vscode.open', file);
  });
}
