/**
 * @fileoverview The row actions that open a dev container folder's window: Open in Container in Current Window and in New
 * Window. They take the folder and the configuration file from the labels of the row's container, run the checks every
 * open command runs with that configuration fixed, and reload the target window on the container's authority. The
 * container is the resolve's to start, and the folder's trust its to ask, once the window has switched.
 */

import type {EngineHost} from '../engine/engine-host.ts';
import {executableOf} from '../engine/executable.ts';
import {configFileOf, localFolderOf} from '../lifecycle/labels.ts';
import {commandBeforeReload} from '../open/pre-reload.ts';
import {reloadIntoContainer} from '../open/reload.ts';
import {openPathAllowed} from '../open/open-gate.ts';
import type {ReopenPorts} from '../open/reopen-ports.ts';
import {inspectArguments, listedContainersOf} from './listed-containers.ts';
import {containerRowOf} from './row-actions.ts';

/** The titles of the two commands, which the log names. */
const CURRENT_TITLE = 'Open in Container in Current Window';
const NEW_TITLE = 'Open in Container in New Window';

/** The configuration files of a folder when the container carries no label naming one, in the order the view looks for them. */
const DEFAULT_CONFIGURATIONS = [
  '.devcontainer/devcontainer.json',
  '.devcontainer.json',
] as const;

/** What the row commands read and call, beside what Reopen in Container already uses. */
export interface RowOpenPorts extends Pick<
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
  | 'logger'
> {
  window: {serializedFile: ReopenPorts['window']['serializedFile']};
  /** The Docker CLI for a program. */
  engineFor(file: string): EngineHost;
  /** Whether a file exists on this machine. */
  exists(file: string): Promise<boolean>;
  cancellation: AbortSignal;
}

/** The two commands, each over the row the editor hands it. */
export interface RowOpen {
  current(argument: unknown): Promise<void>;
  inNewWindow(argument: unknown): Promise<void>;
}

/** The commands over `ports`. */
export function rowOpenOf(ports: RowOpenPorts): RowOpen {
  const {logger} = ports;

  /** The labels of the container `containerId`; none when the engine can't give them. */
  async function labelsOf(
    engine: EngineHost,
    containerId: string,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    const outcome = await engine.run(
      inspectArguments([containerId]),
      {kind: 'none'},
      {cancellation: ports.cancellation},
    );
    return outcome.kind === 'ran' && outcome.status === 0
      ? listedContainersOf(outcome.stdout)?.[0]?.labels
      : undefined;
  }

  /** The configuration the container was made from: the label's, else the folder's own default. */
  async function configOf(
    labels: Readonly<Record<string, string>>,
    folder: string,
  ): Promise<string | undefined> {
    const named = configFileOf(labels);
    if (named !== undefined) {
      return named;
    }
    for (const relative of DEFAULT_CONFIGURATIONS) {
      if (await ports.exists(`${folder}/${relative}`)) {
        return `${folder}/${relative}`;
      }
    }
    return undefined;
  }

  async function open(
    argument: unknown,
    target: 'current' | 'new',
  ): Promise<void> {
    const containerRow = containerRowOf(argument);
    const title = target === 'current' ? CURRENT_TITLE : NEW_TITLE;
    if (containerRow?.viewItem.split(' ').includes('openFolder') !== true) {
      return;
    }
    if (!(await openPathAllowed(ports.gate, title))) {
      return;
    }
    if (
      (await ports.engine.firstCheck(undefined, ports.dialogs)) === 'stopped'
    ) {
      return;
    }
    // A relative value has no base here: it names no program, whatever the check said.
    const executable = executableOf(ports.settings.dockerPath(), undefined);
    if (executable.kind !== 'spawn') {
      logger.info(`${title} found no Docker program`);
      return;
    }
    const labels = await labelsOf(
      ports.engineFor(executable.file),
      containerRow.id,
    );
    const folder = labels === undefined ? undefined : localFolderOf(labels);
    const configFile =
      labels === undefined || folder === undefined
        ? undefined
        : await configOf(labels, folder);
    if (folder === undefined || configFile === undefined) {
      logger.info(`${title} found no folder and configuration in the row`);
      return;
    }
    const {choice, progress} = await commandBeforeReload(
      ports,
      () => Promise.resolve('proceed'),
      folder,
      executable.file,
      configFile,
    );
    try {
      if (choice.kind !== 'chosen') {
        return;
      }
      await reloadIntoContainer(ports, {
        title,
        target,
        folder,
        dockerFile: executable.file,
        chosen: choice,
        progress,
      });
    } finally {
      progress.close();
    }
  }

  return {
    current: argument => open(argument, 'current'),
    inNewWindow: argument => open(argument, 'new'),
  };
}
