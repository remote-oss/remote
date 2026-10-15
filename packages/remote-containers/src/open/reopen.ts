/**
 * @fileoverview The Reopen in Container command and its rebuild variants, for a local window with one folder: it checks the folder's trust and the
 * engine and has a configuration chosen and read, all before the reload, and reloads the same window on a dev-container authority at
 * the folder the container will show. It never creates or starts a container; the resolve does.
 */

import {encodeAuthority, openRemote} from 'lib-authority';
import {devContainerPayloadOf} from '../authority/payload.ts';
import {type Executable, executableOf} from '../engine/executable.ts';
import {mountGitWorktreeCommonDirOf} from '../connect/mount-settings.ts';
import {openPathAllowed} from './open-gate.ts';
import {beforeReload} from './pre-reload.ts';
import {type RebuildOptions, storeRebuildIntent} from './rebuild-intent.ts';
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
    const {choice, progress} = await beforeReload(
      {
        firstCheck: (base, dialogs) => ports.engine.firstCheck(base, dialogs),
        dialogs: ports.dialogs,
        // eslint-disable-next-line id-length -- the choice's dependency is named cli
        config: {...ports.config, cli: ports.bridge, logger},
        progress: ports.progress,
      },
      {
        folder,
        dockerPath: executable.file,
        mountGitWorktreeCommonDir: mountGitWorktreeCommonDirOf(
          ports.settings.mountGitWorktreeCommonDir(),
        ),
        cancellation: new AbortController().signal,
      },
    );
    try {
      if (choice.kind === 'noConfiguration') {
        logger.info(`${title} found no configuration in ${folder}`);
        return;
      }
      if (choice.kind !== 'chosen') {
        return;
      }
      const context = await ports.engine.currentContext(executable.file);
      const payload = devContainerPayloadOf({
        kind: 'folder',
        hostPath: folder,
        localDocker: false,
        ...(context === undefined ? {} : {context}),
        configFile: window.serializedFile(choice.configFile),
      });
      if (rebuild !== undefined) {
        try {
          await storeRebuildIntent(
            ports.intents,
            payload,
            rebuild,
            ports.now(),
          );
        } catch (error) {
          logger.warn(
            `the rebuild intent could not be stored: ${error instanceof Error ? error.message : String(error)}`,
          );
          return;
        }
      }
      progress.close();
      const opened = await openRemote(
        ports.opener,
        encodeAuthority({
          family: 'dev-container',
          target: {payload},
          rawHostString: payload,
        }),
        {path: choice.workspaceFolder, pathKind: 'folder', target: 'current'},
      );
      if (opened.kind === 'rejected') {
        logger.warn(`${title} was refused: ${opened.reason}`);
      }
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
