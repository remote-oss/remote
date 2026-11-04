/**
 * @fileoverview The "Set Label and Update devcontainer.json" command: the label core's inline editor gives for a port,
 * the edit that writes it to the configuration the window means, and the notification a durable write gives.
 */

import {writeAttachConfiguration} from '../attach/config-writer.ts';
import {
  applyConfigurationEdit,
  type ConfigurationEditPorts,
  type EditResult,
  type TextChange,
} from '../config/configuration-edit.ts';
import {setProperty} from '../config/jsonc-edit.ts';
import type {Logger} from 'lib-log';
import {filled} from '../surfaces/filled.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {ownText} from '../surfaces/own-strings.ts';
import {labelEdit, PortsAttributesNotAnObjectError} from './label-edit.ts';

/** The English templates of the command's texts. */
const LABEL_TEMPLATES = {
  S277: 'Port attributes have been added to the {0}.',
  link: 'Dev Container configuration',
  failed: 'The label could not be written: {0}',
} as const;

/** The command that opens the configuration; S277 links to it. */
const OPEN_COMMAND = 'remote-containers.openDevContainerFile';

/** What core's inline editor gives back: the port and the label, or none for Escape and an unchanged value. */
interface LabelledPort {
  port: number;
  label: string;
}

/** The container the window is attached to, and the folder the window has open in it. */
export interface AttachedLabelWindow {
  image: string;
  folder: string | undefined;
}

/** How the command ended. */
export type LabelOutcome =
  {kind: 'written'} | {kind: 'nothing'} | {kind: 'failed'};

/** What the command needs of its surroundings. */
export interface LabelPorts {
  /** Runs core's label editor on `entry` and gives what it returns. */
  askLabel(entry: unknown): PromiseLike<unknown>;
  /** The editor's calls for the document-edit seam. */
  edit: ConfigurationEditPorts;
  /** The container this window is attached to; none for any other window. */
  attached(): AttachedLabelWindow | undefined;
  /** The configuration file the window's own dev container was made from, on the host; none for any other window. */
  ownConfigFile(): string | undefined;
  /** The extension's global storage, where the attach files are. */
  storage: string;
  translate: Translate;
  logger: Logger;
  /** Shows an information notification; `message` may hold a link in Markdown. */
  notify(message: string): void;
  /** Shows an error notification. */
  notifyError(message: string): void;
}

/** The port and the label of what the editor gave; none for anything that is not both. */
function labelledPortOf(answer: unknown): LabelledPort | undefined {
  if (typeof answer !== 'object' || answer === null) {
    return undefined;
  }
  const {port, label} = answer as Record<string, unknown>;
  return typeof port === 'number' &&
    Number.isInteger(port) &&
    port > 0 &&
    typeof label === 'string'
    ? {port, label}
    : undefined;
}

/** The command over `ports`; it gives the entry of the Ports view to the editor. */
export function labelCommandOf(
  ports: LabelPorts,
): (entry: unknown) => Promise<LabelOutcome> {
  const {translate, logger} = ports;
  const link = `[${filled(translate, LABEL_TEMPLATES.link)}](command:${OPEN_COMMAND})`;

  /** What the change found: set when `portsAttributes` is no object. */
  interface Finding {
    broken: boolean;
  }

  /** The change that writes `labelled`, with the folder of an attach file. */
  function changeOf(
    labelled: LabelledPort,
    folder: string | undefined,
  ): {change: TextChange; finding: Finding} {
    const finding: Finding = {broken: false};
    return {
      finding,
      change: current => {
        try {
          const edited = labelEdit(current, labelled.port, labelled.label);
          if (edited === undefined) {
            return undefined;
          }
          return folder === undefined
            ? edited
            : setProperty(edited, ['workspaceFolder'], folder);
        } catch (failure) {
          if (failure instanceof PortsAttributesNotAnObjectError) {
            finding.broken = true;
            return undefined;
          }
          throw failure;
        }
      },
    };
  }

  /** The notice of a refused write, naming `file`. */
  function refusal(
    result: Extract<EditResult, {kind: 'refused'}> | {reason: 'badName'},
    file: string,
  ): string {
    if (result.reason === 'outsideWorkspace') {
      return ownText('configurationOutsideWorkspace', [file], translate);
    }
    if (result.reason === 'symbolicLink') {
      return ownText('configurationLinkUnchecked', [file], translate);
    }
    return result.reason === 'notAnObject'
      ? ownText('configurationNotObject', [file], translate)
      : filled(translate, LABEL_TEMPLATES.failed, [result.reason]);
  }

  /** Tells what the edit came to, and gives the command's outcome. */
  function reported(
    result: EditResult | {kind: 'refused'; reason: 'badName'},
    finding: Finding,
    file: string,
  ): LabelOutcome {
    if (result.kind === 'refused') {
      logger.info(`Set Label and Update refused: ${result.reason}`);
      ports.notifyError(refusal(result, file));
      return {kind: 'failed'};
    }
    if (finding.broken) {
      ports.notifyError(ownText('configurationNotObject', [file], translate));
      return {kind: 'failed'};
    }
    if (result.kind === 'unchanged') {
      return {kind: 'nothing'};
    }
    ports.notify(filled(translate, LABEL_TEMPLATES.S277, [link]));
    return {kind: 'written'};
  }

  /** Writes `labelled` to the image's attach file, whichever file applies to the container. */
  async function writeAttached(
    labelled: LabelledPort,
    attached: AttachedLabelWindow,
  ): Promise<LabelOutcome> {
    const {change, finding} = changeOf(labelled, attached.folder);
    const result = await writeAttachConfiguration(
      ports.storage,
      {image: attached.image},
      change,
      ports.edit,
    );
    return reported(result, finding, attached.image);
  }

  /** Writes `labelled` to the window's own configuration file, saving a clean tab that holds it. */
  async function writeOwn(
    labelled: LabelledPort,
    file: string,
  ): Promise<LabelOutcome> {
    const {change, finding} = changeOf(labelled, undefined);
    const result = await applyConfigurationEdit(
      ports.edit.fileUri(file),
      change,
      'diskOrSaveIfClean',
      ports.edit,
    );
    return reported(result, finding, file);
  }

  return async entry => {
    const labelled = labelledPortOf(await ports.askLabel(entry));
    if (labelled === undefined) {
      return {kind: 'nothing'};
    }
    const attached = ports.attached();
    const ownFile = ports.ownConfigFile();
    let outcome: LabelOutcome;
    if (attached !== undefined) {
      outcome = await writeAttached(labelled, attached);
    } else if (ownFile !== undefined) {
      outcome = await writeOwn(labelled, ownFile);
    } else {
      logger.info('Set Label and Update found no configuration file');
      ports.notifyError(
        filled(translate, LABEL_TEMPLATES.failed, [
          'there is no configuration file',
        ]),
      );
      outcome = {kind: 'failed'};
    }
    logger.info(`Set Label and Update ended: ${outcome.kind}`);
    return outcome;
  };
}
