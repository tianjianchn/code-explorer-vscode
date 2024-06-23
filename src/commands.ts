import * as vscode from 'vscode';
import { markerService } from './markerService';
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
}
