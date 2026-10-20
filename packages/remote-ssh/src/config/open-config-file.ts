/**
 * @fileoverview The command that opens an SSH configuration file: the picker over the files, the creation of a missing
 * file with its folders and modes, the opening of the file in the editor, and the starter template for a new one. It
 * works over the ports of the editor and of the client's files, so it imports neither.
 */

import type {CommandHandler} from 'lib-identifiers';
import {configFilePath, type ClientPlatform} from 'lib-ssh';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';
import {
  buildFileChoice,
  type FileChoice,
  type FileChoiceItem,
} from './file-choice.ts';
import {
  type NewFileInput,
  planCreation,
  starterTemplate,
  type Template,
} from './new-file.ts';

/** The page about SSH configuration files that the picker's Help row opens. */
export const CONFIG_FILE_HELP_ADDRESS =
  'https://github.com/remote-oss/remote/blob/main/docs/remote-ssh/ssh-config.md';

/** What the command needs of the editor. */
export interface ConfigFileEditor {
  /**
   * Shows the file picker: no title, single selection, the first row focused, open when the focus moves away. Gives the
   * chosen row, or nothing on Escape.
   */
  pickFile(choice: FileChoice): PromiseLike<FileChoiceItem | undefined>;
  /** Opens the local file as a preview editor in the active group, or reveals it, and gives that editor. */
  open(file: string): PromiseLike<OpenedEditor>;
  /** Inserts `template` as a snippet at the start of `opened`; the editor adjusts its indentation. */
  insertTemplate(opened: OpenedEditor, template: Template): PromiseLike<void>;
  /**
   * Calls `onSave` at each save of the opened document, for as long as a tab of it stays open; a save of the same
   * file while no tab this command opened is open, calls nothing.
   */
  watchSaves(opened: OpenedEditor, onSave: () => void): void;
}

/** The editor `open` opened; only the adapter reads it. */
export interface OpenedEditor {
  readonly file: string;
}

/** What the command needs of the client's files. */
export interface ConfigFiles {
  exists(filePath: string): PromiseLike<boolean>;
  /** The missing folders on the path to `file`, outermost first. */
  missingFolders(file: string): PromiseLike<readonly string[]>;
  /** Makes one folder with `mode`; a failure rejects with the system error. */
  makeFolder(folderPath: string, mode: number): PromiseLike<void>;
  /** Creates one empty file with `mode`, failing if it exists; a failure rejects with the system error. */
  createFile(filePath: string, mode: number): PromiseLike<void>;
}

/** Where the command looks. */
export interface ConfigFilePlaces {
  homeFolder: string;
  /** The platform the file paths are read on. */
  platform: ClientPlatform;
  /** The user file, `<home>/.ssh/config` with the platform's separators. */
  userFile: string;
  /** The system file, `/etc/ssh/ssh_config`. */
  systemFile: string;
}

/** The two fixed rows' actions. */
export interface ConfigFileActions {
  /** "Settings": the Settings editor with the given query. */
  openSettings(query: string): PromiseLike<unknown>;
  /** "Help": the external browser on our page. */
  openHelp(): PromiseLike<unknown>;
}

/** The extension and its pack, for the Settings query. */
export interface ConfigFileExtension {
  id: string;
  pack: readonly string[];
}

/** The starter template is written for four spaces; the editor adjusts it to the user's indentation. */
const STARTER_INDENT = {insertSpaces: true, tabSize: 4} as const;

/**
 * The path a file row stands for. A user or system row is already absolute. A configured one passes the one check
 * of the setting, and a value that is neither absolute nor a `~` form is a command error, not a place under the
 * home folder.
 */
export function pathOf(
  fileRow: Extract<FileChoiceItem, {kind: 'file'}>,
  homeFolder: string,
  platform: ClientPlatform,
  translate: Translate,
): string {
  if (fileRow.role !== 'configured') {
    return fileRow.label;
  }
  const setting = configFilePath(fileRow.label, homeFolder, platform);
  if (setting.kind !== 'file') {
    throw new Error(
      ownText(
        {id: 'configFileNotAbsolute', values: [fileRow.label]},
        translate,
      ),
    );
  }
  return setting.path;
}

/** What making a file ready found and did. */
export interface PreparedFile {
  /** Whether the file was there before. */
  exists: boolean;
  /** Whether the file was made by this call, so it gets the starter template. */
  insertTemplate: boolean;
}

/** Makes the file and the folders on its path when they are missing, with the modes of its role. */
export async function createdFile(
  files: ConfigFiles,
  file: string,
  role: NewFileInput['role'],
): Promise<PreparedFile> {
  const exists = await files.exists(file);
  const plan = planCreation({
    file,
    role,
    exists,
    missingFolders: exists ? [] : await files.missingFolders(file),
  });
  for (const step of plan.steps) {
    if (step.kind === 'folder') {
      await files.makeFolder(step.path, step.mode);
    } else {
      await files.createFile(step.path, step.mode);
    }
  }
  return {exists, insertTemplate: plan.insertTemplate};
}

/** The command: pick a file, make it when it is missing, open it, and give a new one its template. */
export function openConfigFileHandler(
  editor: ConfigFileEditor,
  files: ConfigFiles,
  actions: ConfigFileActions,
  places: ConfigFilePlaces,
  /** `remote.SSH.configFile` as written, read at each run. */
  configFile: () => string,
  extension: ConfigFileExtension,
  /** An English template into the display language. */
  translate: Translate,
  /** Tells Remote Explorer that the configured hosts may have changed. */
  hostsChanged: () => void,
): CommandHandler {
  return {
    execute: async () => {
      const picked = await editor.pickFile(
        buildFileChoice({
          configFile: configFile(),
          userFile: places.userFile,
          systemFile: places.systemFile,
        }),
      );
      if (picked === undefined) {
        return;
      }
      if (picked.kind === 'settings') {
        await actions.openSettings(
          `@ext:${[extension.id, ...extension.pack].join(',')} config file`,
        );
        return;
      }
      if (picked.kind === 'help') {
        await actions.openHelp();
        return;
      }
      const file = pathOf(
        picked,
        places.homeFolder,
        places.platform,
        translate,
      );
      const created = await createdFile(files, file, picked.role);
      const opened = await editor.open(file);
      if (created.insertTemplate) {
        await editor.insertTemplate(opened, starterTemplate(STARTER_INDENT));
      }
      editor.watchSaves(opened, hostsChanged);
    },
  };
}
