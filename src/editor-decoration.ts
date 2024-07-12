import * as vscode from 'vscode';
import { extensionEnv } from './extensionEnv';
import { markerService } from './markerService';

export function activateDecoration() {
  const context = extensionEnv.getExtensionContext();

  const gutterDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: context.asAbsolutePath('media/logo.svg'),
    gutterIconSize: '90%',
  });

  // create a decorator type that we use to decorate small numbers
  // const smallNumberDecorationType =
  //   vscode.window.createTextEditorDecorationType({
  //     borderWidth: '1px',
  //     borderStyle: 'solid',
  //     overviewRulerColor: 'blue',
  //     overviewRulerLane: vscode.OverviewRulerLane.Right,
  //     light: {
  //       // this color will be used in light color themes
  //       borderColor: 'darkblue',
  //     },
  //     dark: {
  //       // this color will be used in dark color themes
  //       borderColor: 'lightblue',
  //     },
  //   });

  // create a decorator type that we use to decorate large numbers
  // const largeNumberDecorationType =
  //   vscode.window.createTextEditorDecorationType({
  //     cursor: 'crosshair',
  //     // use a themable color. See package.json for the declaration and default values.
  //     backgroundColor: { id: 'myextension.largeNumberBackground' },
  //   });

  let timeout: NodeJS.Timeout | undefined = undefined;
  function triggerUpdateDecorations(throttle = false) {
    if (timeout) {
      clearTimeout(timeout);
      timeout = undefined;
    }
    if (throttle) {
      timeout = setTimeout(updateDecorations, 500);
    } else {
      updateDecorations();
    }
  }
  triggerUpdateDecorations();

  markerService.onDataUpdated(() => triggerUpdateDecorations(true));

  async function updateDecorations() {
    let activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return;
    }
    const fileName = activeEditor.document.fileName;

    const decList: vscode.DecorationOptions[] = [];
    const stack = await markerService.getActiveStack();
    if (!stack || !stack.markers.length) return;

    stack.markers.forEach((m) => {
      if (m.file !== fileName) return;

      const range = new vscode.Range(
        new vscode.Position(m.line, 0),
        new vscode.Position(m.line, 0)
      );
      const decoration: vscode.DecorationOptions = {
        range: range,
        hoverMessage: new vscode.MarkdownString(
          '(Code Explorer) ' + (m.title ?? '')
        ),
      };
      decList.push(decoration);
    });
    activeEditor.setDecorations(gutterDecorationType, decList);
  }

  vscode.window.onDidChangeActiveTextEditor(
    (editor) => {
      triggerUpdateDecorations();
    },
    null,
    context.subscriptions
  );

  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      let activeEditor = vscode.window.activeTextEditor;

      if (activeEditor && event.document === activeEditor.document) {
        triggerUpdateDecorations(true);
      }
    },
    null,
    context.subscriptions
  );
}
