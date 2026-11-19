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

  /** `removeNow` removes a file without waiting, as an ending extension must. */
  constructor(removeNow: (path: string) => void) {
    this.removeNow = removeNow;
  }

  /** Notes the file at `path` as held. */
  hold(path: string): void {
    this.paths.add(path);
  }

  /** Notes the file at `path` as no longer held. */
  forget(path: string): void {
    this.paths.delete(path);
  }

  /**
   * Ends the hold of the file at `path` and removes the file at once: a window that ends right after its connect gave
   * the lock back, before any wait could remove it, leaves no file for the next window to wait on.
   */
  release(path: string): void {
    this.paths.delete(path);
    this.removeNow(path);
  }

  /** Removes the file of every lock still held: the extension's clean end. */
  releaseAll(): void {
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
          dependencies.held.hold(path);
          resolve({
            kind: 'done',
            value: {
              release: () => {
                dependencies.held.release(path);
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
