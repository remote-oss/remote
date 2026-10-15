/**
 * @fileoverview The Reopen in Container command for a local window with one folder: it checks the folder's trust and the
 * engine and has a configuration chosen and read, all before the reload, and reloads the same window on a dev-container authority at
 * the folder the container will show. It never creates or starts a container; the resolve does.
 */

import {encodeAuthority, openRemote} from 'lib-authority';
import {devContainerPayloadOf} from '../authority/payload.ts';
import {type Executable, executableOf} from '../engine/executable.ts';
import {mountGitWorktreeCommonDirOf} from '../connect/mount-settings.ts';
import {beforeReload} from './pre-reload.ts';
import type {ReopenPorts} from './reopen-ports.ts';

/** The handler of the command over `ports`. A call made while another runs returns at once. */
export function reopenInContainer(ports: ReopenPorts): () => Promise<void> {
  const {window, logger} = ports;
  let running = false;

  /** The folder to reopen when this window is a local one with a single `file` folder. */
  function folderToReopen(): string | undefined {
    const folders = window.folders();
    const [only] = folders;
    if (
      window.remoteName() !== undefined ||
      folders.length !== 1 ||
      only?.scheme !== 'file'
    ) {
      logger.info('Reopen in Container does nothing in this window');
      return undefined;
    }
    return only.fsPath;
  }

  async function attempt(): Promise<void> {
    const folder = folderToReopen();
    if (folder === undefined || (await ports.ensureTrusted()) !== 'trusted') {
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
        logger.info(`Reopen in Container found no configuration in ${folder}`);
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
        logger.warn(`Reopen in Container was refused: ${opened.reason}`);
      }
    } finally {
      progress.close();
    }
  }

  return async () => {
    if (running) {
      logger.info('Reopen in Container is already running');
      return;
    }
    running = true;
    try {
      await attempt();
    } finally {
      running = false;
    }
  };
}
