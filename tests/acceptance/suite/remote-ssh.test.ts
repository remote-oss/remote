import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import * as vscode from 'vscode';
import {scriptFor, type RecordLine} from '../suite-local/script.ts';

/** The commands the editor knows, after Remote - SSH has activated. */
async function commandsAfterActivation(): Promise<string[]> {
  await vscode.extensions.getExtension('remote-oss.remote-ssh')?.activate();
  return vscode.commands.getCommands(true);
}

/** The value the harness launched this window with, restored at the end of a row that changes it. */
const HARNESS_CONFIG = process.env.HARNESS_SSH_CONFIG ?? '';

/** Sets `remote.SSH.configFile` in the user settings to `value`, `''` for unset. */
async function configFileSetting(value: string): Promise<void> {
  await vscode.workspace
    .getConfiguration('remote.SSH')
    .update('configFile', value, vscode.ConfigurationTarget.Global);
}

/** Sets one editor setting, and puts it back when `done` settles. */
async function editorSetting(
  name: string,
  value: string | number | boolean,
  done: () => Promise<void>,
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('editor');
  const original = configuration.get(name);
  await configuration.update(name, value, vscode.ConfigurationTarget.Global);
  try {
    await done();
  } finally {
    await configuration.update(
      name,
      original,
      vscode.ConfigurationTarget.Global,
    );
  }
}

/** The file pick's recorded line, or nothing when the pick was not asked. */
function filePickLine(record: RecordLine[]) {
  return record.find(line => line.surface === 'filePick');
}

/** The selection the editor shows, as its start and end lines and characters. */
function selectionOf(editor: vscode.TextEditor | undefined) {
  return editor?.selection
    ? [
        editor.selection.start.line,
        editor.selection.start.character,
        editor.selection.end.line,
        editor.selection.end.character,
      ]
    : [undefined, undefined, undefined, undefined];
}

/** The BR-6 template as the editor renders it with `editor.insertSpaces: true` and `editor.tabSize: 4`. */
const TEMPLATE = [
  '# Read more about SSH config files: https://linux.die.net/man/5/ssh_config',
  'Host alias',
  '    HostName hostname',
  '    User user',
].join('\n');

/** Waits `milliseconds` before the assertion that follows needs the window to have settled. */
async function settle(milliseconds: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, milliseconds));
}

describe('Remote - SSH, activated in the editor', () => {
  it('#140: the connect is registered: the details command the progress links to exists', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.showDetails'),
      true,
    );
  });

  it('Open Web UI is served once the connect is registered (F-2002)', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.openWebUI'),
      true,
    );
  });

  it('F-2203.AC-1: Open SSH Configuration File is served, and it runs (#397)', async () => {
    const commands = await commandsAfterActivation();
    const script = scriptFor([
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    await vscode.commands.executeCommand('opensshremotes.openConfigFile');
    deepStrictEqual(
      [
        commands.includes('opensshremotes.openConfigFile'),
        filePickLine(script.record()) !== undefined,
      ],
      [true, true],
    );
  });

  it('F-2203 AC-2 (c119-select): with no configured file the picker gives the four rows, the user file first', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    const script = scriptFor([
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    await commandsAfterActivation();
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const line = filePickLine(script.record());
      deepStrictEqual(
        [line?.question, line?.items],
        [
          'Select SSH configuration file to update',
          [userFile, '/etc/ssh/ssh_config', 'Settings', 'Help'],
        ],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-3 (c119-open): an existing user file opens at Ln 1 Col 1, not dirty, and nothing is written', async () => {
    const sshFolder = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolder, 'config');
    mkdirSync(sshFolder, {recursive: true});
    const before = 'existing content\n';
    writeFileSync(userFile, before);
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await commandsAfterActivation();
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const editor = vscode.window.activeTextEditor;
      deepStrictEqual(
        [
          editor?.document.uri.fsPath,
          editor?.document.isDirty,
          [editor?.selection.anchor.line, editor?.selection.anchor.character],
          readFileSync(userFile, 'utf8'),
        ],
        [userFile, false, [0, 0], before],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-4 (c119-again): an already open user file is revealed active with its selection, and no second tab opens', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    mkdirSync(path.dirname(userFile), {recursive: true});
    writeFileSync(userFile, 'Host existing\n');
    const document = await vscode.workspace.openTextDocument(userFile);
    const editor = await vscode.window.showTextDocument(document);
    editor.selection = new vscode.Selection(0, 4, 0, 12);
    const before = selectionOf(editor);
    const other = path.join(mkdtempSync(path.join(tmpdir(), 'c119-')), 'other');
    writeFileSync(other, 'other\n');
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(other),
    );
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const active = vscode.window.activeTextEditor;
      deepStrictEqual(
        [
          active?.document.uri.fsPath,
          selectionOf(active),
          vscode.window.visibleTextEditors.filter(
            each => each.document.uri.fsPath === userFile,
          ).length,
        ],
        [userFile, before, 1],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-6, AC-7 (c119-template): a created user file opens with the BR-6 template, and a save writes it', async () => {
    const sshFolder = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolder, 'config');
    rmSync(sshFolder, {recursive: true, force: true});
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await configFileSetting('');
    try {
      await editorSetting('insertSpaces', true, async () => {
        await editorSetting('tabSize', 4, async () => {
          const measured: unknown[] = [];
          await vscode.commands.executeCommand('opensshremotes.openConfigFile');
          const editor = vscode.window.activeTextEditor;
          measured.push([
            editor?.document.uri.fsPath,
            editor?.document.isDirty,
            readFileSync(userFile, 'utf8'),
            editor?.document.getText(),
            selectionOf(editor),
          ]);
          await vscode.commands.executeCommand('type', {text: '\t'});
          await settle(200);
          measured.push(selectionOf(editor));
          await vscode.commands.executeCommand('type', {text: '\t'});
          await settle(200);
          measured.push(selectionOf(editor));
          await vscode.commands.executeCommand('type', {text: '\t'});
          await settle(200);
          measured.push(selectionOf(editor));
          await vscode.commands.executeCommand('workbench.action.files.save');
          measured.push([
            readFileSync(userFile, 'utf8'),
            statSync(userFile).mode & 0o777,
          ]);
          deepStrictEqual(measured, [
            [userFile, true, '', TEMPLATE, [1, 5, 1, 9]],
            [2, 13, 2, 21],
            [3, 9, 3, 13],
            [3, 13, 3, 13],
            [TEMPLATE, 0o600],
          ]);
        });
      });
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-8 (c119-dontsave): closing the template and choosing "Don\'t Save" leaves the created empty file on disk', async () => {
    const sshFolder = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolder, 'config');
    rmSync(sshFolder, {recursive: true, force: true});
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      await vscode.commands.executeCommand(
        'workbench.action.closeActiveEditor',
      );
      await settle(500);
      for (const letter of "Don't Save") {
        await vscode.commands.executeCommand('type', {text: letter});
        await settle(100);
      }
      await vscode.commands.executeCommand('type', {text: '\r'});
      await settle(500);
      deepStrictEqual(
        [
          existsSync(userFile),
          readFileSync(userFile, 'utf8'),
          vscode.window.visibleTextEditors.some(
            each => each.document.uri.fsPath === userFile,
          ),
        ],
        [true, '', false],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-9 (c119-empty): an existing empty file opens with no template, not dirty', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    mkdirSync(path.dirname(userFile), {recursive: true});
    writeFileSync(userFile, '');
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const editor = vscode.window.activeTextEditor;
      deepStrictEqual(
        [
          editor?.document.uri.fsPath,
          editor?.document.getText(),
          editor?.document.isDirty,
        ],
        [userFile, '', false],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-10 (c119-system): the existing system file opens, and nothing is written', async () => {
    const systemFile = '/etc/ssh/ssh_config';
    const before = readFileSync(systemFile, 'utf8');
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: systemFile},
      },
    ]);
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const editor = vscode.window.activeTextEditor;
      deepStrictEqual(
        [
          editor?.document.uri.fsPath,
          editor?.document.isDirty,
          readFileSync(systemFile, 'utf8'),
        ],
        [systemFile, false, before],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-11 (c119-custom): a configured value is the one file row as written, and a change is used on the next run', async () => {
    const runFolder = process.env.HARNESS_RUN_FOLDER ?? tmpdir();
    const firstValue = path.join(runFolder, 'c119-11a');
    const secondValue = '~/c119-11b';
    const script = scriptFor([
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    await commandsAfterActivation();
    await configFileSetting(firstValue);
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      await configFileSetting(secondValue);
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const [first, second] = script
        .record()
        .filter(line => line.surface === 'filePick');
      deepStrictEqual(
        [first?.question, first?.items, second?.question, second?.items],
        [
          'Edit custom SSH configuration file',
          [firstValue, 'Settings', 'Help'],
          'Edit custom SSH configuration file',
          [secondValue, 'Settings', 'Help'],
        ],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-12 (c119-create): a configured file in missing folders is created with the process defaults, and opens with the template, dirty', async () => {
    const runFolder = process.env.HARNESS_RUN_FOLDER ?? tmpdir();
    const value = path.join(runFolder, 'c119-12', 'cfg');
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: value},
      },
    ]);
    await configFileSetting(value);
    try {
      await editorSetting('insertSpaces', true, async () => {
        await editorSetting('tabSize', 4, async () => {
          await vscode.commands.executeCommand('opensshremotes.openConfigFile');
          const editor = vscode.window.activeTextEditor;
          deepStrictEqual(
            [
              editor?.document.uri.fsPath,
              editor?.document.isDirty,
              editor?.document.getText(),
              statSync(value).size,
              statSync(path.dirname(value)).mode & 0o777,
              statSync(value).mode & 0o777,
            ],
            [value, true, TEMPLATE, 0, 0o755, 0o644],
          );
        });
      });
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-13 (c119-tilde): a ~/ value creates and opens the file under the home directory, with no folder named ~', async () => {
    const value = '~/c119-13';
    const underHome = path.join(homedir(), 'c119-13');
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: value},
      },
    ]);
    await configFileSetting(value);
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      const editor = vscode.window.activeTextEditor;
      deepStrictEqual(
        [
          editor?.document.uri.fsPath,
          editor?.document.isDirty,
          existsSync(path.join(homedir(), '~')),
          existsSync(underHome),
        ],
        [underHome, true, false, true],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-16 (c119-escape): Escape in the picker creates nothing and opens nothing', async () => {
    const sshFolder = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolder, 'config');
    rmSync(sshFolder, {recursive: true, force: true});
    const before = vscode.window.activeTextEditor;
    scriptFor([
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    await commandsAfterActivation();
    await vscode.commands.executeCommand('opensshremotes.openConfigFile');
    deepStrictEqual(
      [existsSync(userFile), vscode.window.activeTextEditor],
      [false, before],
    );
  });

  it('the help commands are served (F-2004)', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.getHelp'),
      true,
    );
  });
});
