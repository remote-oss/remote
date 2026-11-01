/**
 * @fileoverview The Add Dev Container Configuration Files command and the continuation every entry that adds a
 * configuration shares: the wizard runs, then the written configuration opens in a preview editor and the reopen
 * notification of the folder is offered. Opening the folder in a container is the caller's own continuation.
 */

import path from 'node:path';
import type {Logger} from 'lib-log';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import type {NotificationVariant} from '../open/reopen-notification.ts';
import type {WizardOutcome} from './wizard-stages.ts';

/** The English templates of the command's texts, by their string ids. */
const CREATE_FILE_TEMPLATES = {
  S263: 'Open a folder to create the configuration files in first.',
  openFolder: 'Open Folder',
} as const;

/** The title of the command, which the log names. */
const TITLE = 'Add Dev Container Configuration Files';

/** The configuration file among the written paths. */
const CONFIGURATION_PATH = /(^|\/)\.?devcontainer\.json$/;

/** What the continuation needs: the wizard and the two things it shows afterwards. */
export interface ContinuationPorts {
  /** The wizard for a folder. */
  wizard(folder: string): Promise<WizardOutcome>;
  /** Opens the file in a preview editor tab. */
  openPreview(file: string): PromiseLike<unknown>;
  /**
   * Offers to reopen the window's folder in its container, when its configuration is there (a configuration newly written
   * to the store is there by definition); not waited for.
   */
  offerReopen(variant: NotificationVariant): void;
  logger: Logger;
}

/** What the command needs of its surroundings. */
export interface CreateFilePorts extends ContinuationPorts {
  window: {
    folders(): ReadonlyArray<{scheme: string; fsPath: string; path: string}>;
    /** The kind of remote the window is connected to; none for a local window. */
    remoteName(): string | undefined;
  };
  /** A modal with the buttons; gives the one chosen, or nothing for Cancel. */
  showModal(
    message: string,
    buttons: readonly string[],
  ): PromiseLike<string | undefined>;
  /** Runs core's open-folder command. */
  openFolder(): PromiseLike<unknown>;
  translate: Translate;
}

/**
 * Runs the wizard for `folder`; after a write, opens the configuration in a preview editor and offers the reopen
 * notification. Gives the outcome.
 */
export async function addConfiguration(
  ports: ContinuationPorts,
  folder: string,
): Promise<WizardOutcome> {
  const outcome = await ports.wizard(folder);
  ports.logger.info(`${TITLE} ended: ${outcome.kind}`);
  if (outcome.kind === 'openStored') {
    await ports.openPreview(outcome.file);
  }
  if (outcome.kind === 'written') {
    const written = outcome.files.find(file => CONFIGURATION_PATH.test(file));
    if (written !== undefined) {
      await ports.openPreview(path.join(outcome.target, written));
    }
    ports.offerReopen(outcome.place === 'userData' ? 'userData' : 'folder');
  }
  return outcome;
}

/** The handler of the command over `ports`. A call made while another runs returns at once. */
export function createDevContainerFile(
  ports: CreateFilePorts,
): () => Promise<void> {
  let running = false;

  async function attempt(): Promise<void> {
    const folders = ports.window.folders();
    const [only] = folders;
    if (only === undefined) {
      const button = ports.translate(CREATE_FILE_TEMPLATES.openFolder);
      const answer = await ports.showModal(
        ports.translate(CREATE_FILE_TEMPLATES.S263),
        [button],
      );
      if (answer === button) {
        await ports.openFolder();
      }
      return;
    }
    // A dev container window's folder is in the container: the wizard gets its path there.
    const folder =
      only.scheme === 'file'
        ? only.fsPath
        : only.scheme === 'vscode-remote' &&
            ports.window.remoteName() === 'dev-container'
          ? only.path
          : undefined;
    if (folders.length !== 1 || folder === undefined) {
      ports.logger.info(`${TITLE} does nothing in this window`);
      return;
    }
    await addConfiguration(ports, folder);
  }

  return async () => {
    if (running) {
      ports.logger.info(`${TITLE} is already running`);
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
