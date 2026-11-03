/**
 * @fileoverview Where "Add Files..." of the Configure Container Features command goes: the wizard that adds
 * configuration files, for the folder the window has. A saved workspace is checked as Reopen in Container checks it, an
 * unsaved one is told to be saved, and a window of an SSH, WSL or tunnel host adds the files on that host, with no
 * choice of location.
 */

import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {
  workspaceFoldersAccepted,
  type WorkspaceFolderPorts,
} from '../open/workspace-folders.ts';
import {savedWorkspaceOf} from './create-file.ts';
import type {WindowFolder} from './configure-features.ts';

/** The English text of the dialog for a workspace that is not saved, by its string id. */
const ADD_FILES_TEMPLATES = {
  S415: 'You need to first save your workspace in a folder containing all its workspace folders.',
} as const;

/** The remote windows whose folders are on the host and whose files are added there. */
const HOST_REMOTES = ['ssh-remote', 'wsl', 'tunnel'] as const;

/** What the hand-off needs of its surroundings. */
export interface FeaturesAddFilesPorts extends WorkspaceFolderPorts {
  window: {
    folders(): readonly WindowFolder[];
    remoteName(): string | undefined;
    workspaceFile(): {scheme: string; fsPath: string} | undefined;
  };
  /** A modal information dialog with the detail `text`. */
  informModal(text: string): PromiseLike<unknown>;
  /** The wizard for a folder of this machine or of a dev container, as Add Dev Container Configuration Files runs it. */
  addConfiguration(
    folder: string,
    roots: readonly string[],
  ): PromiseLike<unknown>;
  /** The wizard for a folder on the host of an SSH, WSL or tunnel window: its files, and no choice of location. */
  addHostConfiguration(folder: string): PromiseLike<unknown>;
  translate: Translate;
  logger: Logger;
}

/** Runs the wizard that adds configuration files for the window's folder; what it does is its outcome. */
export async function addFilesForFeatures(
  ports: FeaturesAddFilesPorts,
): Promise<void> {
  const {window, logger} = ports;
  const folders = window.folders();
  const [only] = folders;
  const remote = window.remoteName();
  if (
    remote !== undefined &&
    (HOST_REMOTES as readonly string[]).includes(remote)
  ) {
    if (folders.length === 1 && only?.scheme === 'vscode-remote') {
      await ports.addHostConfiguration(only.path);
      return;
    }
    logger.info('Add Files... does nothing in this window');
    return;
  }
  const workspaceFile = window.workspaceFile();
  if (workspaceFile?.scheme === 'untitled' && folders.length > 1) {
    await ports.informModal(ports.translate(ADD_FILES_TEMPLATES.S415));
    return;
  }
  const saved = savedWorkspaceOf(folders, workspaceFile);
  if (saved !== undefined) {
    if (await workspaceFoldersAccepted(ports, saved.file)) {
      await ports.addConfiguration(saved.folder, saved.roots);
    }
    return;
  }
  if (folders.length === 1 && only !== undefined) {
    const folder =
      only.scheme === 'file'
        ? only.fsPath
        : only.scheme === 'vscode-remote' && remote === 'dev-container'
          ? only.path
          : undefined;
    if (folder !== undefined) {
      await ports.addConfiguration(folder, []);
      return;
    }
  }
  logger.info('Add Files... does nothing in this window');
}
