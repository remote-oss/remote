/**
 * @fileoverview The Reopen in Container command and its rebuild variants, for a local window with one folder or a saved workspace: it checks
 * the trust and the engine and has a configuration chosen and read, all before the reload, and reloads the same window on a
 * dev-container authority at the folder, or the workspace file, the container will show. It never creates or starts a container; the resolve does.
 */

import {externalSourcesApply} from '../config/external-sources.ts';
import path from 'node:path';
import {type Executable, executableOf} from '../engine/executable.ts';
import {openPathAllowed} from './open-gate.ts';
import {chooseOrAuthor} from './author-first.ts';
import type {RebuildOptions} from './rebuild-intent.ts';
import {invocationGuardOf} from './invocation-guard.ts';
import {reloadIntoContainer} from './reload.ts';
import type {ReopenPorts} from './reopen-ports.ts';
import {workspaceFoldersAccepted} from './workspace-folders.ts';

/** The English text of the modal an unsaved multi-root workspace gets, by its string id. */
const WORKSPACE_TEMPLATES = {
  S415: 'You need to first save your workspace in a folder containing all its workspace folders.',
} as const;

/** What the command reopens: a folder, or a saved workspace by the folder that holds its file and the file's path in it. */
interface Target {
  folder: string;
  /** The `.code-workspace` file's path relative to `folder`, with `/` separators; none for a folder. */
  workspaceFile?: string;
}

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
  const guard = invocationGuardOf(logger);

  /**
   * What to reopen in this window: its one `file` folder; or, in a saved workspace, whatever its roots, the folder of
   * the workspace file and the file in it. An unsaved workspace is told to be saved first, and any other window gets
   * nothing.
   */
  async function targetToReopen(title: string): Promise<Target | undefined> {
    const folders = window.folders();
    const [only] = folders;
    const workspaceFile = window.workspaceFile();
    if (window.remoteName() !== undefined) {
      logger.info(`${title} does nothing in this window`);
      return undefined;
    }
    // A root that is not a local folder (a virtual one) is out of both workspace routes, as it is out of the folder one.
    if (folders.some(folder => folder.scheme !== 'file')) {
      logger.info(`${title} does nothing in this window`);
      return undefined;
    }
    if (workspaceFile?.scheme === 'file') {
      const folder = path.dirname(workspaceFile.fsPath);
      return {
        folder,
        workspaceFile: path
          .relative(folder, workspaceFile.fsPath)
          .split(path.sep)
          .join('/'),
      };
    }
    if (workspaceFile?.scheme === 'untitled') {
      await ports.informModal(ports.translate(WORKSPACE_TEMPLATES.S415));
      return undefined;
    }
    if (
      workspaceFile === undefined &&
      folders.length === 1 &&
      only?.scheme === 'file'
    ) {
      return {folder: only.fsPath};
    }
    logger.info(`${title} does nothing in this window`);
    return undefined;
  }

  async function attempt(
    title: string,
    rebuild: RebuildOptions | undefined,
    pass: () => boolean,
  ): Promise<void> {
    if (!(await openPathAllowed(ports.gate, title))) {
      return;
    }
    const target = await targetToReopen(title);
    if (
      target === undefined ||
      (await ports.ensureTrusted(title)) !== 'trusted'
    ) {
      return;
    }
    const {folder} = target;
    if (
      target.workspaceFile !== undefined &&
      !(await workspaceFoldersAccepted(
        ports,
        path.join(folder, target.workspaceFile),
      ))
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
      async (base, dialogs, cancellation) => {
        const checked = await ports.engine.firstCheck(
          base,
          dialogs,
          cancellation,
        );
        return checked === 'proceed' && !pass() ? 'stopped' : checked;
      },
      {
        title,
        folder,
        dockerPath: executable.file,
        external: externalSourcesApply(window.folders().length),
      },
    );
    try {
      if (choice.kind !== 'chosen') {
        return;
      }
      await reloadIntoContainer(ports, {
        title,
        target: 'current',
        folder,
        ...(target.workspaceFile === undefined
          ? {}
          : {workspaceFile: target.workspaceFile}),
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
    return () => guard.run(title, pass => attempt(title, rebuild, pass));
  };
}
