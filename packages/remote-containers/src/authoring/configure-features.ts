/**
 * @fileoverview The Configure Container Features command up to the pick: which configuration file the window
 * has, which of several the user means, whether it can be read, and what is said when there is none. The pick and the
 * write that follow are the caller's (`features`). A root that is not on a disk (a virtual file system) is never read or
 * written, and a command that finds a file only there says there is none.
 */

import type {Logger} from 'lib-log';
import {
  decodeConfiguration,
  labelOf,
  parseConfiguration,
} from '../config/configuration-text.ts';
import {type Candidate, discoverConfigurations} from '../config/discovery.ts';
import {joinedCandidates} from '../config/candidates.ts';
import type {PickerAnswer} from '../config/choose-configuration.ts';
import type {Translate} from '../surfaces/engine-dialogs.ts';
import {filled} from '../surfaces/filled.ts';
import type {AuthoringFiles} from './window-files.ts';

/** The English templates of the command's texts, by their string ids. */
const FEATURES_TEMPLATES = {
  S236: 'No container configuration file found.',
  S025: 'Add Files...',
  S303: 'Select a devcontainer.json file.',
  S257: 'Open File',
  S181: "Failed to read Dev Container configuration '{0}' file.",
  S324: 'Show Log',
} as const;

/** The title of the command, which the log names. */
const TITLE = 'Configure Container Features';

/** A folder of the window, as the editor gives it. */
export interface WindowFolder {
  scheme: string;
  /** The path on this machine; for a folder of a remote window, only the editor's rendering of it. */
  fsPath: string;
  /** The path in the folder's own file system. */
  path: string;
}

/** The configuration file the command works on, with the file system it lives on. */
export interface ChosenConfiguration {
  /** The absolute path in `files`. */
  file: string;
  /** The path relative to the folder it was found in (`~`-relative for the store of user data). */
  relative: string;
  /** The text of the file, decoded. */
  text: string;
  /** The files of the machine the configuration lives on, where it is read and written. */
  files: AuthoringFiles;
  /** The folder of the window it was found in; none for the configuration in the store of user data. */
  root: WindowFolder | undefined;
}

/** How the command ended. */
export type FeaturesOutcome =
  | {kind: 'written'; file: string}
  | {kind: 'unchanged'}
  | {kind: 'cancelled'}
  | {kind: 'failed'; detail: string}
  /** The user went to add configuration files instead. */
  | {kind: 'adding'};

/** What the command needs of its surroundings. */
export interface ConfigureFeaturesPorts {
  window: {
    folders(): readonly WindowFolder[];
    /** The kind of remote the window is connected to; none for a local window. */
    remoteName(): string | undefined;
  };
  /** The files of the window's `folder`, addressed on the machine that holds it. */
  filesOf(folder: WindowFolder): AuthoringFiles;
  /** The files of the machine the extension runs on, where the store of user data is. */
  hostFiles: AuthoringFiles;
  /** Orders the names of subfolders. */
  compare: (left: string, right: string) => number;
  /** The folder's configuration in the store of user data, when it has one. */
  stored?(folder: string): Promise<Candidate | undefined>;
  /** The configurations the folder's remotes map to under the user's roots; none while the folder is untrusted. */
  mirrored?(folder: string): Promise<Candidate[]>;
  surfaces: {
    /** The single-select picker of the configurations, with an "Open File" button on each row. */
    pick(
      rows: ReadonlyArray<{label: string; description: string}>,
      placeholder: string,
      openFileTooltip: string,
    ): Promise<PickerAnswer>;
    /** Opens the file in a preview editor tab; `root` is the folder of the window it is in, none for the store of user data. */
    openPreview(
      file: string,
      root: WindowFolder | undefined,
    ): PromiseLike<unknown>;
    /** A modal with the detail and the buttons, the first the primary one; the button chosen, none for Cancel. */
    showModal(
      detail: string,
      buttons: readonly string[],
    ): PromiseLike<string | undefined>;
    /** A modal error with the buttons; the one chosen, none when dismissed. */
    showError(
      message: string,
      detail: string,
      items: readonly string[],
    ): PromiseLike<string | undefined>;
    revealLog(): void;
  };
  /** Takes the user to the wizard that adds configuration files, as "Add Files..." does. */
  addFiles(): PromiseLike<unknown>;
  /** The pick of the Features and the write, over the configuration chosen. */
  features(configuration: ChosenConfiguration): Promise<FeaturesOutcome>;
  translate: Translate;
  logger: Logger;
}

/** Whether the window's folder is on a disk: a local folder, or one of a remote window. */
export function onDisk(folder: WindowFolder): boolean {
  return folder.scheme === 'file' || folder.scheme === 'vscode-remote';
}

/** The path of `folder` in its own file system. */
export function rootPathOf(folder: WindowFolder): string {
  return folder.scheme === 'file' ? folder.fsPath : folder.path;
}

/** A configuration found, and where its text is read from. */
interface Found {
  candidate: Candidate;
  files: AuthoringFiles;
  root: WindowFolder | undefined;
}

/** The handler of the command over `ports`. A call made while another runs returns at once. */
export function configureFeaturesOf(
  ports: ConfigureFeaturesPorts,
): () => Promise<FeaturesOutcome | undefined> {
  const {translate, logger, surfaces} = ports;
  let running = false;

  function text(template: string, values: readonly string[] = []): string {
    return filled(translate, template, values);
  }

  /** The configurations of every root on a disk, in the order the picker lists them. */
  async function foundInWindow(): Promise<Found[]> {
    const roots = ports.window.folders().filter(onDisk);
    const perRoot = await Promise.all(
      roots.map(async root => {
        const files = ports.filesOf(root);
        const folder = rootPathOf(root);
        const candidates = await discoverConfigurations(
          folder,
          {list: target => files.list(target)},
          ports.compare,
        );
        const onHost =
          root.scheme === 'file' && ports.window.remoteName() === undefined;
        const stored = onHost ? await ports.stored?.(folder) : undefined;
        // A multi-root window looks nowhere outside its folders (BR-12).
        const mirrored =
          onHost && roots.length === 1
            ? ((await ports.mirrored?.(folder)) ?? [])
            : [];
        return {
          candidates,
          external: stored === undefined ? mirrored : [stored, ...mirrored],
          files,
          root,
        };
      }),
    );
    const own = perRoot.flatMap(each =>
      each.candidates.map(candidate => ({
        candidate,
        files: each.files,
        root: each.root,
      })),
    );
    const outside = perRoot.flatMap(each =>
      each.external.map(candidate => ({
        candidate,
        files: ports.hostFiles,
        root: undefined,
      })),
    );
    if (outside.length === 0) {
      return own;
    }
    const all = [...own, ...outside];
    const order = joinedCandidates(
      own.map(each => each.candidate),
      outside.map(each => each.candidate),
    );
    return order.flatMap(candidate =>
      all.filter(each => each.candidate === candidate),
    );
  }

  /** Which of the configurations the user means; none when the user ended the pick. */
  async function chosenAmong(
    found: readonly Found[],
  ): Promise<Found | undefined> {
    const [only] = found;
    if (found.length === 1) {
      return only;
    }
    const rows = await Promise.all(
      found.map(async each => {
        const bytes = await each.files
          .read(each.candidate.file)
          .catch(() => undefined);
        const parsed =
          bytes === undefined
            ? undefined
            : parseConfiguration(decodeConfiguration(bytes));
        return {
          label: labelOf(each.candidate.place, parsed, translate),
          description: each.candidate.relative,
        };
      }),
    );
    const answer = await surfaces.pick(
      rows,
      text(FEATURES_TEMPLATES.S303),
      text(FEATURES_TEMPLATES.S257),
    );
    if (answer.kind === 'dismissed') {
      logger.info(`${TITLE} ended: no configuration was chosen`);
      return undefined;
    }
    const chosen = found[answer.index];
    if (answer.kind === 'openFile' && chosen !== undefined) {
      await surfaces.openPreview(chosen.candidate.file, chosen.root);
      return undefined;
    }
    return chosen;
  }

  async function attempt(): Promise<FeaturesOutcome> {
    const found = await foundInWindow();
    if (found.length === 0) {
      logger.info(`${TITLE} found no configuration file`);
      const addFiles = text(FEATURES_TEMPLATES.S025);
      const answer = await surfaces.showModal(text(FEATURES_TEMPLATES.S236), [
        addFiles,
      ]);
      if (answer !== addFiles) {
        return {kind: 'cancelled'};
      }
      await ports.addFiles();
      return {kind: 'adding'};
    }
    const chosen = await chosenAmong(found);
    if (chosen === undefined) {
      return {kind: 'cancelled'};
    }
    const bytes = await chosen.files
      .read(chosen.candidate.file)
      .catch(() => undefined);
    const decoded =
      bytes === undefined ? undefined : decodeConfiguration(bytes);
    if (decoded === undefined || parseConfiguration(decoded) === undefined) {
      const opening = surfaces.openPreview(chosen.candidate.file, chosen.root);
      const showLog = text(FEATURES_TEMPLATES.S324);
      const answer = await surfaces.showError(
        '',
        text(FEATURES_TEMPLATES.S181, [chosen.candidate.relative]),
        [showLog],
      );
      if (answer === showLog) {
        surfaces.revealLog();
      }
      await opening;
      return {kind: 'failed', detail: 'the configuration cannot be read'};
    }
    return ports.features({
      file: chosen.candidate.file,
      relative: chosen.candidate.relative,
      text: decoded,
      files: chosen.files,
      root: chosen.root,
    });
  }

  return async () => {
    if (running) {
      logger.info(`${TITLE} is already running`);
      return undefined;
    }
    running = true;
    try {
      const outcome = await attempt();
      logger.info(`${TITLE} ended: ${outcome.kind}`);
      return outcome;
    } finally {
      running = false;
    }
  };
}
