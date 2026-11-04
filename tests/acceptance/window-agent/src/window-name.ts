import {createHash} from 'node:crypto';
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

/** The longest name of an agent file that is kept as it is, in bytes: well under the 255 of a file system's NAME_MAX. */
const AGENT_FILE_NAME_LIMIT = 200;

/** How much of a window name a mapped file name keeps: at most this many characters, and at most this many bytes. */
const KEPT_PREFIX = 100;

/** The ending of a mapped name: a dash and the first 16 hex digits of the full name's SHA-256. */
const MAPPED_ENDING = /-[0-9a-f]{16}$/;

/** The kinds of file a window's agent keeps. */
export type AgentFileKind = 'events' | 'commands';

/**
 * The name of window `name`'s agent file of `kind`: `<name>.<kind>.jsonl` when that fits in 200 bytes. For a longer
 * name, the name is replaced by its first 100 characters, cut further so they stay within 100 bytes, then a dash and
 * the first 16 hex digits of its SHA-256. Every file of a name that fits keeps its name, and two long names with the
 * same beginning stay apart.
 */
export function agentFileName(name: string, kind: AgentFileKind): string {
  const plain = `${name}.${kind}.jsonl`;
  if (Buffer.byteLength(plain) <= AGENT_FILE_NAME_LIMIT) {
    return plain;
  }
  let prefix = '';
  for (const character of Array.from(name).slice(0, KEPT_PREFIX)) {
    if (Buffer.byteLength(prefix + character) > KEPT_PREFIX) {
      break;
    }
    prefix += character;
  }
  const digest = createHash('sha256').update(name).digest('hex').slice(0, 16);
  return `${prefix}-${digest}.${kind}.jsonl`;
}

/** Whether the events file `fileName` may be a mapped one, whose window name only its `activated` event holds. */
export function mayBeMapped(fileName: string): boolean {
  return MAPPED_ENDING.test(fileName.slice(0, -'.events.jsonl'.length));
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
