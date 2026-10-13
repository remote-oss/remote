/**
 * @fileoverview The rows of the SSH configuration file picker: the configured file as written, or the user and
 * system files, with the settings and help rows; narrowing keeps a file row while its path contains the typed
 * text, and the fixed rows always. The fixed rows carry string ids, never text; the surface resolves them. The pick
 * itself is a port, so the command sees neither the editor's quick pick nor the harness's script.
 */

import type {StringRef} from '../connect/picker-model.ts';
import {textOfId} from '../surfaces/failure-strings.ts';
import type {FailureStringId} from '../surfaces/failure-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The input the picker model reads. */
export interface FileChoiceInput {
  /** `remote.SSH.configFile` as written; only `''` means unset. */
  configFile: string;
  /** The absolute user file, e.g. /home/u/.ssh/config. */
  userFile: string;
  /** The system file, e.g. /etc/ssh/ssh_config. */
  systemFile: string;
}

/** One row of the picker: a file path, or one of the two fixed rows by their string-table ids. */
export type FileChoiceItem =
  | {kind: 'file'; label: string; role: 'user' | 'system' | 'configured'}
  | {kind: 'settings'; label: StringRef; description: StringRef}
  | {kind: 'help'; label: StringRef; description: StringRef};

/** The picker: its placeholder and its rows, the first of which is the focused row. */
export interface FileChoice {
  placeholder: StringRef;
  items: readonly FileChoiceItem[];
}

/**
 * The SSH configuration file pick: the rows of `choice`, single selection, the first row focused, open when the
 * focus moves away; the row taken, or nothing when the pick is closed without one.
 */
export interface FilePickPort {
  pick(choice: FileChoice): Promise<FileChoiceItem | undefined>;
}

/** The text of one of this picker's string references, in the display language. */
export function fileChoiceTextOf(
  reference: StringRef,
  translate: Translate,
): string {
  return textOfId(reference.id as FailureStringId, translate, reference.values);
}

/** The label of a row: a file's path as it is, a fixed row from the string table. */
export function fileChoiceLabelOf(
  item: FileChoiceItem,
  translate: Translate,
): string {
  return item.kind === 'file'
    ? item.label
    : fileChoiceTextOf(item.label, translate);
}

/** The placeholder when no file is configured. */
const SELECT_PLACEHOLDER: StringRef = {id: 'S126', values: []};

/** The placeholder when a file is configured. */
const EDIT_PLACEHOLDER: StringRef = {id: 'S047', values: []};

/** The settings row, in the default and the custom-file picker alike. */
const SETTINGS_ITEM: FileChoiceItem = {
  kind: 'settings',
  label: {id: 'S131', values: []},
  description: {id: 'S166', values: []},
};

/** The help row, in the default and the custom-file picker alike. */
const HELP_ITEM: FileChoiceItem = {
  kind: 'help',
  label: {id: 'S077', values: []},
  description: {id: 'S162', values: []},
};

/**
 * The rows of the picker. Without a configured file: the user and system files, then the settings and help
 * rows. With one: the value exactly as written, untrimmed and unexpanded, then the settings and help rows.
 */
export function buildFileChoice(input: FileChoiceInput): FileChoice {
  if (input.configFile !== '') {
    return {
      placeholder: EDIT_PLACEHOLDER,
      items: [
        {kind: 'file', label: input.configFile, role: 'configured'},
        SETTINGS_ITEM,
        HELP_ITEM,
      ],
    };
  }
  return {
    placeholder: SELECT_PLACEHOLDER,
    items: [
      {kind: 'file', label: input.userFile, role: 'user'},
      {kind: 'file', label: input.systemFile, role: 'system'},
      SETTINGS_ITEM,
      HELP_ITEM,
    ],
  };
}

/**
 * The rows after the typed text: the file rows whose path contains it, ignoring case, in their order, then the
 * settings and help rows, always kept. The fixed rows carry ids, not text, so their labels are not matched.
 */
export function narrowFileChoice(
  items: readonly FileChoiceItem[],
  typed: string,
): readonly FileChoiceItem[] {
  const needle = typed.toLowerCase();
  const kept: FileChoiceItem[] = [];
  for (const item of items) {
    if (
      item.kind === 'file' &&
      needle !== '' &&
      !item.label.toLowerCase().includes(needle)
    ) {
      continue;
    }
    kept.push(item);
  }
  return kept;
}
