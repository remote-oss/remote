/**
 * @fileoverview The command that opens an SSH configuration file: the picker over the files, the creation of a missing
 * file with its folders and modes, the opening of the file in the editor, and the starter template for a new one. It
 * works over the ports of the editor and of the client's files, so it imports neither.
 */

import path from 'node:path';
import type {CommandHandler} from 'lib-identifiers';
import {
  buildFileChoice,
  type FileChoice,
  type FileChoiceItem,
} from './file-choice.ts';
import {planCreation, starterTemplate, type Template} from './new-file.ts';

/** What the command needs of the editor. */
export interface ConfigFileEditor {
  /**
   * Shows the file picker: no title, single selection, the first row focused, open when the focus moves away. Gives the
   * chosen row, or nothing on Escape.
   */
  pickFile(choice: FileChoice): PromiseLike<FileChoiceItem | undefined>;
  /** Opens the local file as a preview editor in the active group, or reveals it when it is open. */
  open(file: string): PromiseLike<void>;
  /** Inserts `template` as a snippet at the start of the file's editor; the editor adjusts its indentation. */
  insertTemplate(file: string, template: Template): PromiseLike<void>;
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
 * The path a file row stands for. A user or system row is already absolute. A configured one is as the user wrote it:
 * a leading `~/` or `~\` is the home folder, and a relative value is under the home folder too.
 */
function pathOf(
  fileRow: Extract<FileChoiceItem, {kind: 'file'}>,
  homeFolder: string,
): string {
  if (fileRow.role !== 'configured') {
    return fileRow.label;
  }
  const value = /^~[\\/]/.test(fileRow.label)
    ? path.join(homeFolder, fileRow.label.slice(2))
    : fileRow.label;
  return path.resolve(homeFolder, value);
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
      const file = pathOf(picked, places.homeFolder);
      const exists = await files.exists(file);
      const plan = planCreation({
        file,
        role: picked.role,
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
      await editor.open(file);
      if (plan.insertTemplate) {
        await editor.insertTemplate(file, starterTemplate(STARTER_INDENT));
      }
    },
  };
}
