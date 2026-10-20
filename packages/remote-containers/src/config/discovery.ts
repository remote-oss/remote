/**
 * @fileoverview The dev container configuration files of a folder, in the order the picker lists them: the dotfile at
 * the root, `devcontainer.json` in `.devcontainer`, and one in each immediate subfolder of `.devcontainer`.
 */

/** A place a configuration is found: the root dotfile, the root `.devcontainer/devcontainer.json`, or a subfolder. */
export type CandidatePlace =
  {kind: 'dotfile'} | {kind: 'main'} | {kind: 'subfolder'; name: string};

/** One configuration file found in the folder. */
export interface Candidate {
  /** Absolute, through any link, never resolved. */
  file: string;
  /** Relative to the folder, with `/` separators: `.devcontainer/a/devcontainer.json`. */
  relative: string;
  place: CandidatePlace;
}

/** What discovery asks of the file system. */
export interface ConfigFiles {
  /** The entries of a folder; none when it doesn't exist or can't be listed. A link counts as what it points to. */
  list(
    folder: string,
  ): Promise<ReadonlyArray<{name: string; kind: 'file' | 'folder' | 'other'}>>;
  /** The file's bytes, or `unreadable` when it can't be opened (permission denied, gone). */
  read(file: string): Promise<Uint8Array | 'unreadable'>;
  /** Whether a file or folder exists at the absolute path. */
  exists(path: string): Promise<boolean>;
}

const DOTFILE = '.devcontainer.json';
const FOLDER = '.devcontainer';
const FILE = 'devcontainer.json';

/** The code-unit order of two names: the tie-break that makes the order total. */
function byCodeUnits(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** Whether `entries` hold a file named `name`, matched exactly. */
function hasFile(
  entries: ReadonlyArray<{name: string; kind: string}>,
  name: string,
): boolean {
  return entries.some(entry => entry.name === name && entry.kind === 'file');
}

/** The configurations found in `folder`, in the order of the picker; `compare` orders the subfolders' names. */
export async function discoverConfigurations(
  folder: string,
  files: ConfigFiles,
  compare: (left: string, right: string) => number,
): Promise<Candidate[]> {
  const found: Candidate[] = [];
  const root = await files.list(folder);
  if (hasFile(root, DOTFILE)) {
    found.push({
      file: `${folder}/${DOTFILE}`,
      relative: DOTFILE,
      place: {kind: 'dotfile'},
    });
  }
  const hasFolder = root.some(
    entry => entry.name === FOLDER && entry.kind === 'folder',
  );
  if (!hasFolder) {
    return found;
  }
  const inside = await files.list(`${folder}/${FOLDER}`);
  if (hasFile(inside, FILE)) {
    found.push({
      file: `${folder}/${FOLDER}/${FILE}`,
      relative: `${FOLDER}/${FILE}`,
      place: {kind: 'main'},
    });
  }
  const names = inside
    .filter(entry => entry.kind === 'folder')
    .map(entry => entry.name)
    .sort((left, right) => compare(left, right) || byCodeUnits(left, right));
  const listings = await Promise.all(
    names.map(name => files.list(`${folder}/${FOLDER}/${name}`)),
  );
  names.forEach((name, index) => {
    if (hasFile(listings[index] ?? [], FILE)) {
      found.push({
        file: `${folder}/${FOLDER}/${name}/${FILE}`,
        relative: `${FOLDER}/${name}/${FILE}`,
        place: {kind: 'subfolder', name},
      });
    }
  });
  return found;
}
