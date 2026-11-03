/**
 * @fileoverview The Switch Container command: in a dev container window, the folder's configurations are listed with the
 * connected one marked, and the pick reloads the same window on another; with no other configuration, or from a window
 * that is not connected, a modal says so and offers Open Folder in Container. Nothing is stored.
 */

import type {LastResolve} from 'lib-authority';
import {devContainerTargetOf} from '../authority/payload.ts';
import {discoverConfigurations} from '../config/discovery.ts';
import {checkedProgramOf} from './engine-program.ts';
import {filled} from '../surfaces/filled.ts';
import {openPathAllowed} from './open-gate.ts';
import {commandBeforeReload} from './pre-reload.ts';
import {reloadIntoContainer} from './reload.ts';
import type {ReopenPorts} from './reopen-ports.ts';

/** The title of the command, which the log names. */
const TITLE = 'Switch Container';

/** The dev container authority's prefix. */
const AUTHORITY_PREFIX = 'dev-container+';

/** The English templates of the dialog, by their string ids. */
const SWITCH_TEMPLATES = {
  S240: 'No other Dev Container configurations found in folder. Did you mean to open another folder in a container?',
  openFolder: 'Open Folder in Container...',
} as const;

/** What the command reads of the window and the editor, beside what Reopen in Container already uses. */
export interface SwitchContainerPorts extends Pick<
  ReopenPorts,
  | 'gate'
  | 'config'
  | 'settings'
  | 'engine'
  | 'dialogs'
  | 'progress'
  | 'clock'
  | 'bridge'
  | 'problematic'
  | 'opener'
  | 'shutdown'
  | 'translate'
  | 'logger'
> {
  window: {
    remoteName(): string | undefined;
    /** The window's `vscode-remote` authority, when it has one. */
    remoteAuthority(): string | undefined;
    folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
    /** Whether the window's workspace is trusted now. */
    isTrusted(): boolean;
    serializedFile: ReopenPorts['window']['serializedFile'];
  };
  /** How this window's last settled resolve ended: a window whose connect failed is not connected. */
  lastResolve(): LastResolve;
  /** A modal information dialog with the detail and the primary button; whether the button was pressed. */
  askToOpenFolder(detail: string, button: string): Promise<boolean>;
  /** Open Folder in Container, which the modal's button goes to. */
  openFolder(): Promise<void>;
  /** Reopen in Container, which a local window with several configurations goes to. */
  reopen(): Promise<void>;
}

/** The handler of the command over `ports`. A call made while another runs returns at once. */
export function switchContainer(
  ports: SwitchContainerPorts,
): () => Promise<void> {
  const {window, logger, translate} = ports;
  let running = false;

  /** Tells that there is no other configuration to switch to, and goes to Open Folder in Container on the button. */
  async function noOther(): Promise<void> {
    const opens = await ports.askToOpenFolder(
      filled(translate, SWITCH_TEMPLATES.S240, []),
      translate(SWITCH_TEMPLATES.openFolder),
    );
    if (opens) {
      await ports.openFolder();
    }
  }

  /** The configurations the folder holds, as many as there are. */
  async function configurationsIn(folder: string): Promise<number> {
    return (
      await discoverConfigurations(
        folder,
        ports.config.files,
        ports.config.compare,
      )
    ).length;
  }

  /** The command in a local window: S240 with at most one configuration, Reopen in Container's flow with several. */
  async function inLocalWindow(): Promise<void> {
    const [only, ...others] = window.folders();
    if (only?.scheme !== 'file' || others.length > 0) {
      logger.info(`${TITLE} does nothing in this window`);
      return;
    }
    if ((await configurationsIn(only.fsPath)) <= 1) {
      await noOther();
      return;
    }
    await ports.reopen();
  }

  /** The command in a dev container window of a folder on this machine. */
  async function inContainerWindow(): Promise<void> {
    if (ports.lastResolve() === 'failed') {
      await noOther();
      return;
    }
    const authority = window.remoteAuthority() ?? '';
    const target = devContainerTargetOf(
      authority.slice(AUTHORITY_PREFIX.length),
    );
    if (!('hostPath' in target)) {
      logger.info(`${TITLE} does nothing in this window`);
      return;
    }
    const folder = target.hostPath;
    if ((await configurationsIn(folder)) <= 1) {
      await noOther();
      return;
    }
    const base = window.isTrusted() ? folder : undefined;
    const dockerFile = await checkedProgramOf(ports, base);
    if (dockerFile === undefined) {
      return;
    }
    const current =
      'configFile' in target
        ? (target.configFile.fsPath ?? target.configFile.path)
        : undefined;
    const {choice, progress} = await commandBeforeReload(
      ports,
      () => Promise.resolve('proceed'),
      folder,
      dockerFile,
      undefined,
      current === undefined
        ? undefined
        : {current, reconnectCurrent: window.folders().length === 0},
    );
    try {
      if (choice.kind !== 'chosen') {
        return;
      }
      await reloadIntoContainer(ports, {
        title: TITLE,
        target: 'current',
        folder,
        dockerFile,
        chosen: choice,
        progress,
      });
    } finally {
      progress.close();
    }
  }

  async function attempt(): Promise<void> {
    if (!(await openPathAllowed(ports.gate, TITLE))) {
      return;
    }
    const remote = window.remoteName();
    if (remote === undefined) {
      await inLocalWindow();
    } else if (remote === 'dev-container') {
      await inContainerWindow();
    } else {
      logger.info(`${TITLE} does nothing in this window`);
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
