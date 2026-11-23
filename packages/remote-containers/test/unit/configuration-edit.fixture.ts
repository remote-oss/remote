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
  /** The documents some editorTab holds, by path. */
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

/** Editor ports over `editor`, with the calls they get, as lines, in `calls`. */
export function fakePortsOf(editor: FakeEditor = {}): {
  ports: ConfigurationEditPorts;
  calls: string[];
} {
  const calls: string[] = [];
  const files = editor.files ?? {};
  const documents: ConfigDocument[] = Object.entries(editor.tabs ?? {}).map(
    ([file, editorTab]) => ({
      uri: uriOf(file),
      isDirty: editorTab.dirty,
      getText: () => editorTab.text,
    }),
  );
  const ports: ConfigurationEditPorts = {
    openDocuments: () => documents,
    openTextDocument: uri => {
      calls.push(`open ${uri.fsPath}`);
      return Promise.resolve({
        uri,
        isDirty: false,
        getText: () => files[uri.fsPath] ?? '',
      });
    },
    applyEdit: (document, text) => {
      calls.push(`edit ${document.uri.fsPath} ${JSON.stringify(text)}`);
      return Promise.resolve(true);
    },
    save: document => {
      calls.push(`save ${document.uri.fsPath}`);
      return Promise.resolve(true);
    },
    fileSystem: {
      stat: uri =>
        uri.fsPath in files
          ? Promise.resolve({
              symbolicLink:
                editor.linkSchemes === true && uri.scheme !== 'file',
            })
          : Promise.reject(new Error('ENOENT')),
      readFile: uri => {
        calls.push(`read ${uri.fsPath}`);
        return Promise.resolve(files[uri.fsPath] ?? '');
      },
      writeFile: (uri, text) => {
        calls.push(`write ${uri.fsPath} ${JSON.stringify(text)}`);
        return Promise.resolve();
      },
      rename: (from, target) => {
        calls.push(`rename ${from.fsPath} ${target.fsPath}`);
        return editor.renameFails === true
          ? Promise.reject(new Error('EXDEV'))
          : Promise.resolve();
      },
      delete: uri => {
        calls.push(`delete ${uri.fsPath}`);
        return Promise.resolve();
      },
    },
    realPath: uri => {
      if (editor.logRealPaths === true) {
        calls.push(`realPath ${uri.scheme}:${uri.fsPath}`);
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
  return {ports, calls};
}
