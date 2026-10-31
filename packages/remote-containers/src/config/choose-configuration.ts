/**
 * @fileoverview Choosing the dev container configuration an open command works on: the configurations of the folder,
 * the picker when there are several, the checks the dev container CLI lacks, and the CLI's own read of the one chosen.
 * Nothing here writes a file.
 */

import path from 'node:path';
import type {Logger} from 'lib-log';
import type {FeatureSettings} from '../cli/cli-arguments.ts';
import type {CliBridge} from '../cli/cli-bridge.ts';
import {
  type CliEvent,
  type CliFailure,
  cliFailureText,
  type ConfigurationResult,
} from '../cli/cli-lines.ts';
import {requestedFeaturesOf} from '../cli/failing-feature.ts';
import {ENGINE_TEMPLATES, type Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {EngineDialogPort, FirstCheckResult} from '../engine/preflight.ts';
import {
  decodeConfiguration,
  dockerfileOf,
  hasContainerSource,
  labelOf,
  parseConfiguration,
} from './configuration-text.ts';
import {
  type Candidate,
  type ConfigFiles,
  discoverConfigurations,
} from './discovery.ts';
import {byAbsolutePath} from './stored-candidate.ts';

/** The English templates of the texts of the picker and its dialogs, by their string ids. */
const CONFIG_TEMPLATES = {
  S303: 'Select a devcontainer.json file.',
  S257: 'Open File',
  S181: "Failed to read Dev Container configuration '{0}' file.",
  S113: "Dev Container configuration '{0}' file is missing image information. You can add this manually or overwrite with a template.",
  S411: 'Workspace folder in devcontainer.json must be an absolute path.',
  S049: 'Cancelled container configuration selection.',
  S004: '"{0}" does not exist.',
  openConfiguration: 'Open {0}',
  useTemplate: 'Use Template',
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
}

/** Everything choosing needs. */
export interface ConfigurationPorts {
  files: ConfigFiles;
  surfaces: ConfigSurfaces;
  cli: Pick<CliBridge, 'readConfiguration'>;
  compare: (left: string, right: string) => number;
  /** The configuration of the folder in the store of user data, when it has one; asked where the folder's own are. */
  stored?(folder: string): Promise<Candidate | undefined>;
  /** Adds a configuration to the folder with the wizard, and shows what the command that adds one shows after it. */
  useTemplate(folder: string): PromiseLike<unknown>;
  translate: Translate;
  logger: Logger;
}

/** What an open command asks: the host folder and the engine the CLI is to use. */
export interface ConfigurationRequest {
  /** The host folder, absolute. */
  folder: string;
  /** The Docker executable. */
  dockerPath: string;
  /** Whether the Git worktree's common dir is mounted, which moves the folder the window opens at (BR-12). */
  mountGitWorktreeCommonDir: boolean;
  /** The Feature settings, which the CLI's read of the configuration takes. */
  features: FeatureSettings;
  cancellation: AbortSignal;
  /**
   * A configuration file to use instead of the folder's own, absolute, such as the one a row's container was made from
   * or one newly written to the store of user data: with it nothing is discovered and no picker shows.
   */
  configFile?: string;
  /**
   * C2's first check, already running. Every surface and every answer of `chooseConfiguration` waits for it; when it
   * ends `stopped`, nothing more is shown and the answer is `stopped`. The work (discovery, reads, the CLI) doesn't
   * wait.
   */
  engineCheck: Promise<FirstCheckResult>;
}

/** How choosing ended. */
export type ConfigurationChoice =
  /** A configuration was chosen and read: the file and the folder to open in the container. */
  | {
      kind: 'chosen';
      configFile: string;
      workspaceFolder: string;
      /** The keys of the configuration's `features`, as written. */
      features: string[];
    }
  /** The folder holds no configuration. */
  | {kind: 'noConfiguration'}
  /** The user ended it: Escape, an empty filter, focus away, "Open File", or a cancelled CLI read. */
  | {kind: 'dismissed'}
  /** A dialog of this module was shown; nothing more is to be shown. */
  | {kind: 'rejected'}
  /** The engine check stopped the flow, and its own dialog has shown. */
  | {kind: 'stopped'};

/** The text of a template with its values, translated. */
function textOf(
  translate: Translate,
  template: string,
  values: readonly string[] = [],
): string {
  return filled(translate, template, values);
}

/** The candidate for a configuration file the caller names, whatever its place in the folder. */
function namedCandidate(folder: string, file: string): Candidate {
  return {
    file,
    relative: path.relative(folder, file).split(path.sep).join('/'),
    place: {kind: 'main'},
  };
}

/** Chooses the configuration of `request.folder`, or reads the one `request.configFile` names. */
export async function chooseConfiguration(
  request: ConfigurationRequest,
  ports: ConfigurationPorts,
): Promise<ConfigurationChoice> {
  const {files, surfaces, translate, logger} = ports;
  const {folder} = request;
  const showLog = textOf(translate, ENGINE_TEMPLATES.S324);
  const stopped: ConfigurationChoice = {kind: 'stopped'};

  /** Whether the engine check lets the flow go on; waits for it. */
  async function engineAllows(): Promise<boolean> {
    return (await request.engineCheck) === 'proceed';
  }

  /** Shows an error dialog with Show Log, and reveals the log when that is what the user chose. */
  async function refuse(message: string, detail: string): Promise<void> {
    const chosen = await surfaces.dialogs.showError(message, detail, [showLog]);
    if (chosen === showLog) {
      surfaces.dialogs.revealLog();
    }
  }

  /**
   * The CLI's read of the candidate, started now. A rejection waits in the promise until it is awaited, so it is never
   * unhandled meanwhile.
   */
  function startRead(
    candidate: Candidate,
  ): Promise<ConfigurationResult | CliFailure> {
    const reading = ports.cli.readConfiguration(
      {
        workspaceFolder: folder,
        configFile: candidate.file,
        dockerPath: request.dockerPath,
        idLabels: [],
        mountWorkspaceGitRoot: true,
        mountGitWorktreeCommonDir: request.mountGitWorktreeCommonDir,
        features: request.features,
        mounts: [],
        logLevel: 'info',
      },
      undefined,
      (event: CliEvent) => {
        logger.debug(event.kind === 'log' ? event.text : event.name);
      },
      request.cancellation,
    );
    reading.catch(() => undefined);
    return reading;
  }

  /** Logs how a read that nobody waits for any more ended: the kind of its result, or the message of its rejection. */
  function logDropped(
    reading: Promise<ConfigurationResult | CliFailure>,
  ): void {
    void reading
      .then(
        result => result.kind,
        (caught: unknown) =>
          caught instanceof Error ? caught.message : String(caught),
      )
      .then(ended => {
        logger.info(
          `the configuration was read while the engine check failed: ${ended}`,
        );
      });
  }

  /** The candidate the user picks among `candidates`; none when the check stopped or the user ended it. */
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
    if (!(await engineAllows())) {
      return undefined;
    }
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

  const found =
    request.configFile === undefined
      ? await discoverConfigurations(folder, files, ports.compare)
      : [namedCandidate(folder, request.configFile)];
  const stored =
    request.configFile === undefined ? await ports.stored?.(folder) : undefined;
  const candidates =
    stored === undefined ? found : byAbsolutePath([...found, stored]);
  if (candidates.length === 0) {
    logger.info(`no dev container configuration in ${folder}`);
    if (!(await engineAllows())) {
      return stopped;
    }
    return {kind: 'noConfiguration'};
  }
  const candidate =
    candidates.length === 1 ? candidates[0] : await picked(candidates);
  if (candidate === undefined) {
    return (await engineAllows()) ? {kind: 'dismissed'} : stopped;
  }
  const bytes = await files.read(candidate.file);
  const parsed =
    bytes === 'unreadable'
      ? undefined
      : parseConfiguration(decodeConfiguration(bytes));
  const dockerfile =
    parsed === undefined ? undefined : dockerfileOf(parsed, candidate.file);
  const missing = dockerfile !== undefined && !(await files.exists(dockerfile));
  const reading =
    parsed !== undefined && hasContainerSource(parsed) && !missing
      ? startRead(candidate)
      : undefined;
  if (!(await engineAllows())) {
    if (reading !== undefined) {
      logDropped(reading);
    }
    return stopped;
  }
  if (parsed === undefined) {
    const opening = surfaces.openPreview(candidate.file);
    await refuse(
      '',
      textOf(translate, CONFIG_TEMPLATES.S181, [candidate.relative]),
    );
    await opening;
    return {kind: 'rejected'};
  }
  if (dockerfile !== undefined && missing) {
    const button = textOf(translate, CONFIG_TEMPLATES.openConfiguration, [
      path.basename(candidate.file),
    ]);
    const chosen = await surfaces.dialogs.showError(
      '',
      textOf(translate, CONFIG_TEMPLATES.S004, [dockerfile]),
      [button],
    );
    if (chosen === button) {
      await surfaces.openPreview(candidate.file);
    }
    return {kind: 'rejected'};
  }
  if (reading === undefined) {
    const useTemplate = textOf(translate, CONFIG_TEMPLATES.useTemplate);
    const answer = await surfaces.showWarning(
      '',
      textOf(translate, CONFIG_TEMPLATES.S113, [candidate.relative]),
      [useTemplate],
    );
    if (answer === useTemplate) {
      await ports.useTemplate(folder);
    } else {
      await surfaces.openPreview(candidate.file);
    }
    return {kind: 'rejected'};
  }
  const read = await reading;
  if (read.kind === 'cancelled') {
    return {kind: 'dismissed'};
  }
  if (read.kind !== 'configuration') {
    logger.warn(`the configuration could not be read: ${cliFailureText(read)}`);
    const opening = surfaces.openPreview(candidate.file);
    await refuse(
      '',
      textOf(translate, CONFIG_TEMPLATES.S181, [candidate.relative]),
    );
    await opening;
    return {kind: 'rejected'};
  }
  if (!read.workspaceFolder.startsWith('/')) {
    await refuse(textOf(translate, CONFIG_TEMPLATES.S411), '');
    return {kind: 'rejected'};
  }
  return {
    kind: 'chosen',
    configFile: candidate.file,
    workspaceFolder: read.workspaceFolder,
    features: requestedFeaturesOf(read.configuration.features, undefined),
  };
}
