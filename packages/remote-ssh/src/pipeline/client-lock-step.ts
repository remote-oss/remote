/**
 * @fileoverview The client install lock of a connect's alias: one empty file in the editor's temporary folder, which
 * windows of one editor that set up the same alias take in turn, from the start of the setup until the install phase
 * is over. The locks still held when the extension ends are removed then.
 */

import {
  type Clock,
  clientLockPath,
  type LockFilePort,
  lockIdFor,
  withClientLock,
} from 'lib-server';
import type {Logger} from 'lib-log';
import {connectionKeyOf} from './connection-step.ts';
import {LOCAL_LOCK_TIMEOUT} from './failure.ts';
import type {ConnectSteps} from './steps.ts';

/** The client lock files this extension holds, by path, so that the extension's end removes them. */
export class HeldClientLocks {
  private readonly paths = new Set<string>();
  private readonly removeNow: (path: string) => void;
  private ended = false;

  /** `removeNow` removes a file without waiting, as an ending extension must. */
  constructor(removeNow: (path: string) => void) {
    this.removeNow = removeNow;
  }

  /**
   * Notes the file at `path` as held, and whether it may be: a lock taken after the extension's end (its file created
   * while the end ran) is removed at once and is not held.
   */
  hold(path: string): boolean {
    if (this.ended) {
      this.removeNow(path);
      return false;
    }
    this.paths.add(path);
    return true;
  }

  /** Notes the file at `path` as no longer held, once the lock's own removal of it has run. */
  forget(path: string): void {
    this.paths.delete(path);
  }

  /** Removes the file of every lock still held, and of every lock taken from now on: the extension's end. */
  releaseAll(): void {
    this.ended = true;
    for (const path of this.paths) {
      this.removeNow(path);
    }
    this.paths.clear();
  }
}

/** What the client lock step is made from. */
export interface ClientLockStepDependencies {
  port: LockFilePort;
  /** The editor's temporary folder. */
  folder: string;
  clock: Clock;
  held: HeldClientLocks;
  logger: Logger;
}

/**
 * The step that takes the alias's client lock. A lock the temporary folder cannot hold never fails a connect: the
 * error is logged and the connect goes on without it.
 */
export function holdClientLockStep(
  dependencies: ClientLockStepDependencies,
): ConnectSteps['holdClientLock'] {
  return (input, onWaiting, cancellation) => {
    const key = connectionKeyOf(input);
    const path = clientLockPath(dependencies.folder, key);
    // The log redacts a file name this long, so the line names the lock by its folder and id.
    const named = `${lockIdFor(key)} in ${dependencies.folder}`;
    dependencies.logger.info(`Acquiring local install lock ${named}`);
    return new Promise(resolve => {
      const hold: {end?: () => void} = {};
      const holding = new Promise<void>(end => {
        hold.end = end;
      });
      withClientLock(
        dependencies.port,
        dependencies.folder,
        key,
        dependencies.clock,
        () => {
          if (!dependencies.held.hold(path)) {
            resolve({kind: 'failed', failure: {kind: 'cancelled'}});
            // The extension is ending and the file is gone already: the lock's own removal must not follow, since
            // another window may have taken the lock by then.
            return new Promise<void>(() => undefined);
          }
          resolve({
            kind: 'done',
            value: {
              release: () => {
                hold.end?.();
              },
            },
          });
          return holding;
        },
        onWaiting,
        {cancellation},
      ).then(
        outcome => {
          // A released lock stays held until its file is removed, here, and only here: an extension that ends in between
          // still removes it, and a window that took the lock after that removal keeps its file.
          if (outcome.kind === 'done') {
            dependencies.held.forget(path);
          } else if (outcome.kind === 'lockTimeout') {
            resolve({kind: 'failed', failure: LOCAL_LOCK_TIMEOUT});
          } else {
            resolve({kind: 'failed', failure: {kind: 'cancelled'}});
          }
        },
        (caught: unknown) => {
          dependencies.held.forget(path);
          dependencies.logger.warn(
            `the local install lock ${named} could not be used: ${String(caught)}`,
          );
          resolve({kind: 'done', value: {release: () => undefined}});
        },
      );
    });
  };
}
