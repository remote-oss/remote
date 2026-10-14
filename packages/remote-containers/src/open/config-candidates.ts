/**
 * @fileoverview The dev container configuration files of a folder, in the order they are looked up: the
 * dotfile at the root, `devcontainer.json` in `.devcontainer`, and one in each immediate subfolder of `.devcontainer`.
 */

import path from 'node:path';

/** What the lookup asks of the file system. */
export interface CandidateFiles {
  isFile(file: string): Promise<boolean>;
  /** The names of the immediate subfolders; none when the folder is missing. */
  subfolders(folder: string): Promise<readonly string[]>;
}

/** The absolute paths of `folder`'s configuration files that exist, in the order of the lookup. */
export async function configCandidates(
  folder: string,
  files: CandidateFiles,
): Promise<string[]> {
  const folderPath = path.join(folder, '.devcontainer');
  const names = [...(await files.subfolders(folderPath))].sort((left, right) =>
    left.localeCompare(right, undefined, {sensitivity: 'base'}),
  );
  const listed = [
    path.join(folder, '.devcontainer.json'),
    path.join(folderPath, 'devcontainer.json'),
    ...names.map(name => path.join(folderPath, name, 'devcontainer.json')),
  ];
  const found: string[] = [];
  for (const file of listed) {
    if (await files.isFile(file)) {
      found.push(file);
    }
  }
  return found;
}
