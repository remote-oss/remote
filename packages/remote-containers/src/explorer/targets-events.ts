/**
 * @fileoverview The stream of Docker's container events that keeps the Dev Containers view current: one `docker
 * events` process while the view is visible, and one rebuild after a quiet moment, however many events came.
 */

import type {Logger} from 'lib-log';
import type {EngineHost, EngineProcess} from '../engine/engine-host.ts';
import {lineSplitter} from '../line-splitter.ts';

/** The arguments of the events process: Docker's own filter picks the events; their content is not matched. */
export const EVENTS_ARGUMENTS: readonly string[] = [
  'events',
  '--filter',
  'type=container',
  '--format',
  '{{json .}}',
];

/** How long the events are quiet before the view rebuilds, in milliseconds. */
export const EVENT_QUIET_MILLISECONDS = 300;

/** What the watcher needs. */
export interface ContainerEventsPorts {
  /** The engine to watch now; none when no program is named. */
  engine(): EngineHost | undefined;
  /** Rebuilds the view. */
  rebuild(): Promise<unknown>;
  /** Calls `callback` after `milliseconds`; the result stops the wait. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  logger: Logger;
}

/** The watcher of the events. */
export interface ContainerEvents {
  /** Starts the events process unless one runs; a process that ended is started again. */
  start(): void;
  /** Ends the process and drops a rebuild that is waiting for the events to be quiet. */
  stop(): void;
}

/** The watcher over `ports`. A process that ends is not started again until `start` is called. */
export function watchContainerEvents(
  ports: ContainerEventsPorts,
): ContainerEvents {
  const {logger} = ports;
  let running: AbortController | undefined;
  let cancelQuiet: (() => void) | undefined;
  let rebuilding = false;
  let again = false;

  async function rebuildOnce(): Promise<void> {
    rebuilding = true;
    try {
      await ports.rebuild();
    } catch (caught) {
      logger.error(
        `the Dev Containers view could not be rebuilt: ${caught instanceof Error ? caught.message : String(caught)}`,
      );
    }
    rebuilding = false;
    if (again) {
      again = false;
      await rebuildOnce();
    }
  }

  function quiet(): void {
    cancelQuiet = undefined;
    if (rebuilding) {
      again = true;
      return;
    }
    void rebuildOnce();
  }

  function eventSeen(line: string): void {
    try {
      JSON.parse(line);
    } catch {
      return;
    }
    cancelQuiet?.();
    cancelQuiet = ports.setTimer(EVENT_QUIET_MILLISECONDS, quiet);
  }

  function read(process: EngineProcess, own: AbortController): void {
    const splitter = lineSplitter(eventSeen);
    process.stdout.on('data', (chunk: Buffer) => {
      splitter.push(chunk);
    });
    void process.exited.then(status => {
      splitter.flush();
      if (running === own) {
        running = undefined;
        logger.info(
          `the Docker events process ended (${status === undefined ? 'signal' : String(status)})`,
        );
      }
    });
  }

  async function launch(
    own: AbortController,
    engine: EngineHost,
  ): Promise<void> {
    const spawned = await engine.spawn(EVENTS_ARGUMENTS, {
      cancellation: own.signal,
    });
    if (spawned.kind === 'failed') {
      if (running === own) {
        running = undefined;
      }
      logger.info(`the Docker events process did not start: ${spawned.detail}`);
      return;
    }
    read(spawned.process, own);
  }

  return {
    start: () => {
      const engine = ports.engine();
      if (running !== undefined || engine === undefined) {
        return;
      }
      const own = new AbortController();
      running = own;
      launch(own, engine).catch((caught: unknown) => {
        if (running === own) {
          running = undefined;
        }
        logger.error(
          `the Docker events process could not be started: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      });
    },
    stop: () => {
      running?.abort();
      running = undefined;
      cancelQuiet?.();
      cancelQuiet = undefined;
      again = false;
    },
  };
}
