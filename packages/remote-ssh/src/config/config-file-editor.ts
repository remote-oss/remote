/**
 * @fileoverview The editor and the client files behind the Open SSH Configuration File command: the quick pick over the
 * files, opening a file as a preview, inserting the starter template as a snippet, and making folders and files with
 * the modes asked whatever the umask. `vscode` is imported for its types only; the editor is a value it is given.
 */

import {chmod, close, mkdir, open, readFile, stat, writeFile} from 'node:fs';
import {promisify} from 'node:util';
import path from 'node:path';
import type * as vscode from 'vscode';
import {pickOne} from '../surfaces/editor-adapters.ts';
import {textOfId} from '../surfaces/failure-strings.ts';
import type {FailureStringId} from '../surfaces/failure-strings.ts';
import type {Translate} from '../surfaces/strings.ts';
import type {HostFiles} from './add-host-command.ts';
import type {
  ConfigFileEditor,
  ConfigFiles,
  OpenedEditor,
} from './open-config-file.ts';
import type {FileChoiceItem} from './file-choice.ts';
import {snippetPartsOf} from './snippet-parts.ts';

type Editor = Pick<
  typeof vscode,
  'window' | 'Uri' | 'SnippetString' | 'Position'
>;

/** The text of the string id a reference names, in the display language. */
function textOfReference(
  reference: {id: string; values: readonly string[]},
  translate: Translate,
): string {
  return textOfId(reference.id as FailureStringId, translate, reference.values);
}

/** The opened editor as this adapter makes it: the port's view plus the editor it showed. */
interface Opened extends OpenedEditor {
  /** The editor `showTextDocument` resolved with; the template's snippet goes into it. */
  editor: vscode.TextEditor;
}

/** The editor side of the command: the picker, the preview of a file, and the starter template as a snippet. */
export function configFileEditorOf(
  editor: Editor,
  translate: Translate,
): ConfigFileEditor {
  return {
    pickFile: choice =>
      pickOne<FileChoiceItem>(
        editor,
        {
          placeholder: textOfReference(choice.placeholder, translate),
          choices: choice.items.map(item =>
            item.kind === 'file'
              ? {label: item.label, answer: item}
              : {
                  label: textOfReference(item.label, translate),
                  description: textOfReference(item.description, translate),
                  alwaysShow: true,
                  answer: item,
                },
          ),
          ignoreFocusOut: true,
        },
        new AbortController().signal,
      ),
    open: async (file): Promise<Opened> => {
      const shown = await editor.window.showTextDocument(
        editor.Uri.file(file),
        {preview: true},
      );
      return {file, editor: shown};
    },
    insertTemplate: async (opened, template) => {
      // `open` made this editor this run; the command hands it back.
      const target = (opened as Opened).editor;
      const snippet = new editor.SnippetString();
      for (const part of snippetPartsOf(template)) {
        if (part.kind === 'text') {
          snippet.appendText(part.text);
        } else if (part.kind === 'placeholder') {
          snippet.appendPlaceholder(part.text, part.number);
        } else {
          snippet.appendTabstop(0);
        }
      }
      await target.insertSnippet(snippet, new editor.Position(0, 0));
    },
  };
}

const changeMode = promisify(chmod);
const makeFolder = promisify(mkdir);
const openFile = promisify(open);
const closeFile = promisify(close);
const readText = promisify(readFile);
const writeText = promisify(writeFile);
const statPath = promisify(stat);

/** Whether a path exists. */
async function exists(target: string): Promise<boolean> {
  try {
    await statPath(target);
    return true;
  } catch {
    return false;
  }
}

/** The client's files, over `node:fs`. */
export const nodeConfigFiles: ConfigFiles = {
  exists,
  missingFolders: async file => {
    const missing: string[] = [];
    for (
      let folder = path.dirname(file);
      !(await exists(folder));
      folder = path.dirname(folder)
    ) {
      missing.unshift(folder);
    }
    return missing;
  },
  makeFolder: async (folder, mode) => {
    await makeFolder(folder, {mode});
    await changeMode(folder, mode);
  },
  createFile: async (file, mode) => {
    await closeFile(await openFile(file, 'wx', mode));
    await changeMode(file, mode);
  },
};

/** The client's files with their text, for the command that adds a host. */
export const nodeHostFiles: HostFiles = {
  ...nodeConfigFiles,
  read: file => readText(file, 'utf8'),
  write: (file, text) => writeText(file, text),
};
