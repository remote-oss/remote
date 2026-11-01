import * as vscode from 'vscode';

/** The scheme of the in-memory file system the rows' virtual workspaces use. */
export const MEMORY_SCHEME = 'memfs';

/** A file or a folder of the in-memory file system. */
type Entry =
  | {kind: 'file'; data: Uint8Array; time: number}
  | {kind: 'folder'; time: number};

/** An in-memory file system with one root folder `/`, for the rows that need a workspace folder that is not on disk. */
export class MemoryFileSystem implements vscode.FileSystemProvider {
  private readonly entries = new Map<string, Entry>([
    ['/', {kind: 'folder', time: Date.now()}],
  ]);
  private readonly changes = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();

  /** Fires for each file written or deleted. */
  readonly onDidChangeFile = this.changes.event;

  /** Watches nothing: the changes are all reported by `onDidChangeFile`. */
  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  /** The type, times and size of `uri`. */
  stat(uri: vscode.Uri): vscode.FileStat {
    const entry = this.entryOf(uri);
    return {
      type:
        entry.kind === 'file'
          ? vscode.FileType.File
          : vscode.FileType.Directory,
      ctime: entry.time,
      mtime: entry.time,
      size: entry.kind === 'file' ? entry.data.length : 0,
    };
  }

  /** The names and types of the entries directly below the folder `uri`. */
  readDirectory(uri: vscode.Uri): Array<[string, vscode.FileType]> {
    const folder = uri.path.replace(/\/$/, '');
    return [...this.entries]
      .filter(
        ([key]) =>
          key !== '/' &&
          key.startsWith(`${folder}/`) &&
          !key.slice(folder.length + 1).includes('/'),
      )
      .map(([key, entry]) => [
        key.slice(folder.length + 1),
        entry.kind === 'file'
          ? vscode.FileType.File
          : vscode.FileType.Directory,
      ]);
  }

  /** The bytes of the file `uri`. */
  readFile(uri: vscode.Uri): Uint8Array {
    const entry = this.entryOf(uri);
    if (entry.kind !== 'file') {
      throw vscode.FileSystemError.FileIsADirectory(uri);
    }
    return entry.data;
  }

  /** Writes `content` to the file `uri`, making its folders. */
  writeFile(uri: vscode.Uri, content: Uint8Array): void {
    const existed = this.entries.has(uri.path);
    this.makeFolders(uri.path.slice(0, uri.path.lastIndexOf('/')));
    this.entries.set(uri.path, {
      kind: 'file',
      data: content,
      time: Date.now(),
    });
    this.changes.fire([
      {
        type: existed
          ? vscode.FileChangeType.Changed
          : vscode.FileChangeType.Created,
        uri,
      },
    ]);
  }

  /** Makes the folder `uri` and the ones above it. */
  createDirectory(uri: vscode.Uri): void {
    this.makeFolders(uri.path);
  }

  /** Removes `uri` and everything below it. */
  delete(uri: vscode.Uri): void {
    for (const key of [...this.entries.keys()]) {
      if (key === uri.path || key.startsWith(`${uri.path}/`)) {
        this.entries.delete(key);
      }
    }
    this.changes.fire([{type: vscode.FileChangeType.Deleted, uri}]);
  }

  /** Moves `source` and everything below it to `target`. */
  rename(source: vscode.Uri, target: vscode.Uri): void {
    for (const [key, entry] of [...this.entries]) {
      if (key === source.path || key.startsWith(`${source.path}/`)) {
        this.entries.delete(key);
        this.entries.set(target.path + key.slice(source.path.length), entry);
      }
    }
  }

  /** The entry of `uri`, or a not-found error. */
  private entryOf(uri: vscode.Uri): Entry {
    const entry = this.entries.get(uri.path === '' ? '/' : uri.path);
    if (entry === undefined) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    return entry;
  }

  /** Makes the folder `folder` and the ones above it. */
  private makeFolders(folder: string): void {
    let path = '';
    for (const part of folder.split('/').filter(each => each !== '')) {
      path += `/${part}`;
      if (!this.entries.has(path)) {
        this.entries.set(path, {kind: 'folder', time: Date.now()});
      }
    }
  }
}
