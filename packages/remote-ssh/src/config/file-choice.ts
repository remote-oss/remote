/**
 * @fileoverview The rows of the SSH configuration file picker: the configured file as written, or the user and
 * system files, with the settings and help rows; narrowing keeps the matching rows first.
 */

/** The input the picker model reads. */
export interface FileChoiceInput {
  /** `remote.SSH.configFile` as written; `''` or whitespace only means unset. */
  configFile: string;
  /** The absolute user file, e.g. /home/u/.ssh/config. */
  userFile: string;
  /** The system file, e.g. /etc/ssh/ssh_config. */
  systemFile: string;
}

/** One row of the picker. */
export type FileChoiceItem =
  | {kind: 'file'; label: string; role: 'user' | 'system' | 'configured'}
  | {
      kind: 'settings';
      label: 'Settings';
      description: 'specify a custom configuration file';
    }
  | {kind: 'help'; label: 'Help'; description: 'about SSH configuration files'};

/** The picker: its placeholder and its rows, the first of which is the focused row. */
export interface FileChoice {
  placeholder: string;
  items: readonly FileChoiceItem[];
}

/** The settings row, in the default and the custom-file picker alike. */
const SETTINGS_ITEM: FileChoiceItem = {
  kind: 'settings',
  label: 'Settings',
  description: 'specify a custom configuration file',
};

/** The help row, in the default and the custom-file picker alike. */
const HELP_ITEM: FileChoiceItem = {
  kind: 'help',
  label: 'Help',
  description: 'about SSH configuration files',
};

/**
 * The rows of the picker. Without a configured file: the user and system files, then the settings and help rows.
 * With one: the value exactly as written, untrimmed and unexpanded, then the settings and help rows.
 */
export function buildFileChoice(input: FileChoiceInput): FileChoice {
  if (input.configFile.trim() !== '') {
    return {
      placeholder: 'Edit custom SSH configuration file',
      items: [
        {kind: 'file', label: input.configFile, role: 'configured'},
        SETTINGS_ITEM,
        HELP_ITEM,
      ],
    };
  }
  return {
    placeholder: 'Select SSH configuration file to update',
    items: [
      {kind: 'file', label: input.userFile, role: 'user'},
      {kind: 'file', label: input.systemFile, role: 'system'},
      SETTINGS_ITEM,
      HELP_ITEM,
    ],
  };
}

/**
 * The rows after the typed text: the rows whose label contains it, ignoring case, in their order, then the
 * non-matching settings and help rows in their order; the non-matching file rows are dropped.
 */
export function narrowFileChoice(
  items: readonly FileChoiceItem[],
  typed: string,
): readonly FileChoiceItem[] {
  const needle = typed.toLowerCase();
  if (needle === '') {
    return items;
  }
  const matching: FileChoiceItem[] = [];
  const trailing: FileChoiceItem[] = [];
  for (const item of items) {
    if (item.label.toLowerCase().includes(needle)) {
      matching.push(item);
    } else if (item.kind !== 'file') {
      trailing.push(item);
    }
  }
  return [...matching, ...trailing];
}
