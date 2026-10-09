/**
 * @fileoverview The creation of a picked SSH configuration file: the folders to make and their modes, the file
 * and its mode, and the starter template to insert. Pure: it returns what to create, never creates it.
 */

/** A folder on the path of the file. */
export interface FolderState {
  path: string;
  exists: boolean;
}

/** What the caller checked before planning. */
export interface NewFileInput {
  /** The file's absolute path, `~` already expanded by the caller. */
  file: string;
  role: 'user' | 'configured';
  exists: boolean;
  /** The missing folders on the file's path, outermost first; empty when the parent exists. */
  missingFolders: readonly string[];
}

/** One step of the plan, in order. */
export interface CreationStep {
  path: string;
  kind: 'folder' | 'file';
  mode: number;
}

/** The plan: the steps, folders first, then the file, and whether the template is inserted. */
export interface CreationPlan {
  steps: readonly CreationStep[];
  insertTemplate: boolean;
}

/** The indent the caller writes with. */
export interface IndentChoice {
  insertSpaces: boolean;
  tabSize: 2 | 4;
}

/** The caret or the selection the editor puts where the text is typed, zero-based. */
export interface TabStop {
  line: number;
  start: number;
  end: number;
}

/** The starter template and its tab stops, in order. */
export interface Template {
  text: string;
  tabStops: readonly TabStop[];
}

/** The mode of the folders and the file of a user role. */
const USER_FOLDER_MODE = 0o700;
const USER_FILE_MODE = 0o600;
const CONFIGURED_FOLDER_MODE = 0o755;
const CONFIGURED_FILE_MODE = 0o644;

/**
 * The steps that create the file: each missing folder, then the file. The modes depend on the role. A file that
 * exists is untouched: no steps, no template.
 */
export function planCreation(input: NewFileInput): CreationPlan {
  if (input.exists) {
    return {steps: [], insertTemplate: false};
  }
  const folderMode =
    input.role === 'user' ? USER_FOLDER_MODE : CONFIGURED_FOLDER_MODE;
  const fileMode =
    input.role === 'user' ? USER_FILE_MODE : CONFIGURED_FILE_MODE;
  const steps: CreationStep[] = input.missingFolders.map(path => ({
    path,
    kind: 'folder',
    mode: folderMode,
  }));
  steps.push({path: input.file, kind: 'file', mode: fileMode});
  return {steps, insertTemplate: true};
}

/**
 * The starter template: the comment line, and the `Host`, `HostName` and `User` lines indented by the unit.
 * Joined with a line feed, no trailing newline.
 */
export function starterTemplate(indent: IndentChoice): Template {
  const unit = indent.insertSpaces
    ? ' '.repeat(4)
    : '\t'.repeat(4 / indent.tabSize);
  const text =
    `# Read more about SSH config files: https://linux.die.net/man/5/ssh_config\n` +
    `Host alias\n` +
    `${unit}HostName hostname\n` +
    `${unit}User user`;
  const aliasStop: TabStop = {line: 1, start: 5, end: 10};
  const hostnameStop: TabStop = {
    line: 2,
    start: unit.length + 9,
    end: unit.length + 17,
  };
  const userStop: TabStop = {
    line: 3,
    start: unit.length + 5,
    end: unit.length + 9,
  };
  const caretStop: TabStop = {
    line: 3,
    start: unit.length + 9,
    end: unit.length + 9,
  };
  return {text, tabStops: [aliasStop, hostnameStop, userStop, caretStop]};
}
