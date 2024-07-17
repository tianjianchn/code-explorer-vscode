import * as vscode from 'vscode';
import { extensionEnv } from './extensionEnv';
import { markerService } from './markerService';
import { MarkerTreeViewProvider } from './stackView';

export interface EditorLineNumberContextParams {
  uri: vscode.Uri;
  lineNumber: number;
}

export function activateDecoration() {
  const context = extensionEnv.getExtensionContext();

  vscode.commands.registerCommand(
    'codeExplorer.gutter.deleteMarker',
    async (p: EditorLineNumberContextParams) => {
      const stacks = await markerService.getStacks();
      for (let stack of stacks) {
        if (!stack?.markers.length) continue;

        const marker = stack.markers.find(
          (m) => m.file === p.uri.fsPath && m.line === p.lineNumber - 1
        );

        if (marker) {
          markerService.deleteMarker(marker.id);
        }
      }
    }
  );
  vscode.commands.registerCommand(
    'codeExplorer.gutter.revealMarker',
    async (p: EditorLineNumberContextParams) => {
      let [stacks, activeStack] = await Promise.all([
        markerService.getStacks(),
        markerService.getActiveStack(),
      ]);

      // Ensure active stack is the first stack to check
      let index = activeStack ? stacks.indexOf(activeStack) : -1;
      if (index > 0 && activeStack) {
        stacks = [...stacks];
        stacks.splice(index, 1);
        stacks.unshift(activeStack);
      }

      for (let stack of stacks) {
        if (!stack?.markers.length) continue;

        const marker = stack.markers.find(
          (m) => m.file === p.uri.fsPath && m.line === p.lineNumber - 1
        );

        if (marker) {
          MarkerTreeViewProvider.revealMarker(marker);
          return;
        }
      }
    }
  );

  const gutterDecorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: context.asAbsolutePath('media/logo.png'),
    gutterIconSize: '90%',
  });
  const gutterNotActiveDecorationType =
    vscode.window.createTextEditorDecorationType({
      gutterIconPath: context.asAbsolutePath('media/logo_gray.png'),
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
    const decNotActiveList: vscode.DecorationOptions[] = [];
    const markerLines = new Set<number>();

    const [stacks, activeStack] = await Promise.all([
      markerService.getStacks(),
      markerService.getActiveStack(),
    ]);
    stacks.forEach((stack) => {
      if (!stack?.markers.length) return;

      stack.markers.forEach((m) => {
        if (m.file !== fileName) return;

        const range = activeEditor.document.lineAt(m.line).range;
        const decoration: vscode.DecorationOptions = {
          range: range,
          hoverMessage: new vscode.MarkdownString(
            '(Code Explorer Marker) ' + (m.title ?? '')
          ),
        };
        if (stack === activeStack) {
          decList.push(decoration);
        } else {
          decNotActiveList.push(decoration);
        }

        markerLines.add(m.line + 1);
      });
    });

    activeEditor.setDecorations(gutterDecorationType, decList);
    activeEditor.setDecorations(
      gutterNotActiveDecorationType,
      decNotActiveList
    );

    vscode.commands.executeCommand(
      'setContext',
      'codeExplorer.markerLines',
      Array.from(markerLines)
    );
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
