/**
 * @fileoverview The Open Folder in Container command, Flow B: it checks the engine, asks core's folder dialog, has the
 * folder's configuration chosen and read, and reloads the same window on that folder's dev container. The folder's
 * trust is asked by the resolve that follows, after the window has switched.
 */

import {devContainerTargetOf} from '../authority/payload.ts';
import {type Executable, executableOf} from '../engine/executable.ts';
import {openPathAllowed} from './open-gate.ts';
import {chooseOrAuthor} from './author-first.ts';
import {reloadIntoContainer} from './reload.ts';
import type {ReopenPorts} from './reopen-ports.ts';

/** The title of the command, which the log names. */
const TITLE = 'Open Folder in Container';

/** The dev container authority's prefix. */
const AUTHORITY_PREFIX = 'dev-container+';

/** What the command reads of the window and the editor, beside what Reopen in Container already uses. */
export interface OpenFolderPorts extends Pick<
  ReopenPorts,
  | 'gate'
  | 'config'
  | 'settings'
  | 'engine'
  | 'dialogs'
  | 'progress'
  | 'bridge'
  | 'opener'
  | 'authoring'
  | 'shutdown'
  | 'logger'
> {
  window: {
    remoteName(): string | undefined;
    /** The window's `vscode-remote` authority, when it has one. */
    remoteAuthority(): string | undefined;
    folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
    homeFolder(): string;
    /** Whether the window's workspace is trusted now. */
    isTrusted(): boolean;
    serializedFile: ReopenPorts['window']['serializedFile'];
  };
  /** Core's folder dialog: folders only, one, opened at `start`. */
  pickFolder(
    start: string,
  ): Promise<{scheme: string; fsPath: string} | undefined>;
}

/** The handler of the command over `ports`. A call made while another runs returns at once. */
export function openFolderInContainer(
  ports: OpenFolderPorts,
): () => Promise<void> {
  const {window, logger} = ports;
  let running = false;

  /** The local folder the window shows: a container window's host folder, or a local window's only folder. */
  function ownFolder(): string | undefined {
    if (window.remoteName() === 'dev-container') {
      const authority = window.remoteAuthority() ?? '';
      const target = devContainerTargetOf(
        authority.slice(AUTHORITY_PREFIX.length),
      );
      return 'hostPath' in target ? target.hostPath : undefined;
    }
    const [only, ...others] = window.folders();
    return window.remoteName() === undefined &&
      only?.scheme === 'file' &&
      others.length === 0
      ? only.fsPath
      : undefined;
  }

  async function attempt(): Promise<void> {
    if (!(await openPathAllowed(ports.gate, TITLE))) {
      return;
    }
    const own = ownFolder();
    // A relative value is the window's own folder's file, which runs only once that folder is trusted.
    const base = window.isTrusted() ? own : undefined;
    if ((await ports.engine.firstCheck(base, ports.dialogs)) === 'stopped') {
      return;
    }
    // The passed check means the setting names a program, with the window's folder as base or none.
    const executable = executableOf(
      ports.settings.dockerPath(),
      base,
    ) as Extract<Executable, {kind: 'spawn'}>;
    const picked = await ports.pickFolder(own ?? window.homeFolder());
    if (picked === undefined) {
      logger.info(`${TITLE} was cancelled`);
      return;
    }
    if (picked.scheme !== 'file') {
      logger.info(`${TITLE} needs a local folder`);
      return;
    }
    if (picked.fsPath === own && window.remoteName() === 'dev-container') {
      logger.info('the folder is already open in this container');
      return;
    }
    const folder = picked.fsPath;
    const {choice, progress} = await chooseOrAuthor(
      ports,
      () => Promise.resolve('proceed'),
      {title: TITLE, folder, dockerPath: executable.file},
    );
    try {
      if (choice.kind !== 'chosen') {
        return;
      }
      await reloadIntoContainer(ports, {
        title: TITLE,
        folder,
        dockerFile: executable.file,
        chosen: choice,
        progress,
      });
    } finally {
      progress.close();
    }
  }

  return async () => {
    if (running) {
      logger.info(`${TITLE} is already running`);
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
