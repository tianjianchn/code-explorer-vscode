import * as vscode from 'vscode';
import { extensionEnv } from './extensionEnv';
import { Future, debounce, getDateStr, padStart, uuid } from './util';
import { output } from './output';

export interface Marker {
  type: 'marker';
  id: string;
  title?: string;
  file: string;
  line: number;
  column: number;
  text: string;
  createdAt: number;
  stackId: string;
}

export interface Stack {
  type: 'stack';
  id: string;
  title: string;
  createdAt: number;
}

export interface MarkerGroupWithChildren extends Stack {
  children: Marker[];
}

interface FileContent {
  markers: Marker[];
  stacks: Stack[];
  currentStackId: string | null;
}

class MarkerService {
  private markers: Marker[] = [];
  private stacks: Stack[] = [];
  private currentStackId: string | null = null;
  private loaded = new Future();

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
    await this.loaded.promise;

    const markers = this.markers.filter(
      (marker) => marker.stackId === this.currentStackId
    );
    const stack = this.stacks.find((s) => s.id === this.currentStackId);
    return { stack, markers };
  }

  async getStacks() {
    await this.loaded.promise;
    return this.stacks;
  }

  async getAllMarkers() {
    await this.loaded.promise;
    return this.markers;
  }

  async addMarker(
    marker: Omit<Marker, 'type' | 'createdAt' | 'id' | 'stackId'>
  ) {
    const now = new Date();
    const defaultStackTitle = marker.text.slice(0, 16) + ' ' + getDateStr(now);
    if (!this.currentStackId) {
      const stackId = uuid();
      this.stacks.unshift({
        type: 'stack',
        id: stackId,
        title: defaultStackTitle,
        createdAt: now.getTime(),
      });
      this.currentStackId = stackId;
    } else {
      const stack = this.stacks.find((s) => s.id === this.currentStackId);
      if (!stack) {
        this.stacks.unshift({
          type: 'stack',
          id: this.currentStackId,
          title: defaultStackTitle,
          createdAt: now.getTime(),
        });
      }
    }

    const markerId = uuid();

    this.markers.unshift({
      ...marker,
      id: markerId,
      stackId: this.currentStackId,
      type: 'marker',
      createdAt: now.getTime(),
    });

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

  async removeMarker(markerId: string) {
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

  async removeStack(id: string) {
    this.markers = this.markers.filter((m) => m.stackId !== id);
    this.stacks = this.stacks.filter((s) => s.id !== id);
    this.currentStackId = this.stacks[0]?.id ?? -1;
    await this.saveData();
  }

  async switchStack(stackId: string) {
    this.currentStackId = stackId;
    await this.saveData();
  }

  private async loadData(reload: boolean = false) {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) {
      // No workspace opened
      return;
    }

    this.loaded = new Future();

    const dir = context.storageUri;
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(context.storageUri, 'code-explorer.json');

    try {
      if (!reload) output.log('Loading data from ' + file.toString());
      const fileData = await vscode.workspace.fs.readFile(file);
      const dec = new TextDecoder('utf-8');
      const content = dec.decode(fileData);
      const data = JSON.parse(content) as FileContent;

      // Normalize data from old versions
      data.markers.forEach((m) => {
        m.id = m.id + '';
        m.stackId = m.stackId + '';
      });
      data.stacks.forEach((s) => {
        s.id = s.id + '';
      });
      data.currentStackId = data.currentStackId + '';

      this.markers = data.markers;
      this.stacks = data.stacks;
      this.currentStackId = data.currentStackId;
    } catch (e) {
      output.log('Error to load data:' + String(e));
      this.markers = [];
      this.stacks = [];
      this.currentStackId = null;
    }

    this.loaded.resolve();
  }

  private async saveData() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) return;

    try {
      this.isSavingData = true;

      const file = vscode.Uri.joinPath(
        context.storageUri,
        'code-explorer.json'
      );
      const data: FileContent = {
        currentStackId: this.currentStackId,
        stacks: this.stacks,
        markers: this.markers,
      };
      const enc = new TextEncoder();
      const content = enc.encode(JSON.stringify(data, null, 2));

      // output.log('Saving data to ' + file.toString());
      await vscode.workspace.fs.writeFile(file, content);
    } finally {
      this.isSavingData = false;
    }

    this._onDataUpdatedEmitter.fire();
  }

  private watchDataFile() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) return;

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(context.storageUri, 'code-explorer.json')
    );
    const onChange = debounce(async (file) => {
      if (this.isSavingData) return;

      output.log(
        'Detected data file change by external write, try to reload data'
      );
      await this.loadData(true);
      this._onDataUpdatedEmitter.fire();
    }, 16);
    watcher.onDidCreate(onChange);
    watcher.onDidChange(onChange);
    watcher.onDidDelete(onChange);

    return watcher;
  }
}

export const markerService = new MarkerService();
