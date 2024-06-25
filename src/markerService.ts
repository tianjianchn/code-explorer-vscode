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
  file: string;
  line: number;
  column: number;
  text: string;
  createdAt: string;
  stackId: string;
}

export interface Stack {
  id: string;
  title: string;
  createdAt: string;
}

export interface MarkerGroupWithChildren extends Stack {
  children: Marker[];
}

interface FileContent {
  '#': string;
  markers: Marker[];
  stacks: Stack[];
  currentStackId: string | null;
}

const WATCH_DEBOUNCE_TIME = 300; // ms

class MarkerService {
  private markers: Marker[] = [];
  private stacks: Stack[] = [];
  private currentStackId: string | null = null;
  private loading = new Future();

  private isSavingData = false;
  private watcher?: vscode.FileSystemWatcher;

  private _onDataUpdatedEmitter: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onDataUpdated: vscode.Event<void> = this._onDataUpdatedEmitter.event;

  constructor() {
    extensionEnv.onActivated(async () => {
      this.watcher = this.watchDataFile();
      await this.loadData();
    });
  }

  dispose() {
    this._onDataUpdatedEmitter.dispose();
    this.watcher?.dispose();
  }

  async getCurrentStack() {
    await this.loading.promise;

    const markers = this.markers.filter(
      (marker) => marker.stackId === this.currentStackId
    );
    const stack = this.stacks.find((s) => s.id === this.currentStackId);
    return { stack, markers };
  }

  async getStacks() {
    await this.loading.promise;
    return this.stacks;
  }

  async getAllMarkers() {
    await this.loading.promise;
    return this.markers;
  }

  async createStack() {
    const stackId = uuid();
    this.currentStackId = stackId;

    await this.saveData();
  }

  async renameStack(id: string, title: string) {
    const stack = this.stacks.find((s) => s.id === id);
    if (!stack) return;
    stack.title = title;
    await this.saveData();
  }

  async deleteStack(id: string) {
    this.markers = this.markers.filter((m) => m.stackId !== id);
    this.stacks = this.stacks.filter((s) => s.id !== id);
    this.currentStackId = this.stacks[0]?.id ?? -1;
    await this.saveData();
  }

  async switchStack(stackId: string) {
    this.currentStackId = stackId;
    await this.saveData();
  }

  async addMarker(
    marker: Omit<Marker, 'type' | 'createdAt' | 'id' | 'stackId'>
  ) {
    const now = new Date();
    const defaultStackTitle = marker.text.slice(0, 16) + ' ' + getDateStr(now);
    if (!this.currentStackId) {
      const stackId = uuid();
      this.stacks.unshift({
        id: stackId,
        title: defaultStackTitle,
        createdAt: now.toISOString(),
      });
      this.currentStackId = stackId;
    } else {
      const stack = this.stacks.find((s) => s.id === this.currentStackId);
      if (!stack) {
        this.stacks.unshift({
          id: this.currentStackId,
          title: defaultStackTitle,
          createdAt: now.toISOString(),
        });
      }
    }

    const markerId = uuid();

    this.markers.unshift({
      ...marker,
      id: markerId,
      stackId: this.currentStackId,
      createdAt: now.toISOString(),
    });

    await this.saveData();
  }

  async setTitle(markerId: string, title: string) {
    const marker = this.markers.find((m) => m.id === markerId);
    if (!marker) return;

    marker.title = title === '' ? undefined : title;

    await this.saveData();
  }

  async addTag(markerId: string, tag: string) {
    const marker = this.markers.find((m) => m.id === markerId);
    if (!marker) return;

    if (!marker.tags) marker.tags = [tag];
    else if (!marker.tags.includes(tag)) marker.tags.push(tag);
    else return;

    await this.saveData();
  }

  async deleteTag(markerId: string, tag: string) {
    const marker = this.markers.find((m) => m.id === markerId);
    if (!marker) return;

    if (!marker.tags) return;
    const index = marker.tags.indexOf(tag);
    if (index < 0) return;
    marker.tags.splice(index, 1);

    await this.saveData();
  }

  /**
   * Put src marker after target marker
   * @param srcId
   * @param targetId
   * @returns
   */
  async moveMarker(srcId: string, targetId: string) {
    if (srcId === targetId) return;

    const srcIndex = this.markers.findIndex((m) => m.id === srcId);
    if (srcIndex < 0) return;
    const src = this.markers[srcIndex];

    let tgtIndex = this.markers.findIndex((m) => m.id === targetId);
    if (tgtIndex < 0) return;
    this.markers.splice(srcIndex, 1);
    if (srcIndex < tgtIndex) {
      tgtIndex -= 1;
    }
    this.markers.splice(tgtIndex + 1, 0, src);
    await this.saveData();
  }

  async deleteMarker(markerId: string) {
    const index = this.markers.findIndex((m) => m.id === markerId);
    if (index < 0) return;
    const marker = this.markers[index];
    this.markers.splice(index, 1);

    // Clear empty stacks
    const usedStackIds: Record<string, true> = {};
    this.markers.forEach((m) => {
      usedStackIds[m.stackId] = true;
    });
    this.stacks = this.stacks.filter((s) => usedStackIds[s.id]);
    if (this.currentStackId && !usedStackIds[this.currentStackId])
      this.currentStackId = null;

    await this.saveData();
  }

  private _oldGetDataFilePath() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) {
      // No workspace opened
      return;
    }

    const file = vscode.Uri.joinPath(context.storageUri, 'code-explorer.json');
    return file;
  }

  getDataFilePath() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) {
      // No workspace opened
      return;
    }
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) return;

    const file = vscode.Uri.joinPath(
      folders[0].uri,
      '.vscode',
      '.code-explorer.json'
    );

    return file;
  }

  private async loadData(reload: boolean = false) {
    this.loading = new Future();

    const file = this.getDataFilePath();
    if (!file) return;

    if (!reload) output.log('Loading data from ' + file.toString());
    await this.doLoad(file);

    this.loading.resolve();
  }

  private async doLoad(file: vscode.Uri): Promise<void> {
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));

    try {
      const fileData = await vscode.workspace.fs.readFile(file);
      const dec = new TextDecoder('utf-8');
      const content = dec.decode(fileData);
      const data = JSON.parse(content) as FileContent;

      // Normalize data from old versions
      data.markers.forEach((m) => {
        m.id = m.id + '';
        m.stackId = m.stackId + '';
        m.createdAt = new Date(m.createdAt).toISOString();
      });
      data.stacks.forEach((s) => {
        s.id = s.id + '';
        s.createdAt = new Date(s.createdAt).toISOString();
      });
      data.currentStackId = data.currentStackId + '';

      this.markers = data.markers;
      this.stacks = data.stacks;
      this.currentStackId = data.currentStackId;
    } catch (e) {
      this.markers = [];
      this.stacks = [];
      this.currentStackId = null;
      if (e instanceof vscode.FileSystemError && e.code === 'FileNotFound') {
        // Copy from old version
        const oldFile = this._oldGetDataFilePath();
        if (oldFile) {
          output.log('Try to load from old data file: ' + oldFile.toString());
          await this.doLoad(oldFile);
          await this.saveData();
          if (this.markers.length) {
            try {
              await vscode.workspace.fs.delete(oldFile);
            } catch (e2) {}
          }
        }
      } else {
        output.log('Error to load data:' + String(e));
      }
    }
  }

  private async saveData() {
    try {
      const file = this.getDataFilePath();
      if (!file) return;

      this.isSavingData = true;

      const markers = this.markers.map((m) => {
        const r: Marker = {
          text: m.text,
          title: m.title,
          tags: m.tags,
          file: m.file,
          line: m.line,
          column: m.column,
          createdAt: m.createdAt,
          id: m.id,
          stackId: m.stackId,
        };
        return r;
      });

      // Group markers of same stack together
      const markerIndexMap: Record<string, number> = markers.reduce(
        (obj, it, ind) => Object.assign(obj, { [it.id]: ind }),
        {}
      );
      const sortedMarkers = markers.sort((a, b) => {
        if (a.stackId === b.stackId) {
          return markerIndexMap[a.id] - markerIndexMap[b.id];
        } else {
          return a.stackId < b.stackId ? -1 : 1;
        }
      });

      const stacks = this.stacks.map((s) => {
        const r: Stack = { title: s.title, createdAt: s.createdAt, id: s.id };
        return r;
      });

      const data: FileContent = {
        '#': 'NOT recommend to edit manually. Write carefully! Generated by tianjianchn.code-explorer vscode extension.',
        currentStackId: this.currentStackId,
        stacks: stacks,
        markers: sortedMarkers,
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
  const title = marker.title ?? marker.text;
  if (marker.tags?.length) {
    const tags = marker.tags.map((t) => '[' + t + ']').join('');
    return tags + ' ' + title;
  }
  return title;
}

export function getMarkerDesc(marker: Marker) {
  return `${getRelativeFilePath(marker.file)}:${marker.line + 1}:${
    marker.column + 1
  }`;
}

export function getMarkerClipboardText(marker: Marker) {
  const tags = marker.tags?.map((t) => '[' + t + ']').join('') ?? '';
  const loc = `${getRelativeFilePath(marker.file)}:${marker.line + 1}:${
    marker.column + 1
  }`;
  const title = marker.title ? ' # ' + marker.title : '';

  return `- ${tags}${loc} ${marker.text}${title}`;
}
