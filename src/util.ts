import * as vscode from 'vscode';
import nodePath from 'path';
import crypto from 'crypto';

export function uuid() {
  return crypto.randomBytes(16).toString('hex');
}

export function padStart(v: number | string, len: number, filler?: string) {
  return (v + '').padStart(len, filler);
}

export function getDateStr(d: Date | number) {
  if (typeof d === 'number') d = new Date(d);
  return (
    d.getFullYear() +
    '-' +
    padStart(d.getMonth() + 1, 2, '0') +
    '-' +
    padStart(d.getDate(), 2, '0')
  );
}

export function getDateTimeStr(d: Date | number | string) {
  if (typeof d === 'number' || typeof d === 'string') d = new Date(d);
  return (
    d.getFullYear() +
    '-' +
    padStart(d.getMonth() + 1, 2, '0') +
    '-' +
    padStart(d.getDate(), 2, '0') +
    ' ' +
    padStart(d.getHours(), 2, '0') +
    ':' +
    padStart(d.getMinutes(), 2, '0') +
    ':' +
    padStart(d.getSeconds(), 2, '0') +
    '.' +
    padStart(d.getMilliseconds(), 3, '0')
  );
}

export function getRelativeFilePath(fullPath: string) {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return fullPath;

  for (let ii = 0; ii < folders.length; ii++) {
    const folder = folders[ii];
    const rel = nodePath.relative(folder.uri.fsPath, fullPath);
    if (rel === fullPath || rel.startsWith('..')) continue;
    return rel;
  }

  return fullPath;
}

export class Future<T = void> {
  readonly promise: Promise<T>;

  private _resolve!: (value: T | PromiseLike<T>) => void;
  private _reject!: (reason: unknown) => void;

  private _rejected = false;
  private _resolved = false;

  constructor() {
    this.promise = new Promise<T>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  resolve(value: T | PromiseLike<T>): void {
    const resolve = this._resolve;
    resolve(value);
    this._resolved = true;
  }

  reject(reason: unknown): void {
    const reject = this._reject;
    reject(reason);
    this._rejected = true;
  }

  isFulfilled() {
    return this._rejected || this._resolved;
  }
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number = 0
): T {
  let timer: NodeJS.Timeout | null = null;

  return function debounced(this: unknown, ...args: unknown[]) {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    timer = setTimeout(() => {
      timer = null;
      fn.apply(this, args);
    }, wait);
  } as T;
}
