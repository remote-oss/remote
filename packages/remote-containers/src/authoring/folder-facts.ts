/**
 * @fileoverview What the wizard reads of the folder it writes into before it asks anything: the entries of its root,
 * and the files below it, by a walk bounded in entries and in depth so that a huge folder costs no more than a small one.
 */

import type {FolderFacts, RootEntry} from './curated-templates.ts';

/** How many entries the walk reads at most; past it the folder counts as holding a significant file. */
const ENTRY_BOUND = 5000;

/** How deep the walk goes below the folder. */
const DEPTH_BOUND = 8;

/** The folders of the walk: what the editor's file system lists. */
export interface WalkFiles {
  /** The entries of a folder, with what each is; none for a folder that cannot be listed. */
  list(folder: string): Promise<RootEntry[]>;
}

/** The root entries of `folder` and the files below it, as paths relative to it with `/`. */
export async function readFolderFacts(
  files: WalkFiles,
  folder: string,
): Promise<FolderFacts> {
  const rootEntries = await files.list(folder);
  const found: string[] = [];
  let read = rootEntries.length;
  let truncated = false;
  async function walk(
    current: string,
    entries: readonly RootEntry[],
    depth: number,
  ): Promise<void> {
    for (const entry of entries) {
      const relative = current === '' ? entry.name : `${current}/${entry.name}`;
      if (entry.kind === 'file') {
        found.push(relative);
      } else if (entry.kind === 'folder') {
        if (depth >= DEPTH_BOUND) {
          truncated = true;
        } else {
          const inner = await files.list(`${folder}/${relative}`);
          read += inner.length;
          if (read > ENTRY_BOUND) {
            truncated = true;
            return;
          }
          await walk(relative, inner, depth + 1);
        }
      }
      if (truncated) {
        return;
      }
    }
  }
  if (read > ENTRY_BOUND) {
    return {rootEntries, files: [], truncated: true};
  }
  await walk('', rootEntries, 1);
  return {rootEntries, files: found, truncated};
}
