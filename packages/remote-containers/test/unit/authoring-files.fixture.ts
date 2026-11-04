import type {AuthoringFiles} from '../../src/authoring/window-files.ts';

/** A file system of text files by absolute path; a folder exists when a file is below it. */
export function filesOf(contents: Record<string, string>): AuthoringFiles {
  function names(
    folder: string,
  ): Array<{name: string; kind: 'file' | 'folder'}> {
    const seen = new Map<string, 'file' | 'folder'>();
    for (const file of Object.keys(contents)) {
      if (file.startsWith(`${folder}/`)) {
        const [first = '', ...rest] = file.slice(folder.length + 1).split('/');
        seen.set(first, rest.length === 0 ? 'file' : 'folder');
      }
    }
    return [...seen].map(([name, kind]) => ({name, kind}));
  }
  return {
    kindOf: file =>
      Promise.resolve(
        file in contents
          ? 'file'
          : names(file).length > 0
            ? 'folder'
            : 'missing',
      ),
    exists: file => Promise.resolve(file in contents || names(file).length > 0),
    list: folder => Promise.resolve(names(folder)),
    read: file => {
      const text = contents[file];
      return text === undefined
        ? Promise.reject(new Error('gone'))
        : Promise.resolve(new TextEncoder().encode(text));
    },
    write: () => Promise.resolve(),
    makeFolder: () => Promise.resolve(),
    removeFile: () => Promise.resolve(),
    removeFolder: () => Promise.resolve(),
    creationProblem: () => Promise.resolve(undefined),
  };
}
