/**
 * @fileoverview What a window leaves for the next one to take once, across a reload or a restart: one file for each
 * handoff, named by a hash of its key and written whole under a temporary name renamed over it, so that no other
 * window's write can drop it. The consumer takes it by claim: it renames the file to a name of its own, which only one
 * of several windows that activate at once can do, then reads it and deletes it. A handoff older than its lifetime, or
 * one that is not a value its taker accepts, is deleted and taken by none.
 */

import {createHash} from 'node:crypto';
import path from 'node:path';
import {type EventFiles, isRecord} from './event-files.ts';

/** A handoff as it was taken: when it was left, and what it holds. */
export interface TakenHandoff<Value> {
  storedAt: number;
  value: Value;
}

/** The handoffs of one kind, in one folder. */
export interface HandoffStore<Value> {
  /** Leaves `value` for `key`, in place of an earlier one; rejects when the write fails. */
  leave(key: string, value: Value): Promise<void>;
  /** Takes the handoff for `key` once; none when there is none, another window took it, or it is stale or unreadable. */
  take(key: string): TakenHandoff<Value> | undefined;
}

/** How long a claim, or a write not yet renamed, stays before a later write removes it, in milliseconds. */
const LEFTOVER_AFTER = 24 * 60 * 60 * 1000;

const CLAIM_FILE = /\.claim-[0-9a-f]+$/;
const TEMPORARY_FILE = /\.tmp-[0-9a-f]+$/;

/** The outcome of `work` as a promise, which rejects with what `work` throws. */
function settled<Value>(work: () => Value): Promise<Value> {
  return new Promise(resolve => {
    resolve(work());
  });
}

/**
 * The handoffs of one kind in `folder`, left and taken with `files` at the times `now` gives. `isValue` says which
 * values a taker accepts, and `lifetime` how long a handoff stays takable, in milliseconds; none means for good.
 */
export function handoffStoreOf<Value>(options: {
  folder: string;
  files: EventFiles;
  now: () => number;
  isValue: (value: unknown) => value is Value;
  lifetime?: number;
}): HandoffStore<Value> {
  const {folder, files, now, isValue, lifetime} = options;

  /** The file of `key`: the hash of the key, so that no key reaches outside the folder. */
  function fileOf(key: string): string {
    return path.join(
      folder,
      `${createHash('sha256').update(key).digest('hex')}.json`,
    );
  }

  /** Removes the claims and the unrenamed writes that have lain for a day: a window that ended in the middle of one. */
  function sweep(): void {
    const before = now() - LEFTOVER_AFTER;
    for (const name of files.names(folder)) {
      const file = path.join(folder, name);
      const modified = files.modified(file);
      if (
        modified !== undefined &&
        modified <= before &&
        (CLAIM_FILE.test(name) || TEMPORARY_FILE.test(name))
      ) {
        files.remove(file);
      }
    }
  }

  /** The handoff a file's text holds, when it is one a taker accepts and it is not stale or from the future. */
  function handoffIn(
    text: string | undefined,
  ): TakenHandoff<Value> | undefined {
    let value: unknown;
    try {
      value = text === undefined ? undefined : JSON.parse(text);
    } catch {
      return undefined;
    }
    if (!isRecord(value) || typeof value.storedAt !== 'number') {
      return undefined;
    }
    const elapsed = now() - value.storedAt;
    return elapsed >= 0 &&
      (lifetime === undefined || elapsed <= lifetime) &&
      isValue(value.value)
      ? {storedAt: value.storedAt, value: value.value}
      : undefined;
  }

  return {
    leave: (key, value) =>
      settled(() => {
        const file = fileOf(key);
        files.makeFolder(folder);
        sweep();
        const temporary = `${file}.tmp-${files.random()}`;
        files.write(temporary, JSON.stringify({storedAt: now(), value}));
        files.rename(temporary, file);
      }),
    take: key => {
      const file = fileOf(key);
      const claim = `${file.slice(0, -'.json'.length)}.claim-${files.random()}`;
      try {
        files.rename(file, claim);
      } catch {
        // None was left, or another window claimed it first.
        return undefined;
      }
      const text = files.read(claim);
      files.remove(claim);
      return handoffIn(text);
    },
  };
}
