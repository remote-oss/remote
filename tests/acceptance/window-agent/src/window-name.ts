import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** The name of a window: the last segment of its first workspace folder's path, or `local` for a window without one. */
export function windowNameOf(firstFolderPath: string | undefined): string {
  const segment = firstFolderPath
    ?.split('/')
    .filter(part => part !== '')
    .at(-1);
  return segment ?? 'local';
}

/** Creates the claim file exclusively: the name is claimed when the creation succeeds, taken when the file exists. */
function claim(claimsFolder: string, name: string): boolean {
  try {
    closeSync(openSync(path.join(claimsFolder, name), 'wx'));
    return true;
  } catch {
    // The claim file exists: an earlier window took the name.
    return false;
  }
}

/**
 * Claims the first free window name by creating its claim file exclusively, and returns the name it got: `local`
 * first, then `empty-1`, `empty-2`, … A created claim file is kept, so an earlier window never loses its name to a
 * later one, and a window with a folder never claims at all.
 */
export function claimWindowName(claimsFolder: string): string {
  mkdirSync(claimsFolder, {recursive: true});
  if (claim(claimsFolder, 'local')) {
    return 'local';
  }
  for (let number = 1; ; number += 1) {
    const name = `empty-${String(number)}`;
    if (claim(claimsFolder, name)) {
      return name;
    }
  }
}

/**
 * Writes the name a window's agent got to the launch's pid file for the window's process: the adapters of that same
 * process read one file, so they share the agent's source. The file is rewritten at every activation, so a reused
 * process id never carries the name of the window that ran in it before.
 */
export function recordWindowName(
  pidsFolder: string,
  processId: number,
  name: string,
): void {
  mkdirSync(pidsFolder, {recursive: true});
  writeFileSync(path.join(pidsFolder, String(processId)), name);
}

/** The name each process of the launch's windows recorded, by process id, read from the pid files. */
export function recordedWindowNames(pidsFolder: string): Map<number, string> {
  const holders = new Map<number, string>();
  try {
    for (const file of readdirSync(pidsFolder)) {
      if (/^\d+$/.test(file)) {
        holders.set(
          Number(file),
          readFileSync(path.join(pidsFolder, file), 'utf8'),
        );
      }
    }
  } catch {
    // No window has recorded a name yet.
  }
  return holders;
}

/** Whether the process with id `processId` still runs. */
export function processRuns(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    // A process of another user exists but cannot be signalled.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * The name of a window with a folder: `base` when no live window holds it, else the first of `base-2`, `base-3`, …
 * that none holds. A window holds a name while the process that recorded it runs, so a reload, which ends the old
 * process, gives the name back to the window that reloads. The record of `ownProcess` does not count.
 */
export function folderWindowName(
  base: string,
  holders: ReadonlyMap<number, string>,
  runs: (processId: number) => boolean,
  ownProcess: number,
): string {
  const held = new Set(
    [...holders]
      .filter(([processId]) => processId !== ownProcess && runs(processId))
      .map(([, name]) => name),
  );
  if (!held.has(base)) {
    return base;
  }
  for (let number = 2; ; number += 1) {
    const name = `${base}-${String(number)}`;
    if (!held.has(name)) {
      return name;
    }
  }
}
