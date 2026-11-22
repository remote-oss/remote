/**
 * @fileoverview The profile's copy of the pre-connection confirmations, one small file for each, in a folder of the
 * extension's global storage (per profile, like the global state): the file holds the content hash that was confirmed.
 * The global state is one object that every window rewrites whole, so a confirmation can be lost from it (#2326), and a
 * retry reloads the window, so only a file survives. A file is a stored approval to run a script without asking, so it is
 * trusted no more than the state database beside it: it is written whole under a temporary name and renamed over the
 * final one, with the modes 0700 for the folder and 0600 for the files, and it is read only when it is a regular file
 * (never a symlink: it is opened without following one, and its facts and content are read from that one descriptor) that belongs to the current user and that group and others cannot write, and holds exactly a
 * SHA-256 in lowercase hexadecimal and at most one trailing newline. Anything else is no confirmation, with the reason.
 */

import {randomBytes} from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** What a read of one copy found. */
export type CopyRead =
  {kind: 'hash'; hash: string} | {kind: 'ignored'; reason: string};

/** The copies of the confirmations, by file name. */
export interface ConfirmationCopies {
  /** What the file of `name` holds; nothing when there is no such file. */
  read(name: string): CopyRead | undefined;
  /** Writes the hash of `name`; rejects with the system's error when it cannot. */
  write(name: string, hash: string): Promise<void>;
}

/** What a file is, as the system reports it without following a link. */
interface FileFacts {
  regular: boolean;
  /** The owner's user id; nothing on a system that has none. */
  owner: number | undefined;
  mode: number;
}

/** A file that is open: its facts and its content are read from the one descriptor, so no swap of the path can part them. */
interface OpenedFile {
  /** The facts of the file that is open. */
  facts(): FileFacts;
  read(): string;
  close(): void;
}

/** What the files are written and read with, which a row replaces. */
export interface ConfirmationFileSystem {
  makeFolder(folder: string): void;
  write(file: string, text: string): void;
  rename(source: string, target: string): void;
  /** Opens the file without following a link; throws the system's error: `ENOENT` for no file, `ELOOP` for a link. */
  open(file: string): OpenedFile;
  /** The user id of this process; nothing on a system that has none. */
  user(): number | undefined;
  /** A name for a temporary file that no other writer picks. */
  random(): string;
}

/** The mode of the folder and of each file. */
const FOLDER_MODE = 0o700;
const FILE_MODE = 0o600;

/** The file system of this machine. */
export const NODE_CONFIRMATION_FILES: ConfirmationFileSystem = {
  makeFolder: folder => {
    mkdirSync(folder, {recursive: true, mode: FOLDER_MODE});
  },
  write: (file, text) => {
    writeFileSync(file, text, {mode: FILE_MODE});
  },
  rename: (source, target) => {
    renameSync(source, target);
  },
  open: file => {
    // A system that has no O_NOFOLLOW reads it as undefined, which `|` takes as 0: it has no links to follow either.
    const descriptor = openSync(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    return {
      facts: () => {
        const facts = fstatSync(descriptor);
        return {regular: facts.isFile(), owner: facts.uid, mode: facts.mode};
      },
      read: () => readFileSync(descriptor, 'utf8'),
      close: () => {
        closeSync(descriptor);
      },
    };
  },
  // A system without users has no `getuid`, and then the owner and the mode are not asked.
  user: () => process.getuid?.(),
  random: () => randomBytes(6).toString('hex'),
};

/** What a file name is: the lowercase hexadecimal SHA-256 of the script's path, which no path makes longer or leaves the folder. */
const NAME_PATTERN = /^[0-9a-f]{64}$/;

/** A content hash: the lowercase hexadecimal SHA-256 of the file's content. */
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** The mode bits with which group and others can write. */
const WRITABLE_BY_OTHERS = 0o022;

/** What the open file holds, or why it is not to be trusted; nothing when its facts or its content cannot be read. */
function judged(
  opened: OpenedFile,
  user: number | undefined,
): CopyRead | undefined {
  try {
    const facts = opened.facts();
    if (!facts.regular) {
      return {kind: 'ignored', reason: 'it is not a regular file'};
    }
    if (user !== undefined && facts.owner !== user) {
      return {kind: 'ignored', reason: 'it belongs to another user'};
    }
    if (user !== undefined && (facts.mode & WRITABLE_BY_OTHERS) !== 0) {
      return {kind: 'ignored', reason: 'group or others can write it'};
    }
    const text = opened.read();
    const content = text.endsWith('\n') ? text.slice(0, -1) : text;
    return HASH_PATTERN.test(content)
      ? {kind: 'hash', hash: content}
      : {kind: 'ignored', reason: 'it is not a hash'};
  } catch {
    return undefined;
  }
}

/**
 * The copies in `folder`. A name that is no file name of the form, a file that is not there and one that cannot be read
 * are no file; a file that is there but is not to be trusted is ignored with its reason.
 */
export function confirmationFilesOf(
  folder: string,
  files: ConfirmationFileSystem = NODE_CONFIRMATION_FILES,
): ConfirmationCopies {
  return {
    read: name => {
      if (!NAME_PATTERN.test(name)) {
        return undefined;
      }
      let opened: OpenedFile;
      try {
        opened = files.open(path.join(folder, name));
      } catch (caught) {
        const code = (caught as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return undefined;
        }
        return {
          kind: 'ignored',
          reason:
            code === 'ELOOP' ? 'it is a symbolic link' : 'it cannot be opened',
        };
      }
      const found = judged(opened, files.user());
      try {
        opened.close();
      } catch {
        // A descriptor that cannot be closed changes nothing of what was read.
      }
      return found;
    },
    write: (name, hash) => {
      if (!NAME_PATTERN.test(name) || !HASH_PATTERN.test(hash)) {
        return Promise.resolve();
      }
      try {
        files.makeFolder(folder);
        const temporary = path.join(folder, `${name}.tmp-${files.random()}`);
        files.write(temporary, hash);
        files.rename(temporary, path.join(folder, name));
        return Promise.resolve();
      } catch (caught) {
        return Promise.reject(
          caught instanceof Error ? caught : new Error(String(caught)),
        );
      }
    },
  };
}
