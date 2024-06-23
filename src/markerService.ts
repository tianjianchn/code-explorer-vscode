import * as vscode from 'vscode';
import { extensionEnv } from './extensionEnv';
import { Future, getDateStr, padStart } from './util';
import { output } from './output';

export interface Marker {
  type: 'marker';
  id: number;
  title?: string;
  file: string;
  line: number;
  column: number;
  text: string;
  createdAt: number;
  stackId: number;
}

export interface Stack {
  type: 'stack';
  id: number;
  title: string;
  firstMarkerId?: number;
  createdAt: number;
}

export interface MarkerGroupWithChildren extends Stack {
  children: Marker[];
}

interface FileContent {
  markers: Marker[];
  stacks: Stack[];
  currentStackId: number;
}

class MarkerService {
  private markers: Marker[] = [];
  private stacks: Stack[] = [];
  private currentStackId = -1;
  private loaded = new Future();

  private nextId = 1;

  private _onDataUpdatedEmitter: vscode.EventEmitter<void> =
    new vscode.EventEmitter<void>();
  readonly onDataUpdated: vscode.Event<void> = this._onDataUpdatedEmitter.event;

  constructor() {
    extensionEnv.onActivated(() => {
      this.loadData();
    });
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

  async addMarker(
    marker: Omit<Marker, 'type' | 'createdAt' | 'id' | 'stackId'>
  ) {
    const now = new Date();
    const defaultStackTitle = marker.text.slice(0, 16) + ' ' + getDateStr(now);
    if (this.currentStackId <= 0) {
      const stackId = this.nextId++;
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

    const markerId = this.nextId++;

    this.markers.unshift({
      ...marker,
      id: markerId,
      stackId: this.currentStackId,
      type: 'marker',
      createdAt: now.getTime(),
    });

    await this.saveData();
  }

  async removeMarker(markerId: number) {
    const index = this.markers.findIndex((m) => m.id === markerId);
    if (index < 0) return;
    const marker = this.markers[index];
    this.markers.splice(index, 1);

    // Clear empty stacks
    const usedStackIds: Record<string, true> = {};
    this.markers.forEach((m) => {
      usedStackIds[m.stackId + ''] = true;
    });
    this.stacks = this.stacks.filter((s) => usedStackIds[s.id]);
    if (!usedStackIds[this.currentStackId]) this.currentStackId = -1;

    await this.saveData();
  }

  async createStack() {
    const stackId = this.nextId++;
    this.currentStackId = stackId;

    await this.saveData();
  }

  async renameStack(id: number, title: string) {
    const stack = this.stacks.find((s) => s.id === id);
    if (!stack) return;
    stack.title = title;
    await this.saveData();
  }

  async removeStack(id: number) {
    this.markers = this.markers.filter((m) => m.stackId !== id);
    this.stacks = this.stacks.filter((s) => s.id !== id);
    this.currentStackId = this.stacks[0]?.id ?? -1;
    await this.saveData();
  }

  async switchStack(stackId: number) {
    this.currentStackId = stackId;
    await this.saveData();
  }

  private async loadData() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) {
      // No workspace opened
      return;
    }

    const dir = context.storageUri;
    await vscode.workspace.fs.createDirectory(dir);
    const file = vscode.Uri.joinPath(context.storageUri, 'code-explorer.json');

    try {
      output.log('Loading data from ' + file.toString());
      const fileData = await vscode.workspace.fs.readFile(file);
      const dec = new TextDecoder('utf-8');
      const strData = dec.decode(fileData);
      const data = JSON.parse(strData) as FileContent;
      this.markers = data.markers;
      this.stacks = data.stacks;
      this.currentStackId = data.currentStackId;

      // Adjust next id
      this.stacks.forEach((s) => {
        if (s.id >= this.nextId) this.nextId = s.id + 1;
      });
      this.markers.forEach((m) => {
        if (m.id >= this.nextId) this.nextId = m.id + 1;
      });
    } catch (e) {
      output.log('Error to read code explorer data:' + String(e));
    }

    this.loaded.resolve();
  }

  private async saveData() {
    const context = extensionEnv.getExtensionContext();
    if (!context.storageUri) return;

    const file = vscode.Uri.joinPath(context.storageUri, 'code-explorer.json');
    const data: FileContent = {
      markers: this.markers,
      stacks: this.stacks,
      currentStackId: this.currentStackId,
    };
    const enc = new TextEncoder();
    // output.log('Saving data to ' + file.toString());
    await vscode.workspace.fs.writeFile(
      file,
      enc.encode(JSON.stringify(data, null, 2))
    );

    this._onDataUpdatedEmitter.fire();
  }
}

export const markerService = new MarkerService();
