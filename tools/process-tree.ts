/**
 * @fileoverview The process tree of a machine, read from each process's `stat` line: its parent and group
 * fields, the child of a root that a process descends from, and the whole tree of a root.
 */

import {readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';

/** One process of the tree: the fields its `stat` line holds that the tree needs. */
export interface ProcessStat {
  /** Field 1: the process's own id. */
  processId: number;
  /** Field 4: the id of the process that started it. */
  parent: number;
  /** Field 5: the id of the group it runs in. */
  group: number;
}

/**
 * The tree's fields of a `stat` line. Field 2, the command name, sits in parentheses and may itself hold
 * spaces and parentheses, so the numbered fields are read after the last closing one.
 */
export function processStatOf(processId: number, line: string): ProcessStat {
  const fields = line
    .slice(line.lastIndexOf(')') + 1)
    .trim()
    .split(' ');
  return {processId, parent: Number(fields[1]), group: Number(fields[2])};
}

/** The `stat` line of one entry of a folder: the file named by the process id, or the `stat` file inside the directory that, as /proc lays it out. */
function statLineOf(folder: string, name: string): string | undefined {
  try {
    const entry = path.join(folder, name);
    return statSync(entry).isDirectory()
      ? readFileSync(path.join(entry, 'stat'), 'utf8')
      : readFileSync(entry, 'utf8');
  } catch {
    // A process that ends between the listing and the read leaves nothing to read.
    return undefined;
  }
}

/**
 * The tree over a folder of processes: each process is a file named by its id that holds its `stat` line,
 * or a directory named by its id that holds the line in a `stat` file, as /proc lays it out. A name that is
 * not a whole-number process id, and a process that is already gone, are left out.
 */
export function processTreeOf(folder: string): Map<number, ProcessStat> {
  const tree = new Map<number, ProcessStat>();
  for (const name of readdirSync(folder)) {
    const processId = Number(name);
    if (!Number.isInteger(processId) || processId <= 0) {
      continue;
    }
    const line = statLineOf(folder, name);
    if (line !== undefined) {
      tree.set(processId, processStatOf(processId, line));
    }
  }
  return tree;
}

/**
 * The child of `root` that a process descends from: the walk of the parent field up from `start` stops at
 * the process whose parent is `root`. Fails when the start is not in the tree, or when the walk leaves it
 * before coming under `root`.
 */
export function descendantRootOf(
  tree: Map<number, ProcessStat>,
  start: number,
  root: number,
): number {
  let current = start;
  for (;;) {
    const stat = tree.get(current);
    if (stat === undefined) {
      throw new Error(`the process ${String(start)} is not in the tree`);
    }
    if (stat.parent === root) {
      return current;
    }
    if (current === root || stat.parent === 0) {
      throw new Error(
        `the process ${String(start)} never comes under ${String(root)}`,
      );
    }
    current = stat.parent;
  }
}

/** The whole tree of a root: the root itself, and every process whose parent chain leads to it, in id order. */
export function treeOf(tree: Map<number, ProcessStat>, root: number): number[] {
  const children = new Map<number, number[]>();
  for (const [processId, stat] of tree) {
    const siblings = children.get(stat.parent) ?? [];
    siblings.push(processId);
    children.set(stat.parent, siblings);
  }
  const under = new Set<number>();
  const toVisit = [root];
  for (;;) {
    const processId = toVisit.pop();
    if (processId === undefined) {
      break;
    }
    if (!under.has(processId)) {
      under.add(processId);
      for (const child of children.get(processId) ?? []) {
        toVisit.push(child);
      }
    }
  }
  return [...tree.keys()]
    .sort((smaller, larger) => smaller - larger)
    .filter(processId => under.has(processId));
}
