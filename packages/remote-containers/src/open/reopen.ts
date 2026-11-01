/**
 * @fileoverview The Reopen in Container command and its rebuild variants, for a local window with one folder: it checks the folder's trust and the
 * engine and has a configuration chosen and read, all before the reload, and reloads the same window on a dev-container authority at
 * the folder the container will show. It never creates or starts a container; the resolve does.
 */

import {type Executable, executableOf} from '../engine/executable.ts';
import {openPathAllowed} from './open-gate.ts';
import {chooseOrAuthor} from './author-first.ts';
import type {RebuildOptions} from './rebuild-intent.ts';
import {reloadIntoContainer} from './reload.ts';
import type {ReopenPorts} from './reopen-ports.ts';

/** The title of the command that runs: Reopen in Container, or one of its two rebuild variants. */
function titleOf(rebuild: RebuildOptions | undefined): string {
  if (rebuild === undefined) {
    return 'Reopen in Container';
  }
  return rebuild.buildNoCache
    ? 'Rebuild Without Cache and Reopen in Container'
    : 'Rebuild and Reopen in Container';
}

/**
 * The handlers of the command over `ports`: the one it gives for `rebuild` is that rebuild variant, which leaves the
 * intent for the resolve right before the reload. The handlers share one flag, so a call made while any of them runs
 * returns at once.
 */
export function reopenHandlersOf(
  ports: ReopenPorts,
): (rebuild?: RebuildOptions) => () => Promise<void> {
  const {window, logger} = ports;
  let running = false;

  /** The folder to reopen when this window is a local one with a single `file` folder. */
  function folderToReopen(title: string): string | undefined {
    const folders = window.folders();
    const [only] = folders;
    if (
      window.remoteName() !== undefined ||
      folders.length !== 1 ||
      only?.scheme !== 'file'
    ) {
      logger.info(`${title} does nothing in this window`);
      return undefined;
    }
    return only.fsPath;
  }

  async function attempt(
    title: string,
    rebuild: RebuildOptions | undefined,
  ): Promise<void> {
    if (!(await openPathAllowed(ports.gate, title))) {
      return;
    }
    const folder = folderToReopen(title);
    if (
      folder === undefined ||
      (await ports.ensureTrusted(title)) !== 'trusted'
    ) {
      return;
    }
    // With the folder as base, the setting always names a program.
    const executable = executableOf(
      ports.settings.dockerPath(),
      folder,
    ) as Extract<Executable, {kind: 'spawn'}>;
    const {choice, progress} = await chooseOrAuthor(
      ports,
      (base, dialogs, cancellation) =>
        ports.engine.firstCheck(base, dialogs, cancellation),
      {title, folder, dockerPath: executable.file},
    );
    try {
      if (choice.kind !== 'chosen') {
        return;
      }
      await reloadIntoContainer(ports, {
        title,
        target: 'current',
        folder,
        dockerFile: executable.file,
        chosen: choice,
        progress,
        ...(rebuild === undefined
          ? {}
          : {
              rebuild: {
                options: rebuild,
                intents: ports.intents,
                now: () => ports.now(),
              },
            }),
      });
    } finally {
      progress.close();
    }
  }

  return rebuild => {
    const title = titleOf(rebuild);
    return async () => {
      if (running) {
        logger.info(`${title} is already running`);
        return;
      }
      running = true;
      try {
        await attempt(title, rebuild);
      } finally {
        running = false;
      }
    };
  };
}
