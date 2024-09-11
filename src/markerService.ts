import * as vscode from 'vscode';
import nodePath from 'path';
import { extensionEnv } from './extensionEnv';
import {
  Future,
  debounce,
  getDateStr,
  getRelativeFilePath,
  padStart,
  uuid,
} from './util';
import { output } from './output';

export interface Marker {
  id: string;
  title?: string;
  tags?: string[];
  icon?: string;
  iconColor?: string;
  file: string;
  line: number;
  column: number;
  code: string;
  indent?: number;
  createdAt: string;
}

export interface Stack {
  id: string;
  title?: string;
  createdAt: string;
  isActive: boolean;
  markers: Marker[];
}

export interface MarkerGroupWithChildren extends Stack {
  children: Marker[];
}

interface FileData {
  '#': string;
  '#markerCount': number;
  stacks: Stack[];
}

const WATCH_DEBOUNCE_TIME = 300; // ms

class MarkerService {
  private folder: vscode.Uri | null = null;
  private stacks: Stack[] = [];
  private loading = new Future();

  private isSavingData = false;
  private watcher?: vscode.FileSystemWatcher;

  private _onDataUpdatedEmitter: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onDataUpdated: vscode.Event<void> = this._onDataUpdatedEmitter.event;

  dispose() {
    this._onDataUpdatedEmitter.dispose();
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  async setWorkspaceFolder(uri: vscode.Uri) {
    if (this.folder?.toString() === uri.toString()) return;
    this.folder = uri;

    if (this.watcher) this.watcher.dispose();
    this.watcher = this.watchDataFile();
    await this.loadData();
    this._onDataUpdatedEmitter.fire();
  }

  getWorkspaceFolder() {
    return this.folder;
  }

  async getActiveStack() {
    await this.loading.promise;

    const stack = this.stacks.find((s) => s.isActive);
    return stack;
  }

  async getStacks() {
    await this.loading.promise;
    return this.stacks;
  }

  async createStack() {
    const stack = this.doCreateStack();
    await this.saveData();
    return stack;
  }

  private doCreateStack() {
    const stackId = uuid();

    // Remove newly created one
    const firstStack = this.stacks[0];
    if (firstStack && !firstStack.title && !firstStack.markers.length) {
      this.stacks.splice(0, 1);
    }

    let stack = this.stacks.find((s) => s.isActive);
    if (stack) {
      stack.isActive = false;
    }

    stack = {
      id: stackId,
      isActive: true,
      createdAt: new Date().toISOString(),
      markers: [],
    };
    this.stacks.unshift(stack);
    return stack;
  }

  async renameStack(id: string, title: string) {
    const stack = this.stacks.find((s) => s.id === id);
    if (!stack) return;
    stack.title = title;

    await this.saveData();
  }

  /**
   * Put src after target
   * @param srcId
   * @param targetId
   * @returns
   */
  async moveStack(
    srcId: string,
    targetId: string,
    targetType: 'stack' | 'marker'
  ) {
    let src = -1;
    let dst = -1;

    src = this.stacks.findIndex((s) => s.id === srcId);
    if (src < 0) return;

    if (targetType === 'stack') {
      const index = this.stacks.findIndex((s) => s.id === targetId);
      if (index < 0) return;
      dst = index;
    } else {
      for (let ii = 0; ii < this.stacks.length; ++ii) {
        const stack = this.stacks[ii];
        const index = stack.markers.findIndex((m) => m.id === targetId);
        if (index >= 0) {
          dst = ii;
          break;
        }
      }
    }
    if (dst < 0) return;

    if (src === dst) {
      return;
    } else {
      const srcStack = this.stacks[src];
      this.stacks.splice(src, 1);
      if (dst > src) {
        this.stacks.splice(dst, 0, srcStack);
      } else {
        this.stacks.splice(dst + 1, 0, srcStack);
      }
    }

    await this.saveData();
  }

  /**
   * Delete active stack may cause there is not active stack.
   * @param id
   */
  async deleteStack(id: string) {
    this.stacks = this.stacks.filter((s) => s.id !== id);

    await this.saveData();
  }

  async activateStack(stackId: string) {
    this.stacks.forEach((s) => {
      s.isActive = s.id === stackId;
    });
    await this.saveData();
  }

  async reverseMarkers(stackId: string) {
    const stack = this.stacks.find((s) => s.id === stackId);
    if (!stack) return;

    stack.markers = reverseMarkers(stack.markers);

    await this.saveData();
  }

  async addMarker(marker: Omit<Marker, 'createdAt' | 'id'>) {
    const now = new Date();
    let stack = this.stacks.find((s) => s.isActive);
    if (!stack) {
      stack = this.doCreateStack();
    }
    if (!stack.title)
      stack.title = marker.code.slice(0, 16) + ' ' + getDateStr(now);

    const record = {
      ...marker,
      id: uuid(),
      createdAt: now.toISOString(),
    };
    stack.markers.push(record);

    await this.saveData();
    return record;
  }

  async addMarkers(markers: Omit<Marker, 'createdAt' | 'id'>[]) {
    const now = new Date();
    let stack = this.stacks.find((s) => s.isActive);
    if (!stack) {
      stack = this.doCreateStack();
    }

    if (!stack.title)
      stack.title = markers[0].code.slice(0, 16) + ' ' + getDateStr(now);

    const records = markers.map((marker) => ({
      ...marker,
      id: uuid(),
      createdAt: now.toISOString(),
    }));
    stack.markers.push(...records);

    await this.saveData();
    return records;
  }

  async openMarker(marker: Marker) {
    if (!this.folder) throw new Error('No selected workspace folder');

    const selection = new vscode.Selection(
      new vscode.Position(marker.line, marker.column),
      new vscode.Position(marker.line, marker.column)
    );

    // const doc = await vscode.workspace.openTextDocument(el.file);
    // vscode.window.showTextDocument(doc, {
    //   selection,
    // });

    let file = marker.file;
    if (!nodePath.isAbsolute(file))
      file = nodePath.join(this.folder.fsPath, marker.file);

    await vscode.commands.executeCommand(
      // see https://code.visualstudio.com/api/references/commands
      'vscode.openWith',
      vscode.Uri.file(file),
      'default',
      {
        selection,
      } as vscode.TextDocumentShowOptions
    );
  }

  private getMarker(markerId: string) {
    for (let ii = 0; ii < this.stacks.length; ++ii) {
      const stack = this.stacks[ii];
      const marker = stack.markers.find((m) => m.id === markerId);
      if (marker) return marker;
    }
    return null;
  }

  async reposition(markerId: string, line: number, column?: number) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    marker.line = line;
    if (column) marker.column = column;

    await this.saveData();
  }
  async setTitle(markerId: string, title: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    marker.title = title === '' ? undefined : title;

    await this.saveData();
  }

  async setIcon(markerId: string, icon: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    marker.icon = icon === '' ? undefined : icon;

    await this.saveData();
  }
  async setIconColor(markerId: string, color: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    marker.iconColor = color === '' ? undefined : color;

    await this.saveData();
  }

  async addTag(markerId: string, tag: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    if (!marker.tags) marker.tags = [tag];
    else if (!marker.tags.includes(tag)) marker.tags.push(tag);
    else return;

    await this.saveData();
  }

  async deleteTag(markerId: string, tag: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    if (!marker.tags) return;
    const index = marker.tags.indexOf(tag);
    if (index < 0) return;
    marker.tags.splice(index, 1);

    await this.saveData();
  }

  async indentMarker(markerId: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    marker.indent = (marker.indent ?? 0) + 1;

    await this.saveData();
  }

  async unindentMarker(markerId: string) {
    const marker = this.getMarker(markerId);
    if (!marker) return;

    marker.indent = (marker.indent ?? 0) - 1;
    if (marker.indent <= 0) delete marker.indent;

    await this.saveData();
  }

  /**
   * Put src marker after target marker
   * @param srcId
   * @param targetId
   * @returns
   */
  async moveMarker(
    srcId: string,
    targetId: string,
    targetType: 'stack' | 'marker'
  ) {
    let src = { stackIndex: -1, markerIndex: -1 };
    let dst = { stackIndex: -1, markerIndex: -1 };

    for (let ii = 0; ii < this.stacks.length; ++ii) {
      const stack = this.stacks[ii];
      const index = stack.markers.findIndex((m) => m.id === srcId);
      if (index >= 0) {
        src.stackIndex = ii;
        src.markerIndex = index;
        break;
      }
    }
    if (src.stackIndex < 0 || src.markerIndex < 0) return;

    if (targetType === 'stack') {
      const stackIndex = this.stacks.findIndex((s) => s.id === targetId);
      if (stackIndex < 0) return;
      dst.stackIndex = stackIndex;
    } else {
      for (let ii = 0; ii < this.stacks.length; ++ii) {
        const stack = this.stacks[ii];
        const index = stack.markers.findIndex((m) => m.id === targetId);
        if (index >= 0) {
          dst.stackIndex = ii;
          dst.markerIndex = index;
          break;
        }
      }
    }
    if (dst.stackIndex < 0) return;

    const stack = this.stacks[src.stackIndex];
    const srcMarker = stack.markers[src.markerIndex];
    stack.markers.splice(src.markerIndex, 1);

    if (src.stackIndex == dst.stackIndex) {
      if (dst.markerIndex > src.markerIndex) {
        stack.markers.splice(dst.markerIndex, 0, srcMarker);
      } else {
        stack.markers.splice(dst.markerIndex + 1, 0, srcMarker);
      }
    } else {
      const dstStack = this.stacks[dst.stackIndex];
      dstStack.markers.splice(dst.markerIndex + 1, 0, srcMarker);
    }

    await this.saveData();
  }

  async deleteMarker(markerId: string) {
    for (let ii = 0; ii < this.stacks.length; ++ii) {
      const stack = this.stacks[ii];
      const index = stack.markers.findIndex((m) => m.id === markerId);
      if (index >= 0) {
        stack.markers.splice(index, 1);

        await this.saveData();
        return;
      }
    }
  }

  private _getDataFilePathFromStorage() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) {
      // No workspace opened
      return;
    }

    const file = vscode.Uri.joinPath(context.storageUri, 'code-explorer.json');
    return file;
  }

  private _getDataFilePathFromHidden() {
    if (!this.folder) return;

    const file = vscode.Uri.joinPath(
      this.folder,
      '.vscode',
      '.code-explorer.json'
    );
    return file;
  }

  getDataFilePath() {
    if (!this.folder) return;

    const file = vscode.Uri.joinPath(
      this.folder,
      '.vscode',
      'code-explorer.json'
    );

    return file;
  }

  private async loadData(reload: boolean = false) {
    this.loading = new Future();

    const file = this.getDataFilePath();
    if (!file) return;

    if (!reload) output.log('Start to load data');
    await this.doLoad(file);
    if (!reload) output.log('End to load data');

    this.loading.resolve();
  }

  private async doLoad(file: vscode.Uri): Promise<void> {
    if (!this.folder) return;
    const folderPath = this.folder.fsPath;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));

    try {
      const fileData = await vscode.workspace.fs.readFile(file);
      const dec = new TextDecoder('utf-8');
      const content = dec.decode(fileData);
      const data = JSON.parse(content);

      // Normalize data from old versions. Should remove after 20250101
      if (data.markers) {
        const oldData = data as {
          currentStackId: string;
          stacks: Stack[];
          markers: (Marker & { stackId: string })[];
        };
        oldData.markers.forEach((m) => {
          m.id = m.id + '';
          m.stackId = m.stackId + '';
          m.code = (m as any).text;
          m.createdAt = new Date(m.createdAt).toISOString();
        });
        oldData.stacks.forEach((s) => {
          s.id = s.id + '';
          s.createdAt = new Date(s.createdAt).toISOString();
        });
        oldData.currentStackId = oldData.currentStackId + '';

        oldData.stacks.forEach((s) => {
          s.isActive = s.id === oldData.currentStackId;
          s.markers = oldData.markers.filter((m) => m.stackId === s.id);
        });
      }

      const stacks = (data.stacks ?? []) as Stack[];
      stacks.forEach((s) => {
        s.markers.forEach((m) => {
          if (!nodePath.isAbsolute(m.file)) {
            m.file = nodePath.join(folderPath, m.file);
          }
        });
      });
      this.stacks = stacks;
    } catch (e) {
      this.stacks = [];
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
        if (file.fsPath === this.getDataFilePath()?.fsPath) {
          // Copy from hidden version. Should remove after 20250101
          const oldFile = this._getDataFilePathFromHidden();
          if (oldFile) {
            output.log('Try to load from old data file: ' + oldFile.toString());
            await this.doLoad(oldFile);
            await this.saveData();
            if (this.stacks.length) {
              try {
                await vscode.workspace.fs.delete(oldFile);
              } catch (e2) {}
            }
            return;
          }
        } else if (file.fsPath === this._getDataFilePathFromHidden()?.fsPath) {
          // Copy from storage version. Should remove after 20250101
          const oldFile = this._getDataFilePathFromStorage();
          if (oldFile) {
            output.log('Try to load from old data file: ' + oldFile.toString());
            await this.doLoad(oldFile);
            await this.saveData();
            if (this.stacks.length) {
              try {
                await vscode.workspace.fs.delete(oldFile);
              } catch (e2) {}
            }
            return;
          }
        }
      }

      output.log('Error to load data: ' + String(e));
    }
  }

  private async saveData() {
    try {
      if (!this.folder) return;
      const file = this.getDataFilePath();
      if (!file) return;

      const folderPath = this.folder?.fsPath;

      this.isSavingData = true;

      let markerCount = 0;
      const stacks = this.stacks.map((s) => {
        const markers = s.markers.map((m) => {
          markerCount += 1;

          let file = m.file;

          if (nodePath.isAbsolute(file)) {
            file = nodePath.relative(folderPath, file);
            if (file.startsWith('..')) {
              file = m.file;
            }
          }

          const r: Marker = {
            title: m.title,
            code: m.code,
            tags: m.tags,
            file: file,
            line: m.line,
            column: m.column,
            icon: m.icon,
            iconColor: m.iconColor,
            indent: m.indent,
            createdAt: m.createdAt,
            id: m.id,
          };
          return r;
        });
        const r: Stack = {
          title: s.title,
          isActive: s.isActive,
          createdAt: s.createdAt,
          id: s.id,
          markers,
        };
        return r;
      });

      const data: FileData = {
        '#': 'NOT recommend to edit manually. Write carefully! Generated by tianjianchn.code-explorer vscode extension.',
        '#markerCount': markerCount,
        stacks: stacks,
      };
      const enc = new TextEncoder();
      const content = enc.encode(JSON.stringify(data, null, 2));

      // output.log('Saving data to ' + file.toString());
      await vscode.workspace.fs.writeFile(file, content);
    } finally {
      setTimeout(() => {
        this.isSavingData = false;
      }, /* Mute watching */ WATCH_DEBOUNCE_TIME + 500);
    }

    this._onDataUpdatedEmitter.fire();
  }

  private watchDataFile() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) return;

    const file = this.getDataFilePath();
    if (!file) return;

    output.log('Watching data file ' + file.toString());

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(file, '..'),
        nodePath.basename(file.path)
      )
    );

    let action: 'create' | 'change' | 'delete' = 'change';
    const onChange = debounce(async (f) => {
      if (this.isSavingData) return;

      output.log(
        'Detected data file ' + action + ' by external, try to reload data'
      );
      await this.loadData(true);
      this._onDataUpdatedEmitter.fire();
    }, WATCH_DEBOUNCE_TIME);

    watcher.onDidCreate((f) => {
      action = 'create';
      onChange(f);
    });
    watcher.onDidChange((f) => {
      action = 'change';
      onChange(f);
    });
    watcher.onDidDelete((f) => {
      action = 'delete';
      onChange(f);
    });

    return watcher;
  }
}

export const markerService = new MarkerService();

export function getMarkerTitle(marker: Marker) {
  let title = marker.title ?? marker.code;
  if (marker.tags?.length) {
    const tags = marker.tags.map((t) => '[' + t + ']').join('');
    title = tags + ' ' + title;
  }

  return title;
}

export function getMarkerDesc(marker: Marker) {
  return `${getRelativeFilePath(marker.file)}:${marker.line + 1}:${
    marker.column + 1
  }`;
}

export function reverseMarkers(markers: Marker[]) {
  const result: Marker[] = [];
  const len = markers.length;
  for (let ii = len - 1; ii >= 0; --ii) {
    const m = markers[ii];
    if (!m.indent) {
      result.push(m);
    } else {
      // not reverse indent markers
      let parent = ii - 1;
      while (parent >= 0 && markers[parent].indent) {
        parent--;
      }
      for (let jj = parent >= 0 ? parent : 0; jj <= ii; ++jj) {
        result.push(markers[jj]);
      }
      ii = parent;
    }
  }

  return result;
}
