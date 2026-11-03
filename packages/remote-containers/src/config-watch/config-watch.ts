/**
 * @fileoverview The rebuild prompt: while a window holds a connection to a dev container, a change to the
 * configuration it was built from is told to the user once, with the choice to rebuild or to leave the container as
 * it is. The configuration is watched live; the Dockerfile it names is compared once per activation.
 */

import path from 'node:path';
import type {Logger} from 'lib-log';
import {
  decodeConfiguration,
  parseConfiguration,
} from '../config/configuration-text.ts';
import type {IntentMemento} from '../state/timed-store.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import {readAcknowledgment, writeAcknowledgment} from './acknowledgment.ts';
import {bytesFingerprint, configurationFingerprint} from './fingerprint.ts';
import {watchedFilesOf} from './watched-files.ts';

/** The English templates of the notification, by their string ids. */
export const CONFIG_WATCH_TEMPLATES = {
  S083: 'Configuration file(s) changed: {0}. The container might need to be rebuilt to apply the changes.',
  Rebuild: 'Rebuild',
  S201: 'Ignore',
} as const;

/** How long a change to the configuration settles before it is evaluated. */
const SETTLE_MILLISECONDS = 500;

/** How often the configuration is read when its folder cannot be watched. */
const POLL_MILLISECONDS = 2000;

/** Everything the watch needs from the editor and the machine. */
export interface ConfigWatchPorts {
  /** The file's bytes; undefined when it is missing or can't be read. */
  readFile(file: string): Promise<Uint8Array | undefined>;
  /** Watches a folder; undefined when it can't be watched. The listener gets the changed entry's name when known. */
  watchFolder(
    folder: string,
    listener: (name: string | undefined) => void,
    failed: () => void,
  ): {dispose(): void} | undefined;
  /** Calls back once after the delay; gives the way to cancel it. */
  setTimer(callback: () => void, milliseconds: number): () => void;
  state: IntentMemento;
  show(
    message: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  rebuild(): PromiseLike<unknown>;
  translate: Translate;
  logger: Logger;
}

/** The watch of a window's configuration. */
export interface ConfigWatch {
  /** A connection the window now holds: an activation (initial connect, reload or reconnect). */
  activate(connection: {
    configFile: string;
    created: boolean;
    /** Whether the container was not running before this connect: a restart seeds the acknowledgment like a creation. */
    started: boolean;
    serviceDockerfile?: string;
  }): Promise<void>;
  /** The window holds no connection: no evaluation runs until the next activate. */
  pause(): void;
  dispose(): void;
}

/** What one activation keeps. */
interface Session {
  configFile: string;
  /** The Dockerfile the primary service of a Compose configuration builds from. */
  serviceDockerfile: string | undefined;
  /** The combinations of files already told in this activation. */
  shown: Set<string>;
  /** The fingerprints of the Dockerfiles, taken once per activation. */
  dockerfiles: Map<string, string>;
  /** The configuration's fingerprint at the last poll, or `missing`. */
  polled: string | undefined;
  stopWatching: () => void;
  stopPolling: () => void;
  stopSettling: () => void;
}

/** The files of a configuration that exist, with their fingerprints. */
type Current = ReadonlyMap<string, string>;

/** The watch over `ports`, paused until the window holds a connection. */
export function configWatchOf(ports: ConfigWatchPorts): ConfigWatch {
  const {logger, state, translate} = ports;
  let queue: Promise<void> = Promise.resolve();
  let session: Session | undefined;
  let polledOnce = false;

  /** Runs `task` after everything queued before it, so that evaluations and writes never overlap. */
  function enqueue(task: () => Promise<void>): Promise<void> {
    queue = queue.then(task).catch((error: unknown) => {
      logger.warn(
        `the configuration watch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    return queue;
  }

  function end(ending: Session | undefined): void {
    ending?.stopWatching();
    ending?.stopPolling();
    ending?.stopSettling();
  }

  /** The watched files of the configuration read now, and the fingerprints of those that exist. */
  async function currentOf(
    active: Session,
    bytes: Uint8Array,
    fresh: boolean,
  ): Promise<{watched: ReadonlyMap<string, string>; current: Current}> {
    const watched = watchedFilesOf(
      parseConfiguration(decodeConfiguration(bytes)),
      active.configFile,
      active.serviceDockerfile,
    );
    const current = new Map<string, string>();
    for (const [identifier, file] of watched) {
      if (file === active.configFile) {
        current.set(identifier, configurationFingerprint(bytes));
        continue;
      }
      const kept = fresh ? undefined : active.dockerfiles.get(identifier);
      if (kept !== undefined) {
        current.set(identifier, kept);
        continue;
      }
      const dockerfile = await ports.readFile(file);
      if (dockerfile !== undefined) {
        const hash = bytesFingerprint(dockerfile);
        active.dockerfiles.set(identifier, hash);
        current.set(identifier, hash);
      }
    }
    return {watched, current};
  }

  /** Tells the user which files diverged, once per combination in this activation. */
  function evaluate(
    active: Session,
    watched: ReadonlyMap<string, string>,
    current: Current,
  ): void {
    const stored = readAcknowledgment(state) ?? new Map<string, string>();
    const diverged = [
      ...[...current].filter(([name, hash]) => stored.get(name) !== hash),
      ...[...stored].filter(([name]) => !watched.has(name)),
    ]
      .map(([name]) => name)
      .sort();
    if (diverged.length === 0) {
      return;
    }
    const names = diverged.join(', ');
    if (active.shown.has(names)) {
      return;
    }
    active.shown.add(names);
    const hashes = new Map(
      diverged.flatMap(name => {
        const hash = current.get(name);
        return hash === undefined ? [] : [[name, hash] as const];
      }),
    );
    const rebuild = filled(translate, CONFIG_WATCH_TEMPLATES.Rebuild);
    const ignore = filled(translate, CONFIG_WATCH_TEMPLATES.S201);
    logger.info(`the configuration changed: ${names}`);
    void Promise.resolve(
      ports.show(filled(translate, CONFIG_WATCH_TEMPLATES.S083, [names]), [
        rebuild,
        ignore,
      ]),
    ).then(
      answer => {
        answered(
          active,
          names,
          diverged,
          hashes,
          answer === rebuild,
          answer === ignore,
        );
      },
      () => undefined,
    );
  }

  /** What the user's answer to a notification does. */
  function answered(
    active: Session,
    names: string,
    diverged: readonly string[],
    hashes: ReadonlyMap<string, string>,
    rebuild: boolean,
    ignore: boolean,
  ): void {
    if (!rebuild && !ignore) {
      return;
    }
    active.shown.delete(names);
    if (rebuild) {
      Promise.resolve(ports.rebuild()).catch((error: unknown) => {
        logger.warn(
          `the rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
      return;
    }
    void enqueue(async () => {
      const stored = new Map(readAcknowledgment(state) ?? []);
      for (const name of diverged) {
        const hash = hashes.get(name);
        if (hash === undefined) {
          stored.delete(name);
        } else {
          stored.set(name, hash);
        }
      }
      await writeAcknowledgment(state, stored);
      logger.info(`acknowledged ${names}`);
    });
  }

  /** An evaluation from the live watch or the poll. */
  async function liveEvaluation(active: Session): Promise<void> {
    if (session !== active) {
      return;
    }
    const bytes = await ports.readFile(active.configFile);
    if (bytes === undefined || session !== active) {
      return;
    }
    const {watched, current} = await currentOf(active, bytes, false);
    if (session === active) {
      evaluate(active, watched, current);
    }
  }

  function startPolling(active: Session): void {
    if (!polledOnce) {
      polledOnce = true;
      logger.info(
        "the configuration's folder can't be watched; checking it every 2 s",
      );
    }
    function armPoll(): void {
      active.stopPolling = ports.setTimer(() => {
        void enqueue(async () => {
          if (session !== active) {
            return;
          }
          const bytes = await ports.readFile(active.configFile);
          const fingerprint =
            bytes === undefined ? 'missing' : configurationFingerprint(bytes);
          const changed = fingerprint !== active.polled;
          active.polled = fingerprint;
          if (session === active) {
            armPoll();
            if (changed) {
              await liveEvaluation(active);
            }
          }
        });
      }, POLL_MILLISECONDS);
    }
    armPoll();
  }

  function startWatching(active: Session): void {
    const name = path.basename(active.configFile);
    function settle(): void {
      active.stopSettling();
      active.stopSettling = ports.setTimer(() => {
        void enqueue(() => liveEvaluation(active));
      }, SETTLE_MILLISECONDS);
    }
    const watcher = ports.watchFolder(
      path.dirname(active.configFile),
      changed => {
        if (changed === undefined || changed === name) {
          settle();
        }
      },
      () => {
        if (session === active) {
          startPolling(active);
        }
      },
    );
    if (watcher === undefined) {
      startPolling(active);
      return;
    }
    active.stopWatching = () => {
      watcher.dispose();
    };
  }

  return {
    activate({configFile, created, started, serviceDockerfile}) {
      end(session);
      const active: Session = {
        configFile,
        serviceDockerfile,
        shown: new Set(),
        dockerfiles: new Map(),
        polled: undefined,
        stopWatching: () => undefined,
        stopPolling: () => undefined,
        stopSettling: () => undefined,
      };
      session = active;
      startWatching(active);
      return enqueue(async () => {
        const bytes = await ports.readFile(configFile);
        if (bytes === undefined || session !== active) {
          active.polled = 'missing';
          return;
        }
        active.polled = configurationFingerprint(bytes);
        const {watched, current} = await currentOf(active, bytes, true);
        if (created || started || readAcknowledgment(state) === undefined) {
          await writeAcknowledgment(state, current);
          logger.info(
            `seeded the acknowledgment of ${String(current.size)} configuration files`,
          );
          return;
        }
        evaluate(active, watched, current);
      });
    },
    pause() {
      end(session);
      session = undefined;
    },
    dispose() {
      end(session);
      session = undefined;
    },
  };
}
