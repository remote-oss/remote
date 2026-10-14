/**
 * @fileoverview Choosing the dev container configuration an open command works on: the configurations of the folder,
 * the picker when there are several, the checks the dev container CLI lacks, and the CLI's own read of the one chosen.
 * Nothing here writes a file.
 */

import type {Logger} from 'lib-log';
import type {CliBridge} from '../cli/cli-bridge.ts';
import type {CliEvent, CliFailure} from '../cli/cli-lines.ts';
import {ENGINE_TEMPLATES, type Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {EngineDialogPort} from '../engine/preflight.ts';
import {
  decodeConfiguration,
  hasContainerSource,
  labelOf,
  parseConfiguration,
} from './configuration-text.ts';
import {
  type Candidate,
  type ConfigFiles,
  discoverConfigurations,
} from './discovery.ts';

/** The English templates of the texts of the picker and its dialogs, by their string ids. */
const CONFIG_TEMPLATES = {
  S303: 'Select a devcontainer.json file.',
  S257: 'Open File',
  S181: "Failed to read Dev Container configuration '{0}' file.",
  S113: "Dev Container configuration '{0}' file is missing image information. You can add this manually or overwrite with a template.",
  S411: 'Workspace folder in devcontainer.json must be an absolute path.',
  S049: 'Cancelled container configuration selection.',
  noConfiguration:
    'No dev container configuration was found in this folder. Add a .devcontainer/devcontainer.json file, then run the command again.',
} as const;

/** One row of the picker. */
interface PickerRow {
  label: string;
  /** The relative path. */
  description: string;
}

/** What the user did with the picker. */
export type PickerAnswer =
  | {kind: 'picked'; index: number}
  | {kind: 'openFile'; index: number}
  | {kind: 'dismissed'};

/** The editor surfaces the choice uses. */
export interface ConfigSurfaces {
  /** Shows the single-select picker: no title, `placeholder`, rows in order with one "Open File" button each. */
  pick(
    rows: readonly PickerRow[],
    placeholder: string,
    openFileTooltip: string,
  ): Promise<PickerAnswer>;
  /** The engine dialogs' modal error and log reveal, reused as they are. */
  dialogs: Pick<EngineDialogPort, 'showError' | 'revealLog'>;
  /** A modal warning with its detail and buttons; undefined when the user cancelled. */
  showWarning(
    message: string,
    detail: string,
    items: readonly string[],
  ): Promise<string | undefined>;
  /** Opens the file in a preview editor tab. */
  openPreview(file: string): Promise<void>;
  /** A non-modal information message with no buttons; not awaited. */
  showInformation(message: string): void;
}

/** Everything choosing needs. */
export interface ConfigurationPorts {
  files: ConfigFiles;
  surfaces: ConfigSurfaces;
  cli: Pick<CliBridge, 'readConfiguration'>;
  compare: (left: string, right: string) => number;
  translate: Translate;
  logger: Logger;
}

/** What an open command asks: the host folder and the engine the CLI is to use. */
export interface ConfigurationRequest {
  /** The host folder, absolute. */
  folder: string;
  /** The Docker executable. */
  dockerPath: string;
  cancellation: AbortSignal;
}

/** How choosing ended. */
export type ConfigurationChoice =
  /** A configuration was chosen and read: the file and the folder to open in the container. */
  | {kind: 'chosen'; configFile: string; workspaceFolder: string}
  /** The folder holds no configuration. */
  | {kind: 'noConfiguration'}
  /** The user ended it: Escape, an empty filter, focus away, "Open File", or a cancelled CLI read. */
  | {kind: 'dismissed'}
  /** A dialog of this module was shown; nothing more is to be shown. */
  | {kind: 'rejected'}
  /** The CLI couldn't read the chosen configuration. */
  | {kind: 'readFailed'; configFile: string; failure: CliFailure};

/** The text of a template with its values, translated. */
function textOf(
  translate: Translate,
  template: string,
  values: readonly string[] = [],
): string {
  return filled(translate, template, values);
}

/** Chooses the configuration of `request.folder`. */
export async function chooseConfiguration(
  request: ConfigurationRequest,
  ports: ConfigurationPorts,
): Promise<ConfigurationChoice> {
  const {files, surfaces, translate, logger} = ports;
  const {folder} = request;
  const showLog = textOf(translate, ENGINE_TEMPLATES.S324);

  /** Shows an error dialog with Show Log, and reveals the log when that is what the user chose. */
  async function refuse(message: string, detail: string): Promise<void> {
    const chosen = await surfaces.dialogs.showError(message, detail, [showLog]);
    if (chosen === showLog) {
      surfaces.dialogs.revealLog();
    }
  }

  /** The candidate the user picks among `candidates`, or why none was. */
  async function picked(
    candidates: readonly Candidate[],
  ): Promise<Candidate | undefined> {
    const rows = await Promise.all(
      candidates.map(async candidate => {
        const bytes = await files.read(candidate.file);
        const parsed =
          bytes === 'unreadable'
            ? undefined
            : parseConfiguration(decodeConfiguration(bytes));
        return {
          label: labelOf(candidate.place, parsed, translate),
          description: candidate.relative,
        };
      }),
    );
    const answer = await surfaces.pick(
      rows,
      textOf(translate, CONFIG_TEMPLATES.S303),
      textOf(translate, CONFIG_TEMPLATES.S257),
    );
    if (answer.kind === 'dismissed') {
      logger.info(textOf(translate, CONFIG_TEMPLATES.S049));
      return undefined;
    }
    const chosen = candidates[answer.index];
    if (answer.kind === 'openFile' && chosen !== undefined) {
      await surfaces.openPreview(chosen.file);
      return undefined;
    }
    return chosen;
  }

  const candidates = await discoverConfigurations(folder, files, ports.compare);
  if (candidates.length === 0) {
    logger.info(`no dev container configuration in ${folder}`);
    surfaces.showInformation(
      textOf(translate, CONFIG_TEMPLATES.noConfiguration),
    );
    return {kind: 'noConfiguration'};
  }
  const candidate =
    candidates.length === 1 ? candidates[0] : await picked(candidates);
  if (candidate === undefined) {
    return {kind: 'dismissed'};
  }
  const bytes = await files.read(candidate.file);
  const parsed =
    bytes === 'unreadable'
      ? undefined
      : parseConfiguration(decodeConfiguration(bytes));
  if (parsed === undefined) {
    const opening = surfaces.openPreview(candidate.file);
    await refuse(
      '',
      textOf(translate, CONFIG_TEMPLATES.S181, [candidate.relative]),
    );
    await opening;
    return {kind: 'rejected'};
  }
  if (!hasContainerSource(parsed)) {
    await surfaces.showWarning(
      '',
      textOf(translate, CONFIG_TEMPLATES.S113, [candidate.relative]),
      [],
    );
    await surfaces.openPreview(candidate.file);
    return {kind: 'rejected'};
  }
  const read = await ports.cli.readConfiguration(
    {
      workspaceFolder: folder,
      configFile: candidate.file,
      dockerPath: request.dockerPath,
      idLabels: [],
      mountWorkspaceGitRoot: true,
      mounts: [],
      logLevel: 'info',
    },
    undefined,
    (event: CliEvent) => {
      logger.debug(event.kind === 'log' ? event.text : event.name);
    },
    request.cancellation,
  );
  if (read.kind === 'cancelled') {
    return {kind: 'dismissed'};
  }
  if (read.kind !== 'configuration') {
    logger.warn(`the configuration could not be read: ${read.kind}`);
    return {kind: 'readFailed', configFile: candidate.file, failure: read};
  }
  if (!read.workspaceFolder.startsWith('/')) {
    await refuse(textOf(translate, CONFIG_TEMPLATES.S411), '');
    return {kind: 'rejected'};
  }
  return {
    kind: 'chosen',
    configFile: candidate.file,
    workspaceFolder: read.workspaceFolder,
  };
}
