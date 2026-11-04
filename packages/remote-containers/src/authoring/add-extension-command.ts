/**
 * @fileoverview The "Add to devcontainer.json" command: the configuration the window means (an attached container's
 * file, the window's own, or the one of several the user picks), the edit through the document-edit seam, and the
 * notification each end gives. It needs no trust and no Docker.
 */

import {
  type AttachConfigFiles,
  applicableConfigOf,
  attachConfigFilesOf,
} from '../attach/config-files.ts';
import {writeAttachConfiguration} from '../attach/config-writer.ts';
import {
  applyConfigurationEdit,
  type ConfigUri,
  type ConfigurationEditPorts,
  type EditPolicy,
  type EditResult,
  type TextChange,
} from '../config/configuration-edit.ts';
import {editTargetOf} from '../config/edit-target.ts';
import {setProperty} from '../config/jsonc-edit.ts';
import {filled} from '../surfaces/filled.ts';
import {addExtensionEdit, NotAnArrayError} from './add-extension.ts';
import {
  chosenAmong,
  type ConfigureFeaturesPorts,
  foundInWindow,
  type WindowFolder,
} from './configure-features.ts';

/** The English templates of the command's texts, by their string ids; the error texts have no id. */
const ADD_TEMPLATES = {
  S174: 'Extension has been added to the {0}.',
  S175: 'Extension is already included in the {0}.',
  link: 'Dev Container configuration',
  S236: 'No container configuration file found.',
  S025: 'Add Files...',
  notObject:
    'The configuration {0} is not a JSON object, so the extension was not added.',
  notArray:
    '{0} in the configuration is not an array, so the extension was not added.',
  failed: 'The extension could not be added: {0}',
} as const;

/** The command that opens the configuration; S174 and S175 link to it. */
const OPEN_COMMAND = 'remote-containers.openDevContainerFile';

/** How the command ended. */
export type AddExtensionOutcome =
  | {kind: 'added'}
  | {kind: 'duplicate'}
  | {kind: 'cancelled'}
  | {kind: 'failed'}
  /** The user went to add configuration files instead. */
  | {kind: 'adding'};

/** The container the window is attached to, and the folder the window has open in it. */
export interface AttachedWindow {
  image: string;
  name: string;
  folder: string | undefined;
}

/** What the command needs of its surroundings. */
export interface AddExtensionPorts extends Pick<
  ConfigureFeaturesPorts,
  | 'window'
  | 'filesOf'
  | 'hostFiles'
  | 'compare'
  | 'stored'
  | 'mirrored'
  | 'surfaces'
  | 'addFiles'
  | 'translate'
  | 'logger'
> {
  /** The editor's calls for the document-edit seam. */
  edit: ConfigurationEditPorts;
  /** The container this window is attached to; none for any other window. */
  attached(): AttachedWindow | undefined;
  /** The configuration file the window's own dev container was made from, on the host; none for any other window. */
  ownConfigFile(): string | undefined;
  /** The extension's global storage, where the attach files are. */
  storage: string;
  exists(file: string): Promise<boolean>;
  /** The URI of a configuration file found in `root`, none for one on the host's own disk. */
  uriOf(file: string, root: WindowFolder | undefined): ConfigUri;
  /** Shows the document of `file` in an editor tab. */
  reveal(file: ConfigUri): PromiseLike<unknown>;
  /** Shows an information notification; `message` may hold a link in Markdown. */
  notify(message: string): void;
  /** Shows an error notification. */
  notifyError(message: string): void;
}

/** The command over `ports`; it gives the extension extensionId to the handler. */
export function addExtensionCommandOf(
  ports: AddExtensionPorts,
): (extensionId: string) => Promise<AddExtensionOutcome> {
  const {translate, logger} = ports;
  function text(template: string, values: readonly string[] = []): string {
    return filled(translate, template, values);
  }
  const link = `[${text(ADD_TEMPLATES.link)}](command:${OPEN_COMMAND})`;

  /** What the change finds: set when the text already holds the extensionId, or when a list is no array. */
  interface Finding {
    duplicate: boolean;
    broken: string | undefined;
  }

  /** The change that adds `id`, and what it found. */
  function changeOf(
    extensionId: string,
    folder: string | undefined,
  ): {change: TextChange; finding: Finding} {
    const finding: Finding = {duplicate: false, broken: undefined};
    return {
      finding,
      change: current => {
        try {
          const added = addExtensionEdit(current, extensionId);
          if (added === undefined) {
            finding.duplicate = true;
            return undefined;
          }
          return folder === undefined
            ? added
            : setProperty(added, ['workspaceFolder'], folder);
        } catch (failure) {
          if (failure instanceof NotAnArrayError) {
            finding.broken = failure.list;
            return undefined;
          }
          throw failure;
        }
      },
    };
  }

  /** Tells what the edit came to, and gives the command's outcome. */
  function reported(
    result: EditResult | {kind: 'refused'; reason: 'badName'},
    finding: Finding,
  ): AddExtensionOutcome {
    if (result.kind === 'refused') {
      logger.info(`Add to devcontainer.json refused: ${result.reason}`);
      ports.notifyError(
        text(
          result.reason === 'notAnObject'
            ? ADD_TEMPLATES.notObject
            : ADD_TEMPLATES.failed,
          [result.reason === 'notAnObject' ? link : result.reason],
        ),
      );
      return {kind: 'failed'};
    }
    if (finding.broken !== undefined) {
      ports.notifyError(text(ADD_TEMPLATES.notArray, [finding.broken]));
      return {kind: 'failed'};
    }
    if (finding.duplicate) {
      ports.notify(text(ADD_TEMPLATES.S175, [link]));
      return {kind: 'duplicate'};
    }
    ports.notify(text(ADD_TEMPLATES.S174, [link]));
    return {kind: 'added'};
  }

  /** Writes `id` to the attach file that applies to the attached container: the name's if it exists, else the image's. */
  async function writeAttached(
    extensionId: string,
    attached: AttachedWindow,
  ): Promise<AddExtensionOutcome> {
    const files: AttachConfigFiles = attachConfigFilesOf(
      ports.storage,
      attached.image,
      attached.name,
    );
    const applicable = await applicableConfigOf(files, file =>
      ports.exists(file),
    );
    const {change, finding} = changeOf(extensionId, attached.folder);
    const result = await writeAttachConfiguration(
      ports.storage,
      applicable === files.name
        ? {name: attached.name}
        : {image: attached.image},
      change,
      ports.edit,
    );
    return reported(result, finding);
  }

  /** Edits `uri` by `policy` and shows the editor when the edit is in its buffer. */
  async function editFile(
    extensionId: string,
    uri: ConfigUri,
    policy: EditPolicy,
  ): Promise<AddExtensionOutcome> {
    const {change, finding} = changeOf(extensionId, undefined);
    const result = await applyConfigurationEdit(
      uri,
      change,
      policy,
      ports.edit,
    );
    const outcome = reported(result, finding);
    if (
      outcome.kind === 'added' &&
      result.kind === 'inBuffer' &&
      policy === 'buffer'
    ) {
      await ports.reveal(uri);
    }
    return outcome;
  }

  async function attempt(extensionId: string): Promise<AddExtensionOutcome> {
    const attached = ports.attached();
    if (attached !== undefined) {
      return writeAttached(extensionId, attached);
    }
    const found = await foundInWindow(ports);
    const ownFile = ports.ownConfigFile();
    const target = editTargetOf({
      ...(ownFile === undefined ? {} : {ownFile}),
      workspace: found
        .filter(each => each.root !== undefined)
        .map(each => each.candidate),
      external: found
        .filter(each => each.root === undefined)
        .map(each => each.candidate),
    });
    if (target.kind === 'none') {
      logger.info('Add to devcontainer.json found no configuration file');
      const addFiles = text(ADD_TEMPLATES.S025);
      const answer = await ports.surfaces.showModal(text(ADD_TEMPLATES.S236), [
        addFiles,
      ]);
      if (answer !== addFiles) {
        return {kind: 'cancelled'};
      }
      await ports.addFiles();
      return {kind: 'adding'};
    }
    if (target.kind === 'file') {
      const owner = found.find(each => each.candidate.file === target.file);
      return editFile(
        extensionId,
        ports.uriOf(target.file, owner?.root),
        target.policy,
      );
    }
    const options = found.filter(each =>
      target.candidates.some(entry => entry.candidate === each.candidate),
    );
    const chosen = await chosenAmong(options, ports);
    if (chosen === undefined) {
      return {kind: 'cancelled'};
    }
    // A file of the store or of a mirror is written on disk unless a tab holds it; a file of the window is edited in its buffer.
    const policy = chosen.root === undefined ? 'diskUnlessOpen' : 'buffer';
    return editFile(
      extensionId,
      ports.uriOf(chosen.candidate.file, chosen.root),
      policy,
    );
  }

  return async extensionId => {
    const outcome = await attempt(extensionId);
    logger.info(`Add to devcontainer.json ended: ${outcome.kind}`);
    return outcome;
  };
}
