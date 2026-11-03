/**
 * @fileoverview The engine watch (C2): it tells a listener when the effective engine of a local window has changed
 * because the Docker CLI's configuration did, for example by `docker context use`. The files are only a trigger: the
 * engine is read again through the CLI, never by parsing them. It runs only while it has a listener.
 */

import path from 'node:path';
import type {Logger} from 'lib-log';

/** How long a burst of triggers settles before the engine is read. */
const SETTLE_MILLISECONDS = 250;

/** How often the configuration is looked at when its folders can't be watched. */
const POLL_MILLISECONDS = 2000;

/** What the watch needs from the machine. */
export interface EngineWatchPorts {
  /** The Docker CLI's configuration folder: the editor's own `DOCKER_CONFIG`, else `<home>/.docker`. */
  configFolder(): string;
  /**
   * Watches a folder, recursively when asked; undefined when it can't be watched. The listener gets the changed
   * entry's name when known.
   */
  watchFolder(
    folder: string,
    recursive: boolean,
    listener: (name: string | undefined) => void,
  ): {dispose(): void} | undefined;
  /** A signature of a path for the poll: its size and modification time, or `missing`. */
  signature(file: string): Promise<string>;
  /** The key of the effective engine now (see `engineKeyOf`); undefined when it can't be read. */
  engineKey(): Promise<string | undefined>;
  /** Calls back once after the delay; gives the way to cancel it. */
  setTimer(milliseconds: number, callback: () => void): () => void;
  logger: Logger;
}

/** The watch of the effective engine. */
export interface EngineWatch {
  /** Calls the listener when the effective engine changed; gives the way to stop. */
  onEngineChange(listener: () => void): {dispose(): void};
}

/** What one run of the watch holds. */
interface Run {
  /** The key the last change was told for; undefined until the first read gives one. */
  baseline: string | undefined;
  reading: boolean;
  again: boolean;
  stops: Array<() => void>;
  stopSettling: () => void;
  stopPolling: () => void;
}

/** The engine watch over `ports`. */
export function engineWatchOf(ports: EngineWatchPorts): EngineWatch {
  const listeners = new Set<() => void>();
  let active: Run | undefined;

  /** Whether a trigger came while the key was being read. */
  function askedAgain(current: Run): boolean {
    return current.again;
  }

  function isActive(candidate: Run): boolean {
    return active === candidate;
  }

  /** Reads the key, once more for every trigger that came during a read, and tells the listeners of a change. */
  async function read(current: Run): Promise<void> {
    if (current.reading) {
      current.again = true;
      return;
    }
    current.reading = true;
    do {
      current.again = false;
      const key = await ports.engineKey();
      if (!isActive(current)) {
        return;
      }
      if (key !== undefined && key !== current.baseline) {
        const first = current.baseline === undefined;
        current.baseline = key;
        if (!first) {
          ports.logger.info(`the Docker engine changed: ${key}`);
          for (const listener of [...listeners]) {
            listener();
          }
        }
      }
    } while (askedAgain(current));
    current.reading = false;
  }

  function trigger(current: Run): void {
    current.stopSettling();
    current.stopSettling = ports.setTimer(SETTLE_MILLISECONDS, () => {
      void read(current);
    });
  }

  /** Looks at the signatures every 2 s, and triggers when they differ from the last look. */
  function poll(current: Run, folder: string): void {
    const files = [
      path.join(folder, 'config.json'),
      path.join(folder, 'contexts', 'meta'),
    ];
    async function look(): Promise<string> {
      return (await Promise.all(files.map(file => ports.signature(file)))).join(
        '|',
      );
    }
    let last: string | undefined;
    function armPoll(): void {
      current.stopPolling = ports.setTimer(POLL_MILLISECONDS, () => {
        void look().then(now => {
          if (!isActive(current)) {
            return;
          }
          if (last !== undefined && now !== last) {
            trigger(current);
          }
          last = now;
          armPoll();
        });
      });
    }
    void look().then(now => {
      if (isActive(current)) {
        last = now;
        armPoll();
      }
    });
  }

  async function start(): Promise<void> {
    const current: Run = {
      baseline: undefined,
      reading: false,
      again: false,
      stops: [],
      stopSettling: () => undefined,
      stopPolling: () => undefined,
    };
    active = current;
    const baseline = await ports.engineKey();
    if (!isActive(current)) {
      return;
    }
    current.baseline = baseline;
    if (baseline === 'noContexts') {
      return;
    }
    const folder = ports.configFolder();
    const watches = [
      ports.watchFolder(folder, false, name => {
        if (name === undefined || name === 'config.json') {
          trigger(current);
        }
      }),
      ports.watchFolder(path.join(folder, 'contexts'), true, () => {
        trigger(current);
      }),
    ];
    for (const watch of watches) {
      if (watch !== undefined) {
        current.stops.push(() => {
          watch.dispose();
        });
      }
    }
    if (watches.includes(undefined)) {
      ports.logger.info(
        "the Docker configuration can't be watched; checking it every 2 s",
      );
      poll(current, folder);
    }
  }

  function stop(): void {
    const ending = active;
    active = undefined;
    ending?.stopSettling();
    ending?.stopPolling();
    for (const end of ending?.stops ?? []) {
      end();
    }
  }

  return {
    onEngineChange(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        void start();
      }
      return {
        dispose() {
          listeners.delete(listener);
          if (listeners.size === 0) {
            stop();
          }
        },
      };
    },
  };
}
