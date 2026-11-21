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

  /**
   * Removes the file this extension created at `path`, and stops holding it when `wasHeld`, in one call, so that no
   * end can come between the two. A held file the end has removed already is left alone, since another window may
   * hold it by now.
   */
  release(path: string, wasHeld: boolean): void {
    if (!wasHeld || this.paths.delete(path)) {
      this.removeNow(path);
    }
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

/**
 * `port` with its removal of a file this caller created made by `held`, at once, `holding` telling whether the lock
 * was held by then: the takeover of another window's left file still goes to `port`.
 */
function releasingThrough(
  port: LockFilePort,
  held: HeldClientLocks,
  holding: () => boolean,
): LockFilePort {
  let created = false;
  return {
    createExclusive: async path => {
      const outcome = await port.createExclusive(path);
      created = outcome === 'created';
      return outcome;
    },
    ageMilliseconds: path => port.ageMilliseconds(path),
    remove: path => {
      if (!created) {
        return port.remove(path);
      }
      created = false;
      held.release(path, holding());
      return Promise.resolve();
    },
  };
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
      let holdsLock = false;
      const holding = new Promise<void>(end => {
        hold.end = end;
      });
      withClientLock(
        releasingThrough(dependencies.port, dependencies.held, () => holdsLock),
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
          holdsLock = true;
          // A connect that is given up while it holds the lock gives it back, whatever its later steps do.
          cancellation.addEventListener(
            'abort',
            () => {
              hold.end?.();
            },
            {once: true},
          );
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
          if (outcome.kind === 'lockTimeout') {
            resolve({kind: 'failed', failure: LOCAL_LOCK_TIMEOUT});
          } else if (outcome.kind === 'cancelled') {
            resolve({kind: 'failed', failure: {kind: 'cancelled'}});
          }
        },
        (caught: unknown) => {
          dependencies.logger.warn(
            `the local install lock ${named} could not be used: ${String(caught)}`,
          );
          resolve({kind: 'done', value: {release: () => undefined}});
        },
      );
    });
  };
}
