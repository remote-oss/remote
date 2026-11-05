import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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

/** Closes the editors open on `file`, discarding their unsaved changes first. */
async function closeEditorsOf(file: string): Promise<void> {
  for (const editor of [...vscode.window.visibleTextEditors]) {
    if (editor.document.uri.fsPath !== file) {
      continue;
    }
    await vscode.window.showTextDocument(editor.document);
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
}

/** How many of the window's editors are open on `file`, for a row's close check. */
function openEditorsOf(file: string): number {
  return vscode.window.visibleTextEditors.filter(
    each => each.document.uri.fsPath === file,
  ).length;
}

/**
 * Makes the window's kept document at `file` reflect the disk again: its editors are closed, and a document that
 * outlived them is re-read from the disk, or emptied when the file is gone, by a revert against it.
 */
/**
 * Makes the window's kept document at `file` reflect the disk again: its editors are closed, and a document that
 * outlived them is re-read from the disk by a revert against it, for the file that is there.
 */
async function syncDocumentOf(file: string): Promise<void> {
  await closeEditorsOf(file);
  let open: vscode.TextDocument;
  try {
    open = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  } catch {
    return;
  }
  await vscode.window.showTextDocument(open);
  await vscode.commands.executeCommand(
    'workbench.action.revertAndCloseActiveEditor',
  );
}

/** The kept document at `file` when the window has one, or the empty text when it has none. */
function keptTextOf(file: string): string {
  return (
    vscode.workspace.textDocuments
      .find(each => each.uri.fsPath === file)
      ?.getText() ?? ''
  );
}

/**
 * Leaves the window's kept document at `file`, when it has one, without text: its editors are closed, a kept copy
 * with text is emptied and saved, re-creating the empty file, and the file is removed again, so the command's own
 * creation finds the path missing and a clean document.
 */
async function clearDocumentOf(file: string): Promise<void> {
  await closeEditorsOf(file);
  let open: vscode.TextDocument;
  try {
    open = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
  } catch {
    rmSync(file, {force: true});
    return;
  }
  if (open.getText() !== '') {
    const shown = await vscode.window.showTextDocument(open);
    await shown.edit(change => {
      change.replace(
        new vscode.Range(
          0,
          0,
          open.lineCount - 1,
          open.lineAt(open.lineCount - 1).text.length,
        ),
        '',
      );
    });
    await open.save();
    await vscode.commands.executeCommand(
      'workbench.action.revertAndCloseActiveEditor',
    );
  }
  rmSync(file, {force: true});
}

/** Creates this run's signal file: a held script entry that names it answers from then on. */
function signal(name: string): void {
  const folder = process.env.REMOTE_OSS_ACCEPTANCE_SIGNALS ?? '';
  if (folder === '') {
    throw new Error(
      'REMOTE_OSS_ACCEPTANCE_SIGNALS is not set; run the tests with the harness',
    );
  }
  mkdirSync(folder, {recursive: true});
  writeFileSync(path.join(folder, name), '');
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
    await syncDocumentOf(userFile);
    const closed = openEditorsOf(userFile);
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
          closed,
          editor?.document.uri.fsPath,
          editor?.document.isDirty,
          [editor?.selection.anchor.line, editor?.selection.anchor.character],
          readFileSync(userFile, 'utf8'),
        ],
        [0, userFile, false, [0, 0], before],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-4 (c119-again): an already open user file is revealed active with its selection, and no second tab opens', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    mkdirSync(path.dirname(userFile), {recursive: true});
    writeFileSync(userFile, 'Host existing\n');
    await syncDocumentOf(userFile);
    const closed = openEditorsOf(userFile);
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
          closed,
          active?.document.uri.fsPath,
          selectionOf(active),
          active?.document.getText(),
          active?.document.isDirty,
          openEditorsOf(userFile),
        ],
        [0, userFile, before, 'Host existing\n', false, 1],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-6, AC-7 (c119-template): a created user file opens with the BR-6 template, and a save writes it', async () => {
    const sshFolder = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolder, 'config');
    rmSync(sshFolder, {recursive: true, force: true});
    await clearDocumentOf(userFile);
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await configFileSetting('');
    const measured: unknown[] = [];
    try {
      await editorSetting('insertSpaces', true, async () => {
        await editorSetting('tabSize', 4, async () => {
          measured.push(openEditorsOf(userFile), keptTextOf(userFile));
          await vscode.commands.executeCommand('opensshremotes.openConfigFile');
          const editor = vscode.window.activeTextEditor;
          measured.push([
            editor?.document.uri.fsPath,
            editor?.document.isDirty,
            readFileSync(userFile, 'utf8'),
            editor?.document.getText(),
            selectionOf(editor),
          ]);
          await settle(200);
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
            0,
            '',
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
    await clearDocumentOf(userFile);
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    const closed = openEditorsOf(userFile);
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
          closed,
          existsSync(userFile),
          readFileSync(userFile, 'utf8'),
          openEditorsOf(userFile),
        ],
        [0, true, '', 0],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-9 (c119-empty): an existing empty file opens with no template, not dirty', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    mkdirSync(path.dirname(userFile), {recursive: true});
    writeFileSync(userFile, '');
    await syncDocumentOf(userFile);
    const closed = openEditorsOf(userFile);
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
          closed,
          editor?.document.uri.fsPath,
          editor?.document.getText(),
          editor?.document.isDirty,
        ],
        [0, userFile, '', false],
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

  it('F-2203 AC-14 (c119-settings): picking Settings creates no file and shows no notification', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    rmSync(path.dirname(userFile), {recursive: true, force: true});
    const script = scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: 'Settings'},
      },
    ]);
    await configFileSetting('');
    try {
      await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      deepStrictEqual(
        [
          existsSync(userFile),
          script.record().filter(line => line.surface === 'notice').length,
        ],
        [false, 0],
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
    const script = scriptFor([
      {surface: 'filePick', match: 'SSH configuration file', answer: 'dismiss'},
    ]);
    await commandsAfterActivation();
    await vscode.commands.executeCommand('opensshremotes.openConfigFile');
    deepStrictEqual(
      [
        existsSync(userFile),
        vscode.window.activeTextEditor,
        script.record().filter(line => line.surface === 'notice').length,
      ],
      [false, before, 0],
    );
  });

  it('F-2203 AC-20 (c119-client-paths): in the SSH window the picker lists client paths, and the client file opens', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    mkdirSync(path.dirname(userFile), {recursive: true});
    writeFileSync(userFile, 'Host existing\n');
    await syncDocumentOf(userFile);
    const closed = openEditorsOf(userFile);
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
        [closed, editor?.document.uri.scheme, editor?.document.uri.fsPath],
        [0, 'file', userFile],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-21 (c119-refused-create): a user file that cannot be created refuses, creating nothing', async () => {
    const sshFolderPath = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolderPath, 'config');
    rmSync(sshFolderPath, {recursive: true, force: true});
    writeFileSync(sshFolderPath, 'a file, not a folder');
    const script = scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    const before = vscode.window.activeTextEditor;
    let rejected: unknown;
    await configFileSetting('');
    try {
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        rejected = error;
      }
      deepStrictEqual(
        [
          rejected !== undefined,
          existsSync(userFile),
          vscode.window.activeTextEditor,
          script.record().filter(line => line.surface === 'notice').length,
        ],
        [true, false, before, 0],
      );
    } finally {
      rmSync(sshFolderPath, {force: true});
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-22 (c119-unreadable): an unreadable picked file opens nothing, and the file is unchanged', async () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'c119-')), 'cfg');
    const content = 'Host locked\n';
    writeFileSync(file, content);
    chmodSync(file, 0o000);
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: file},
      },
    ]);
    const before = vscode.window.activeTextEditor;
    let rejected: unknown;
    await configFileSetting(file);
    try {
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        rejected = error;
      }
      deepStrictEqual(
        [
          rejected !== undefined,
          vscode.window.activeTextEditor,
          statSync(file).mode & 0o777,
          statSync(file).size,
        ],
        [true, before, 0o000, content.length],
      );
    } finally {
      chmodSync(file, 0o644);
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-23 (c119-relative): a relative configured value creates nothing, and the command keeps refusing', async () => {
    const value = 'relcfg/rel_config';
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: value},
      },
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: value},
      },
    ]);
    const runFolder = process.env.HARNESS_RUN_FOLDER ?? tmpdir();
    let first: unknown;
    let second: unknown;
    await configFileSetting(value);
    try {
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        first = error;
      }
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        second = error;
      }
      deepStrictEqual(
        [
          first !== undefined,
          second !== undefined,
          existsSync(path.join(homedir(), 'relcfg')),
          existsSync(path.join(runFolder, 'relcfg')),
          existsSync(path.join(process.cwd(), 'relcfg')),
        ],
        [true, true, false, false, false],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-24 (c119-directory): a picked directory opens no editor and creates nothing', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'c119-24-'));
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: folder},
      },
    ]);
    const before = vscode.window.activeTextEditor;
    let rejected: unknown;
    await configFileSetting(folder);
    try {
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        rejected = error;
      }
      deepStrictEqual(
        [
          rejected !== undefined,
          vscode.window.activeTextEditor,
          readdirSync(folder),
        ],
        [true, before, []],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-25 (c119-indent): the template indentation follows the editor settings', async () => {
    const sshFolderPath = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolderPath, 'config');
    rmSync(sshFolderPath, {recursive: true, force: true});
    await clearDocumentOf(userFile);
    const lineOne =
      '# Read more about SSH config files: https://linux.die.net/man/5/ssh_config';
    const measured: unknown[] = [openEditorsOf(userFile), keptTextOf(userFile)];
    await configFileSetting('');
    try {
      await editorSetting('insertSpaces', false, async () => {
        await editorSetting('tabSize', 2, async () => {
          scriptFor([
            {
              surface: 'filePick',
              match: 'SSH configuration file',
              answer: {label: userFile},
            },
          ]);
          await vscode.commands.executeCommand('opensshremotes.openConfigFile');
          measured.push(
            vscode.window.activeTextEditor?.document.getText() ?? '',
          );
          await vscode.commands.executeCommand(
            'workbench.action.revertAndCloseActiveEditor',
          );
        });
      });
      rmSync(userFile, {force: true});
      await clearDocumentOf(userFile);
      await editorSetting('insertSpaces', true, async () => {
        await editorSetting('tabSize', 2, async () => {
          scriptFor([
            {
              surface: 'filePick',
              match: 'SSH configuration file',
              answer: {label: userFile},
            },
          ]);
          await vscode.commands.executeCommand('opensshremotes.openConfigFile');
          measured.push(
            vscode.window.activeTextEditor?.document.getText() ?? '',
          );
          await vscode.commands.executeCommand(
            'workbench.action.revertAndCloseActiveEditor',
          );
        });
      });
      deepStrictEqual(measured, [
        0,
        '',
        [lineOne, 'Host alias', '\t\tHostName hostname', '\t\tUser user'].join(
          '\n',
        ),
        [lineOne, 'Host alias', '    HostName hostname', '    User user'].join(
          '\n',
        ),
      ]);
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-27 (c119-stateless): opening a file through the command writes no setting and no stored state', async () => {
    const userFile = path.join(homedir(), '.ssh', 'config');
    mkdirSync(path.dirname(userFile), {recursive: true});
    writeFileSync(userFile, 'Host existing\n');
    await syncDocumentOf(userFile);
    const userData = process.env.HARNESS_USER_DATA ?? '';
    const settingsFile = path.join(userData, 'User', 'settings.json');
    const extensionStorage = path.join(userData, 'globalStorage');
    function snapshot(): unknown[] {
      return [
        existsSync(settingsFile)
          ? readFileSync(settingsFile, 'utf8')
          : undefined,
        existsSync(extensionStorage)
          ? readdirSync(extensionStorage)
              .filter(name => name.startsWith('remote-oss'))
              .sort()
          : [],
      ];
    }
    const closed = openEditorsOf(userFile);
    const before = snapshot();
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: userFile},
      },
    ]);
    await vscode.commands.executeCommand('opensshremotes.openConfigFile');
    await settle(500);
    deepStrictEqual([closed, ...snapshot()], [0, ...before]);
  });

  it('F-2203 AC-28 (c119-held): the picker stays open until its answer arrives', async () => {
    scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: 'dismiss',
        after: 'c119-28',
      },
    ]);
    await configFileSetting('');
    try {
      const pending = vscode.commands.executeCommand(
        'opensshremotes.openConfigFile',
      );
      const answered = await Promise.race([
        pending.then(() => true),
        new Promise(resolve => {
          setTimeout(() => {
            resolve(false);
          }, 5000);
        }),
      ]);
      signal('c119-28');
      await pending;
      deepStrictEqual(answered, false);
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-30 (c119-eacces): a file that cannot be created refuses with EACCES, creating nothing', async () => {
    const value = '/etc/c119-30/cfg';
    const script = scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: value},
      },
    ]);
    const before = vscode.window.activeTextEditor;
    let rejected: unknown;
    await configFileSetting(value);
    try {
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        rejected = error;
      }
      deepStrictEqual(
        [
          rejected !== undefined,
          /eacces|permission/i.test(String(rejected)),
          existsSync('/etc/c119-30'),
          vscode.window.activeTextEditor,
          script.record().filter(line => line.surface === 'notice').length,
        ],
        [true, true, false, before, 0],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-31 (c119-0755): a missing user file under a 0755 .ssh is created 0600, the folder keeping 0755', async () => {
    const sshFolderPath = path.join(homedir(), '.ssh');
    const userFile = path.join(sshFolderPath, 'config');
    rmSync(sshFolderPath, {recursive: true, force: true});
    mkdirSync(sshFolderPath);
    chmodSync(sshFolderPath, 0o755);
    await clearDocumentOf(userFile);
    const closed = openEditorsOf(userFile);
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
      deepStrictEqual(
        [
          closed,
          statSync(userFile).mode & 0o777,
          statSync(sshFolderPath).mode & 0o777,
          readFileSync(userFile, 'utf8'),
        ],
        [0, 0o600, 0o755, ''],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('F-2203 AC-32 (c119-reject-message): a relative configured value is refused naming the setting and quoting the value', async () => {
    const value = 'relcfg/rel_config';
    const script = scriptFor([
      {
        surface: 'filePick',
        match: 'SSH configuration file',
        answer: {label: value},
      },
    ]);
    const runFolder = process.env.HARNESS_RUN_FOLDER ?? tmpdir();
    let rejected: unknown;
    await configFileSetting(value);
    try {
      try {
        await vscode.commands.executeCommand('opensshremotes.openConfigFile');
      } catch (error) {
        rejected = error;
      }
      deepStrictEqual(
        [
          String(rejected),
          existsSync(path.join(homedir(), value)),
          existsSync(path.join(runFolder, value)),
          script.record().filter(line => line.surface === 'notice').length,
        ],
        [
          `Error: remote.SSH.configFile must be an absolute path or start with ~/: "${value}"`,
          false,
          false,
          0,
        ],
      );
    } finally {
      await configFileSetting(HARNESS_CONFIG);
    }
  });

  it('the help commands are served (F-2004)', async () => {
    deepStrictEqual(
      (await commandsAfterActivation()).includes('opensshremotes.getHelp'),
      true,
    );
  });
});
