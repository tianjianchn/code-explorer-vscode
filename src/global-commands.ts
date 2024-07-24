import * as vscode from 'vscode';
import {
  Marker,
  getMarkerDesc,
  getMarkerTitle,
  markerService,
} from './markerService';
import { MarkerTreeViewProvider, untitledStack } from './stackView';
import { EditorLineNumberContextParams } from './editor-decoration';

export function registerGlobalCommands() {
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
    'codeExplorer.addMarker',
    async (p?: EditorLineNumberContextParams) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;

      let line: number;
      let column: number;
      let text: string;
      if (p && p.lineNumber >= 0) {
        // from gutter context menu
        line = p.lineNumber - 1;
        let range = editor.document.lineAt(line).range;
        column = range.start.character;
        text = editor.document.getText(range);
      } else {
        // from line in editor or command pallette
        if (editor.selection.isEmpty) {
          line = editor.selection.active.line;
          let range = editor.document.lineAt(line).range;
          column = editor.selection.start.character;
          text = editor.document.getText(range);
        } else {
          let range: vscode.Range = editor.selection;
          if (range.end.line === range.start.line) {
            line = range.start.line;
            column = range.start.character;
            text = editor.document.getText(range);
          } else {
            // Suppose the top line in multiple lines selection is function name
            line = range.end.line;
            column = range.end.character;
            range = editor.document.lineAt(range.start.line).range;
            text = editor.document.getText(range);
          }
        }
      }

      if (!text) return;
      text = text.trim();
      if (!text) return;

      const marker = await markerService.addMarker({
        line,
        column,
        code: text,
        file: editor.document.fileName,
      });
      setTimeout(() => {
        MarkerTreeViewProvider.revealMarker(marker);
      }, 300);
    }
  );

  vscode.commands.registerCommand('codeExplorer.selectMarker', async () => {
    const stack = await markerService.getActiveStack();
    if (!stack) return;

    await showMarkers(
      'Select a marker of current stack: ' + (stack.title ?? untitledStack),
      stack.markers
    );
  });

  vscode.commands.registerCommand('codeExplorer.createStack', async () => {
    await markerService.createStack();
  });

  vscode.commands.registerCommand('codeExplorer.pasteCallStack', async () => {
    const text = await vscode.env.clipboard.readText();
    if (!text) return;
    const lines = text.split('\n');
    const markers = lines
      .map((line) => {
        const matches = /^(.+?) \(((?:\/[^/]+)+):(\d+)\)$/.exec(line);
        if (!matches) return null;
        const code = matches[1];
        const file = matches[2];
        const lineNo = parseInt(matches[3], 10);
        return { code, file, line: lineNo, column: 0 };
      })
      .filter(Boolean) as Omit<Marker, 'createdAt' | 'id'>[];
    if (!markers.length) return;

    await markerService.createStack();
    await markerService.addMarkers(markers);
  });

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

  vscode.commands.registerCommand('codeExplorer.selectMarkerAll', async () => {
    const stacks = await markerService.getStacks();
    const markers = stacks.reduce(
      (m, s) => m.concat(s.markers),
      [] as Marker[]
    );
    await showMarkers('Select a marker of ALL stacks', markers);
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

  vscode.commands.registerCommand('codeExplorer.actions', async () => {
    const stack = await markerService.getActiveStack();

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
      placeHolder: 'Current stack: ' + (stack ? stack.title : untitledStack),
    });
    if (!selected) return;

    switch (selected.id) {
      case 'selectMarker':
        return vscode.commands.executeCommand('codeExplorer.selectMarker');
      case 'selectMarkerAll':
        return vscode.commands.executeCommand('codeExplorer.selectMarkerAll');
      case 'rename':
        return vscode.commands.executeCommand('codeExplorer.renameStack');
      case 'delete':
        return vscode.commands.executeCommand('codeExplorer.deleteStack');
      case 'refresh':
        return vscode.commands.executeCommand('codeExplorer.refresh');
      case 'switch':
        return vscode.commands.executeCommand('codeExplorer.activateStack');
      case 'copyMarkersIntoClipboard':
        return vscode.commands.executeCommand('codeExplorer.copyMarkers');
      case 'openDataFile':
        return vscode.commands.executeCommand('codeExplorer.openDataFile');
      default:
        const exhausted: never = selected.id;
        throw new Error('Unhandled action: ' + exhausted);
    }
  });
}
