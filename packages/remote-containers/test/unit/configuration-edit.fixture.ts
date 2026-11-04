import type {
  ConfigDocument,
  ConfigUri,
  ConfigurationEditPorts,
} from '../../src/config/configuration-edit.ts';

/** A `file:` URI, or one of another scheme, for the path `text`. */
export function uriOf(text: string, scheme = 'file'): ConfigUri {
  return {scheme, fsPath: text, toString: () => `${scheme}:${text}`};
}

/** What the fake editor and file system hold and do. */
export interface FakeEditor {
  /** The text of the files on disk, by path. */
  files?: Record<string, string>;
  /** The documents some tab holds, by path. */
  tabs?: Record<string, {text: string; dirty: boolean}>;
  /** The real path of a path that is a link. */
  realPaths?: Record<string, string>;
  folders?: ConfigUri[];
  /** Whether a file of a scheme other than `file` is a symbolic link. */
  linkSchemes?: boolean;
  renameFails?: boolean;
  /** Whether a real path asked for is logged. */
  logRealPaths?: boolean;
}

/** Editor ports over `editor`, with the calls they get, as lines, in `log`. */
export function fakePortsOf(editor: FakeEditor = {}): {
  ports: ConfigurationEditPorts;
  log: string[];
} {
  const log: string[] = [];
  const files = editor.files ?? {};
  const documents: ConfigDocument[] = Object.entries(editor.tabs ?? {}).map(
    ([file, tab]) => ({
      uri: uriOf(file),
      isDirty: tab.dirty,
      getText: () => tab.text,
    }),
  );
  const ports: ConfigurationEditPorts = {
    openDocuments: () => documents,
    openTextDocument: uri => {
      log.push(`open ${uri.fsPath}`);
      return Promise.resolve({
        uri,
        isDirty: false,
        getText: () => files[uri.fsPath] ?? '',
      });
    },
    applyEdit: (document, text) => {
      log.push(`edit ${document.uri.fsPath} ${JSON.stringify(text)}`);
      return Promise.resolve(true);
    },
    save: document => {
      log.push(`save ${document.uri.fsPath}`);
      return Promise.resolve(true);
    },
    fs: {
      stat: uri =>
        uri.fsPath in files
          ? Promise.resolve({
              symbolicLink:
                editor.linkSchemes === true && uri.scheme !== 'file',
            })
          : Promise.reject(new Error('ENOENT')),
      readFile: uri => {
        log.push(`read ${uri.fsPath}`);
        return Promise.resolve(files[uri.fsPath] ?? '');
      },
      writeFile: (uri, text) => {
        log.push(`write ${uri.fsPath} ${JSON.stringify(text)}`);
        return Promise.resolve();
      },
      rename: (from, to) => {
        log.push(`rename ${from.fsPath} ${to.fsPath}`);
        return editor.renameFails === true
          ? Promise.reject(new Error('EXDEV'))
          : Promise.resolve();
      },
      delete: uri => {
        log.push(`delete ${uri.fsPath}`);
        return Promise.resolve();
      },
    },
    realPath: uri => {
      if (editor.logRealPaths === true) {
        log.push(`realPath ${uri.scheme}:${uri.fsPath}`);
      }
      return Promise.resolve(editor.realPaths?.[uri.fsPath] ?? uri.fsPath);
    },
    workspaceFolders: () => editor.folders ?? [uriOf('/work/proj')],
    fileUri: fsPath => uriOf(fsPath),
    sibling: (uri, name) =>
      uriOf(
        `${uri.fsPath.slice(0, uri.fsPath.lastIndexOf('/'))}/${name}`,
        uri.scheme,
      ),
    unique: () => 'u1',
  };
  return {ports, log};
}
