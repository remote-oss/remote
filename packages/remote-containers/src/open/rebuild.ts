/**
 * @fileoverview Rebuild Container and Rebuild Container Without Cache, in a dev-container window: the window leaves a
 * rebuild intent for its own authority's payload and reloads. The resolve that follows removes the container and builds
 * it again; nothing here touches Docker.
 */

import type {Logger} from 'lib-log';
import {type RebuildOptions, storeRebuildIntent} from './rebuild-intent.ts';
import type {IntentMemento} from '../state/timed-store.ts';

/** The prefix of a dev-container window's remote authority. */
const AUTHORITY_PREFIX = 'dev-container+';

/** What the commands read of the window and what they write. */
export interface RebuildPorts {
  window: {
    remoteName(): string | undefined;
    remoteAuthority(): string | undefined;
    reload(): PromiseLike<unknown>;
  };
  intents: IntentMemento;
  now(): number;
  logger: Logger;
}

/** The text of an error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The handler of a rebuild command over `ports`. A call made while another runs returns at once. */
export function rebuildContainer(
  ports: RebuildPorts,
  options: RebuildOptions,
): () => Promise<void> {
  const {window, logger} = ports;
  let running = false;

  async function rebuild(): Promise<void> {
    const authority = window.remoteAuthority();
    if (
      window.remoteName() !== 'dev-container' ||
      authority?.startsWith(AUTHORITY_PREFIX) !== true
    ) {
      logger.info('Rebuild Container does nothing in this window');
      return;
    }
    try {
      await storeRebuildIntent(
        ports.intents,
        authority.slice(AUTHORITY_PREFIX.length),
        options,
        ports.now(),
      );
    } catch (error) {
      logger.warn(
        `the rebuild intent could not be stored: ${messageOf(error)}`,
      );
      return;
    }
    logger.info(
      `rebuilding the dev container (no cache: ${String(options.buildNoCache)})`,
    );
    await window.reload();
  }

  return async () => {
    if (running) {
      logger.info('Rebuild Container is already running');
      return;
    }
    running = true;
    try {
      await rebuild();
    } finally {
      running = false;
    }
  };
}
