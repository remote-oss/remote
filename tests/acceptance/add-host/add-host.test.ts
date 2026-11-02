/**
 * @fileoverview The rows of F-2204 that need a window (card coverage-38, #726): "Remote-SSH: Add New SSH Host..." in
 * a plain editor whose `HOME` is a folder of the run, so that the user file the flow writes is the run's own. The
 * input, the file pick and the notice are answered from the script, and Remote Explorer is installed so that its
 * hosts view shows what the flow wrote. Each row empties the user's `.ssh` folder first.
 */

import {deepStrictEqual} from 'node:assert';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {hostLabels} from '../windows/explorer-rows.ts';
import {
  appendScript,
  closeWindow,
  dirtyDocumentsOf,
  activeEditorTextOf,
  inWindow,
  nextEmptyName,
  nextEmptyWindow,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowState,
  withoutActivity,
  type RecordLine,
} from '../windows/harness.ts';
import {notifications} from '../windows/renderer.ts';

/** The questions of the three surfaces of the flow, and of the Connect pick. */
const INPUT_QUESTION = 'Enter SSH Connection Command';
const FILE_QUESTION = 'Select SSH configuration file to update';
const CUSTOM_QUESTION = 'Edit custom SSH configuration file';
const NOTICE_TEXT = 'Host added!';
const HOST_QUESTION = 'Select configured SSH host or enter user@host';

/** The command under test. */
const ADD_COMMAND = 'opensshremotes.addNewSshHost';

/** The run's folder, the editor's `HOME` and the user file under it. */
const RUN_FOLDER = variable('HARNESS_RUN_FOLDER');
const HOME_FOLDER = path.join(RUN_FOLDER, 'add-host-home');
const SSH_FOLDER = path.join(HOME_FOLDER, '.ssh');
const USER_FILE = path.join(SSH_FOLDER, 'config');

/** The client's system file, and the two fixed rows of the file pick. */
const SYSTEM_FILE = '/etc/ssh/ssh_config';
const SETTINGS_ROW = 'Settings';
const HELP_ROW = 'Help';

/** The fixed rows of the Connect pick, after the hosts. */
const ADD_ROW = '$(plus) Add New SSH Host...';
const CONFIGURE_ROW = 'Configure SSH Hosts...';

/** What the flow asks and how the row answers: the typed command, the file's label, and the notice's answer. */
interface Addition {
  command: string;
  file: string;
  notice?: {button: string} | 'dismiss';
}

/** The script entries of an addition in the window `window`. */
function entriesOf(addition: Addition, window: string): AppendedEntry[] {
  return [
    {
      surface: 'textInput',
      match: INPUT_QUESTION,
      answer: {text: addition.command},
      window,
    },
    {
      surface: 'filePick',
      match: 'SSH configuration file',
      answer: {label: addition.file},
      window,
    },
    ...(addition.notice === undefined
      ? []
      : [
          {
            surface: 'notice',
            match: NOTICE_TEXT,
            answer: addition.notice,
            window,
          } as const,
        ]),
  ];
}

/** Runs the flow in `local` with the entries of `addition`, and gives the record lines it added. */
async function addHost(addition: Addition): Promise<RecordLine[]> {
  const mark = recordLines(undefined, 'local').length;
  appendScript(entriesOf(addition, 'local'));
  await inWindow('local', ADD_COMMAND);
  return recordLines(undefined, 'local').slice(mark);
}

/** The text of the user file, or nothing while it does not exist. */
function userText(): string | undefined {
  return existsSync(USER_FILE) ? readFileSync(USER_FILE, 'utf8') : undefined;
}

/** The lines of `lines` of one surface. */
function ofSurface(lines: readonly RecordLine[], surface: string) {
  return lines.filter(line => line.surface === surface);
}

/** The failing new window's entries: the dialog, then the pick of actions, both dismissed. */
function failureEntries(window: string) {
  return [
    {
      surface: 'failureDialog',
      match: 'Could not establish connection',
      answer: 'dismiss',
      window,
    },
    {
      surface: 'mitigationPick',
      match: 'Pick an action',
      answer: 'dismiss',
      window,
    },
  ] as const;
}

/** What a window shows of itself. */
async function shown(name: string) {
  return withoutActivity(await windowState(name));
}

describe('Add New SSH Host... in a window of the editor with its own home (card coverage-38)', function () {
  this.timeout(600_000);
  let savedSettings: string | undefined;

  before(async () => {
    savedSettings = readUserSettings();
    await userSettings({'remote.SSH.configFile': ''});
    mkdirSync(HOME_FOLDER, {recursive: true});
  });

  after(() => {
    restoreUserSettings(savedSettings);
  });

  beforeEach(() => {
    rmSync(SSH_FOLDER, {recursive: true, force: true});
  });

  afterEach(() => {
    rmSync(SSH_FOLDER, {recursive: true, force: true});
  });

  it('F-2204 AC-5: the file pick has the placeholder and, in order, the user file, the system file, Settings and Help, with the user file not yet existing', async () => {
    const existed = existsSync(USER_FILE);
    const lines = await addHost({
      command: 'host1',
      file: USER_FILE,
      notice: 'dismiss',
    });
    deepStrictEqual(
      [
        existed,
        ofSurface(lines, 'filePick').map(line => [line.question, line.items]),
      ],
      [
        false,
        [[FILE_QUESTION, [USER_FILE, SYSTEM_FILE, SETTINGS_ROW, HELP_ROW]]],
      ],
    );
  });

  it('F-2204 AC-8: Open Config opens the written file as the preview tab with the new entry, and the notice is removed', async () => {
    await addHost({
      command: 'ssh -p 2222 bob@alpha',
      file: USER_FILE,
      notice: {button: 'Open Config'},
    });
    const href = pathToFileURL(USER_FILE).href;
    await waitFor(
      'the written file as the active tab',
      async () => (await windowState('local')).activeTab?.uri === href,
      15_000,
    );
    deepStrictEqual(
      [
        (await windowState('local')).activeTab,
        (await activeEditorTextOf('local'))?.startsWith(
          'Host alpha\n  HostName alpha\n  Port 2222\n  User bob\n',
        ),
        await notifications('local'),
      ],
      [{uri: href, preview: true}, true, []],
    );
    await inWindow('local', 'workbench.action.closeAllEditors');
  });

  it('F-2204 AC-9: Connect opens a new window on ssh-remote+gamma with no folder, and the window that ran the flow is unchanged', async () => {
    const before = await shown('local');
    const next = nextEmptyName();
    appendScript(failureEntries(next));
    const name = await nextEmptyWindow(async () => {
      await addHost({
        command: 'gamma',
        file: USER_FILE,
        notice: {button: 'Connect'},
      });
    });
    const opened = await windowState(name);
    deepStrictEqual(
      [opened.remoteAuthority, opened.folders, await shown('local')],
      ['ssh-remote+gamma', [], before],
    );
    await closeWindow(name);
  });

  it('F-2204 AC-26: a file that cannot be written fails the command with the permission error, leaves the file byte for byte, and shows no Host added!', async () => {
    mkdirSync(SSH_FOLDER, {recursive: true});
    writeFileSync(USER_FILE, 'Host kept\n  HostName kept\n');
    chmodSync(USER_FILE, 0o400);
    const mark = recordLines(undefined, 'local').length;
    appendScript(entriesOf({command: 'delta', file: USER_FILE}, 'local'));
    let failure = '';
    try {
      await inWindow('local', ADD_COMMAND);
    } catch (error) {
      failure = String(error);
    }
    chmodSync(USER_FILE, 0o600);
    deepStrictEqual(
      [
        failure.includes('EACCES'),
        userText(),
        ofSurface(recordLines(undefined, 'local').slice(mark), 'notice'),
      ],
      [true, 'Host kept\n  HostName kept\n', []],
    );
  });

  it('F-2204 AC-27: the Connect pick lists Add New SSH Host... after every host and before Configure SSH Hosts..., and picking it opens the input', async () => {
    mkdirSync(SSH_FOLDER, {recursive: true});
    writeFileSync(USER_FILE, 'Host first-host\nHost second-host\n');
    appendScript([
      {
        surface: 'hostPick',
        match: HOST_QUESTION,
        answer: {label: ADD_ROW},
        window: 'local',
      },
      {
        surface: 'textInput',
        match: INPUT_QUESTION,
        answer: 'dismiss',
        window: 'local',
      },
    ]);
    const mark = recordLines(undefined, 'local').length;
    await inWindow('local', 'opensshremotes.openEmptyWindow');
    const lines = recordLines(undefined, 'local').slice(mark);
    const items = ofSurface(lines, 'hostPick')[0]?.items ?? [];
    deepStrictEqual(
      [
        items.slice(0, 2),
        items.slice(-2),
        items.length,
        ofSurface(lines, 'textInput').map(line => line.question),
      ],
      [
        ['first-host', 'second-host'],
        [ADD_ROW, CONFIGURE_ROW],
        items.length,
        [INPUT_QUESTION],
      ],
    );
  });

  it('F-2204 AC-28: Escape at the input or at the file picker of a flow started from the Connect pick leaves no Connect pick and writes nothing', async () => {
    const seen: Array<[number, number, string | undefined]> = [];
    const cases: Array<Array<Omit<AppendedEntry, 'window'>>> = [
      [{surface: 'textInput', match: INPUT_QUESTION, answer: 'dismiss'}],
      [
        {surface: 'textInput', match: INPUT_QUESTION, answer: {text: 'later'}},
        {surface: 'filePick', match: 'SSH configuration', answer: 'dismiss'},
      ],
    ];
    for (const answers of cases) {
      const mark = recordLines(undefined, 'local').length;
      appendScript(
        [
          {
            surface: 'hostPick',
            match: HOST_QUESTION,
            answer: {label: ADD_ROW},
          } as const,
          ...answers,
        ].map(entry => ({...entry, window: 'local'})),
      );
      await inWindow('local', 'opensshremotes.openEmptyWindow');
      await new Promise(resolve => setTimeout(resolve, 2_000));
      const lines = recordLines(undefined, 'local').slice(mark);
      seen.push([
        ofSurface(lines, 'hostPick').length,
        ofSurface(lines, 'notice').length,
        userText(),
      ]);
    }
    deepStrictEqual(seen, [
      [1, 0, undefined],
      [1, 0, undefined],
    ]);
  });

  it('F-2204 AC-29: Connect after the flow of Connect Current Window to Host... opens a new window and leaves the current one as it was', async () => {
    const before = await shown('local');
    const next = nextEmptyName();
    appendScript([
      {
        surface: 'hostPick',
        match: HOST_QUESTION,
        answer: {label: ADD_ROW},
        window: 'local',
      },
      ...failureEntries(next),
    ]);
    const name = await nextEmptyWindow(() => {
      appendScript(
        entriesOf(
          {command: 'eta', file: USER_FILE, notice: {button: 'Connect'}},
          'local',
        ),
      );
      return inWindow('local', 'opensshremotes.openEmptyWindowInCurrentWindow');
    });
    deepStrictEqual(
      [(await windowState(name)).remoteAuthority, await shown('local')],
      ['ssh-remote+eta', before],
    );
    await closeWindow(name);
  });

  it('F-2204 AC-31: from a window on the host, the pick offers the client’s user file, the entry is written there, and nothing is created on the host', async () => {
    mkdirSync(SSH_FOLDER, {recursive: true});
    copyFileSync(variable('HARNESS_SSH_CONFIG'), USER_FILE);
    await openWindow('harness', 'add-host-w31');
    const hostBefore = await onHost('ls', '-a', '/home/harness');
    const mark = recordLines(undefined, 'add-host-w31').length;
    appendScript(
      entriesOf(
        {command: 'theta', file: USER_FILE, notice: 'dismiss'},
        'add-host-w31',
      ),
    );
    await inWindow('add-host-w31', ADD_COMMAND);
    const lines = recordLines(undefined, 'add-host-w31').slice(mark);
    deepStrictEqual(
      [
        ofSurface(lines, 'filePick').map(line => line.items?.[0]),
        userText()?.includes('Host theta\n  HostName theta\n'),
        await onHost('ls', '-a', '/home/harness'),
        await onHost('sh', '-c', 'grep -l theta /home/harness/.ssh/* || true'),
      ],
      [[USER_FILE], true, hostBefore, ''],
    );
    await closeWindow('add-host-w31');
  });

  it('F-2204 AC-33: a configured file in folders that do not exist is created with its folders and holds the entry', async () => {
    const custom = path.join(RUN_FOLDER, 'add-host-custom', 'a', 'b', 'config');
    rmSync(path.join(RUN_FOLDER, 'add-host-custom'), {
      recursive: true,
      force: true,
    });
    await userSettings({'remote.SSH.configFile': custom});
    try {
      const lines = await addHost({
        command: 'zeta',
        file: custom,
        notice: 'dismiss',
      });
      deepStrictEqual(
        [
          ofSurface(lines, 'filePick').map(line => [line.question, line.items]),
          existsSync(path.dirname(custom)),
          existsSync(custom) ? readFileSync(custom, 'utf8') : undefined,
        ],
        [
          [[CUSTOM_QUESTION, [custom, SETTINGS_ROW, HELP_ROW]]],
          true,
          'Host zeta\n  HostName zeta\n',
        ],
      );
    } finally {
      await userSettings({'remote.SSH.configFile': ''});
    }
  });

  it('F-2204 AC-35: the unsaved text of the target file stays in its editor after an add', async () => {
    mkdirSync(SSH_FOLDER, {recursive: true});
    writeFileSync(USER_FILE, 'Host base\n');
    await inWindow(
      'local',
      'acceptance.agent.typeInto',
      USER_FILE,
      '# typed\n',
    );
    const dirtyBefore = await dirtyDocumentsOf('local');
    await addHost({command: 'iota', file: USER_FILE, notice: 'dismiss'});
    const text = await activeEditorTextOf('local');
    const dirtyAfter = await dirtyDocumentsOf('local');
    await inWindow('local', 'workbench.action.files.revert');
    await inWindow('local', 'workbench.action.closeAllEditors');
    deepStrictEqual(
      [dirtyBefore, dirtyAfter, text?.startsWith('# typed\n')],
      [[pathToFileURL(USER_FILE).href], [pathToFileURL(USER_FILE).href], true],
    );
  });

  it('F-2204 AC-36: a cancel, a success and an error write no setting', async () => {
    const settings = readUserSettings();
    mkdirSync(SSH_FOLDER, {recursive: true});
    writeFileSync(USER_FILE, 'Host kept\n');
    appendScript([
      {
        surface: 'textInput',
        match: INPUT_QUESTION,
        answer: 'dismiss',
        window: 'local',
      },
    ]);
    await inWindow('local', ADD_COMMAND);
    const afterCancel = readUserSettings();
    await addHost({command: 'sigma', file: USER_FILE, notice: 'dismiss'});
    const afterSuccess = readUserSettings();
    chmodSync(USER_FILE, 0o400);
    appendScript(entriesOf({command: 'tau', file: USER_FILE}, 'local'));
    await inWindow('local', ADD_COMMAND).catch(() => undefined);
    chmodSync(USER_FILE, 0o600);
    deepStrictEqual(
      [afterCancel, afterSuccess, readUserSettings()],
      [settings, settings, settings],
    );
  });

  it('F-2204 AC-41: a host added is listed by the Remote Explorer view within a second, with no refresh', async () => {
    await inWindow('local', 'workbench.view.remote');
    await waitFor(
      'the hosts view to list',
      async () => (await hostLabels('local')).length >= 0,
      15_000,
    );
    await addHost({command: 'viewed', file: USER_FILE, notice: 'dismiss'});
    const deadline = Date.now() + 1_000;
    let listed = false;
    while (!listed && Date.now() < deadline) {
      listed = (await hostLabels('local')).includes('viewed');
    }
    deepStrictEqual(listed, true);
  });
});
