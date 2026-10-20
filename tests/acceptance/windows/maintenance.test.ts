import {deepStrictEqual} from 'node:assert';
import {existsSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {lexConfiguration} from 'lib-ssh';
import {redact} from 'lib-log';
import type {AppendedEntry} from '../../../tools/script-file.ts';
import {
  appendScript,
  closeWindow,
  connected,
  connectionHelpers,
  connectionLog,
  inWindow,
  onHost,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  windowState,
} from './harness.ts';
import {
  alignScript,
  closeAllButLocal,
  DATA_FOLDER,
  harnessPort,
  linesSince,
  openConnected,
  pickHost,
  runWith,
} from './maintenance.ts';

/** The question of the connection command input. */
const CONNECTION_QUESTION = 'Enter SSH Connection Command';

/** The commands that ask for a host, and so read the configuration file first. */
const HOST_COMMANDS = [
  'opensshremotes.openEmptyWindow',
  'opensshremotes.openEmptyWindowInCurrentWindow',
  'opensshremotes.cleanRemoteServer',
  'opensshremotes.cleanDevBox',
  'opensshremotes.cleanLocalServer',
];

/** The run's own configuration file. */
function configFile(): string {
  return variable('HARNESS_SSH_CONFIG');
}

/** A file of the run's folder. */
function runFile(name: string): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), name);
}

/** The line the log writes for the configuration file in use. */
function configFileLine(file: string): string {
  return `SSH configuration file in use: ${file}`;
}

/** A log line as the log writes it: it redacts a run of 32 or more word characters, which a run folder's name can hold. */
function logged(line: string): string {
  return redact(line, []);
}

/** The answer of the connection command input. */
function typedCommand(command: string): AppendedEntry {
  return {
    surface: 'textInput',
    match: CONNECTION_QUESTION,
    answer: {text: command},
  };
}

/** The answer of the configuration file pick that takes the file at `file`, whose row is its path as written. */
function pickedFile(file: string): AppendedEntry {
  return {
    surface: 'filePick',
    match: 'SSH configuration file',
    answer: {label: file},
  };
}

/** The answer of a notice whose text holds `match`. */
function noticeAnswer(
  match: string,
  answer: 'dismiss' | {button: string},
): AppendedEntry {
  return {surface: 'notice', match, answer};
}

/** The notices window `window` showed since `mark`, as their text and buttons. */
function noticesSince(mark: number, window: string): Array<[string, string[]]> {
  return linesSince(mark, window)
    .filter(line => line.surface === 'notice')
    .map(line => [line.question, line.buttons ?? []]);
}

/** What `command` rejects with in window `window`, or nothing when it succeeds. */
async function failureOf(
  window: string,
  command: string,
): Promise<string | undefined> {
  try {
    await inWindow(window, command);
    return undefined;
  } catch (caught) {
    return String(caught);
  }
}

/** Runs `command` in window `window` with `answers` scripted for it; gives the mark it started from and how it failed. */
async function runFailingWith(
  window: string,
  command: string,
  answers: readonly AppendedEntry[],
): Promise<{mark: number; failure: string | undefined}> {
  alignScript(window);
  appendScript(answers.map(answer => ({...answer, window})));
  const mark = recordLines().length;
  return {mark, failure: await failureOf(window, command)};
}

/** The reader's text for the problem of the configuration file text `text`. */
function readerText(text: string): string {
  const lexed = lexConfiguration(text);
  if (!('parseError' in lexed)) {
    throw new Error('the text has no problem to read');
  }
  return lexed.parseError;
}

describe('Add New SSH Host and the server maintenance commands (card coverage-30)', function () {
  this.timeout(900_000);

  let savedConfig = '';
  let savedSettings: string | undefined;

  before(async () => {
    await closeAllButLocal();
    savedConfig = readFileSync(configFile(), 'utf8');
    savedSettings = readUserSettings();
  });

  after(async () => {
    writeFileSync(configFile(), savedConfig);
    restoreUserSettings(savedSettings);
    // The Kill and Uninstall rows end the harness account's server; the files after this one need one on the host.
    await openConnected('mt1');
    await closeWindow('mt1');
  });

  it('F-2201 AC-15: Add New SSH Host writes the block at the top of the picked file, and its notice offers Open Config and Connect', async () => {
    const before = readFileSync(configFile(), 'utf8');
    const mark = await runWith('local', 'opensshremotes.addNewSshHost', [
      typedCommand('ssh harness@added-one'),
      pickedFile(configFile()),
      noticeAnswer('Host added!', {button: 'Open Config'}),
    ]);
    deepStrictEqual(
      [readFileSync(configFile(), 'utf8'), noticesSince(mark, 'local')],
      [
        `Host added-one\n  HostName added-one\n  User harness\n\n${before}`,
        [['Host added!', ['Open Config', 'Connect']]],
      ],
    );
  });

  it('F-2201 AC-16, AC-39: the Open Config button shows the file in a preview editor', async () => {
    const state = await windowState('local');
    deepStrictEqual(state.activeTab, {
      uri: pathToFileURL(configFile()).toString(),
      preview: true,
    });
    await inWindow('local', 'workbench.action.closeActiveEditor');
    writeFileSync(configFile(), savedConfig);
  });

  it('F-2201 AC-19: with a configuration file that does not parse, each command that asks for a host fails with the reader’s text and asks no host pick', async () => {
    const broken = 'Host "unterminated\n  HostName 127.0.0.1\n';
    writeFileSync(runFile('broken_config'), broken);
    await userSettings({'remote.SSH.configFile': runFile('broken_config')});
    const reader = readerText(broken);
    const results: Array<[string, boolean, boolean]> = [];
    for (const command of HOST_COMMANDS) {
      const mark = recordLines().length;
      const failure = await failureOf('local', command);
      results.push([
        command,
        linesSince(mark, 'local').some(line => line.surface === 'hostPick'),
        failure?.includes(command) === true && failure.includes(reader),
      ]);
    }
    deepStrictEqual(
      results,
      HOST_COMMANDS.map(command => [command, false, true]),
    );
  });

  it('F-2201 AC-20: Add New SSH Host on a file that does not parse fails with the reader’s text, leaves the file as it was and shows no Host added!', async () => {
    const file = runFile('broken_config');
    const before = readFileSync(file, 'utf8');
    const {mark, failure} = await runFailingWith(
      'local',
      'opensshremotes.addNewSshHost',
      [typedCommand('ssh harness@added-two'), pickedFile(file)],
    );
    const lines = linesSince(mark, 'local');
    deepStrictEqual(
      [
        lines.some(line => line.surface === 'filePick'),
        failure?.includes(readerText(before)) === true,
        readFileSync(file, 'utf8'),
        lines.some(
          line => line.surface === 'notice' && line.question === 'Host added!',
        ),
      ],
      [true, true, before, false],
    );
    restoreUserSettings(savedSettings);
    await userSettings({});
  });

  it('F-2201 AC-33: Kill VS Code Server on a host only the run’s file defines names that file in the log', async () => {
    const logMark = connectionLog().length;
    const mark = await runWith('local', 'opensshremotes.cleanRemoteServer', [
      pickHost('harness'),
      noticeAnswer('Killed VS Code Server on harness.', 'dismiss'),
    ]);
    deepStrictEqual(
      [
        noticesSince(mark, 'local'),
        connectionLog()
          .slice(logMark)
          .includes(logged(configFileLine(configFile()))),
      ],
      [[['Killed VS Code Server on harness.', ['Open Logs']]], true],
    );
  });

  it('F-2201 AC-33 (uninstall): Uninstall VS Code Server from a host only the run’s file defines names that file in the log and leaves no server', async () => {
    const logMark = connectionLog().length;
    await runWith('local', 'opensshremotes.cleanDevBox', [pickHost('harness')]);
    deepStrictEqual(
      [
        connectionLog()
          .slice(logMark)
          .includes(logged(configFileLine(configFile()))),
        (
          await onHost(
            'sh',
            '-c',
            `ls '${DATA_FOLDER}/bin' 2>/dev/null || true`,
          )
        ).trim(),
      ],
      [true, ''],
    );
  });

  it('F-2102 AC-18: the Add New row of the Kill Local picker asks for a connection command and changes nothing of the window’s connection', async () => {
    await openConnected('mt1');
    const helpers = await connectionHelpers();
    const mark = await runWith('mt1', 'opensshremotes.cleanLocalServer', [
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: {label: '$(plus) Add New SSH Host...'},
      },
      {
        surface: 'textInput',
        match: CONNECTION_QUESTION,
        answer: 'dismiss',
      },
    ]);
    deepStrictEqual(
      [
        linesSince(mark, 'mt1')
          .filter(line => line.surface === 'textInput')
          .map(line => line.question),
        await connectionHelpers(),
        await connected('mt1'),
      ],
      [[CONNECTION_QUESTION], helpers, true],
    );
    await closeWindow('mt1');
  });

  describe('a host that asks the host-key question', () => {
    const knownHosts = runFile('known_hosts_kill_ask');

    beforeEach(() => {
      const block = [
        'Host kill-ask',
        '  HostName 127.0.0.1',
        `  Port ${harnessPort()}`,
        '  User harness',
        `  IdentityFile ${runFile('id_ed25519')}`,
        '  IdentitiesOnly yes',
        '  IdentityAgent none',
        '  StrictHostKeyChecking ask',
        `  UserKnownHostsFile ${knownHosts}`,
        '',
      ].join('\n');
      writeFileSync(configFile(), `${savedConfig}\n${block}`);
      rmSync(knownHosts, {force: true});
    });

    afterEach(() => {
      writeFileSync(configFile(), savedConfig);
      rmSync(knownHosts, {force: true});
    });

    it('F-2305 AC-32: Cancel in the fingerprint question kills nothing, shows the failure notice and records no key', async () => {
      const mark = await runWith('local', 'opensshremotes.cleanRemoteServer', [
        pickHost('kill-ask'),
        {surface: 'pick', match: 'fingerprint', answer: 'no'},
        noticeAnswer('Failed to kill VS Code Server on kill-ask.', 'dismiss'),
      ]);
      deepStrictEqual(
        [
          linesSince(mark, 'local').filter(line => line.surface === 'pick')
            .length,
          noticesSince(mark, 'local'),
          existsSync(knownHosts) ? readFileSync(knownHosts, 'utf8') : '',
        ],
        [
          1,
          [['Failed to kill VS Code Server on kill-ask.', ['Open Logs']]],
          '',
        ],
      );
    });

    it('F-2305 AC-36: Continue in the fingerprint question records the host key and the kill goes on to its own result', async () => {
      const mark = await runWith('local', 'opensshremotes.cleanRemoteServer', [
        pickHost('kill-ask'),
        {surface: 'pick', match: 'fingerprint', answer: 'yes'},
        noticeAnswer('Killed VS Code Server on kill-ask.', 'dismiss'),
      ]);
      const hostKey = (await onHost('cat', '/etc/ssh/ssh_host_ed25519_key.pub'))
        .trim()
        .split(/\s+/)
        .slice(0, 2);
      const recorded = readFileSync(knownHosts, 'utf8')
        .split('\n')
        .filter(line => line !== '');
      deepStrictEqual(
        [
          recorded.length,
          recorded[0]?.split(/\s+/).slice(-2),
          noticesSince(mark, 'local').map(([text]) => text),
        ],
        [1, hostKey, ['Killed VS Code Server on kill-ask.']],
      );
    });
  });
});
