import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  editorLogsFolder,
  hostPassword,
  inWindow,
  nextEmptyWindow,
  onHost,
  openWindow,
  recordLines,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  signal,
  startInWindow,
  userSettings,
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  chooseQuickPickRow,
  dialogOf,
  notifications,
  outputChannelOf,
  outputPanelFocused,
  pressEscape,
  quickPickOf,
  settingControlOf,
  settingControlOptions,
  settingRow,
  terminalText,
} from '../windows/renderer.ts';
import {
  closeAllButLocal,
  dismissals,
  freshHost,
  INSTALL_MILLISECONDS,
  openConnected,
} from '../windows/maintenance.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';
import {paletteItems, runFromPalette} from '../windows/palette.ts';

/** What names a WebSocket compression in a line of a log. */
const COMPRESSION =
  'websocket.*compress|compress.*websocket|permessage-deflate';

/** The folders of the host that hold the server's logs: its own folder, with the server's log as a dot-file and its data folder's logs, and the state folder of the server's processes. */
const HOST_LOG_FOLDERS = [
  '/home/harness/.vscodium-server-insiders',
  '/home/harness/.local/state',
];

/** The log files of the client's editor logs folder, whatever their depth. */
function logFiles(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return logFiles(file);
    }
    return file.endsWith('.log') ? [file] : [];
  });
}

/** The last line of the troubleshooting terminal: STR:S125 and the "Output Log..." link. */
const S125_LINE = 'See verbose information in the Output Log...';

/** The rule of 40 dashes that ends a resolve step. */
const SEPARATOR_LINE = '-'.repeat(40);

describe('the logs of a connected SSH window (card connect-125, #1600)', function () {
  this.timeout(300_000);

  it('F-2508 AC-33 (c125-logs): the resolver returned a managed connection, and no client or server log mentions WebSocket compression', async () => {
    await openWindow('harness', 'c125-logs');
    try {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const clientFiles = logFiles(editorLogsFolder());
      const clientMentions = clientFiles.filter(file =>
        new RegExp(COMPRESSION, 'i').test(readFileSync(file, 'utf8')),
      );
      const folders = HOST_LOG_FOLDERS.join(' ');
      const hostFiles = (
        await onHost(
          'sh',
          '-c',
          `find ${folders} -type f -name '*.log' 2>/dev/null`,
        )
      )
        .split('\n')
        .filter(line => line !== '');
      const hostMentions = (
        await onHost(
          'sh',
          '-c',
          `grep -rliE --include='*.log' '${COMPRESSION}' ${folders} 2>/dev/null || true`,
        )
      ).trim();
      deepStrictEqual(
        [
          connectionLog().some(line =>
            line.startsWith('Resolved ssh-remote+harness to local port'),
          ),
          clientFiles.length > 0,
          hostFiles.length > 0,
          clientMentions,
          hostMentions,
        ],
        [true, true, true, [], ''],
      );
    } finally {
      await closeWindow('c125-logs').catch(() => undefined);
    }
  });

  it('F-2003 AC-11 (c139-order): BR-6 item 7, ssh’s host-key line comes before the password question, the question before its masked answer, and both before "Authenticated to"', async () => {
    appendScript([
      {
        surface: 'maskedInput',
        match: 'Enter password',
        answer: {text: hostPassword()},
        window: 'c139',
      },
    ]);
    await openWindow('password', 'c139');
    try {
      await connectedWithin('c139', 60_000);
      const lines = connectionLog();
      const start = lines.findLastIndex(line =>
        line.startsWith('Resolving ssh-remote+password'),
      );
      const window = lines.slice(start);
      function position(matches: (line: string) => boolean): number {
        return window.findIndex(matches);
      }
      const order = [
        position(line => line.startsWith('[ssh] debug1: Server host key')),
        position(
          line => line.startsWith('prompt: ') && line.includes('password'),
        ),
        position(line => line === 'prompt answered: ***'),
        position(line => line.startsWith('[ssh] Authenticated to')),
      ];
      deepStrictEqual(
        [
          order.every(index => index >= 0),
          order.every(
            (index, place) => place === 0 || index > (order[place - 1] ?? 0),
          ),
          window.some(line => line.includes(hostPassword())),
        ],
        [true, true, false],
      );
    } finally {
      await closeWindow('c139');
    }
  });
});


describe('the Remote - SSH log: the command surface (card coverage-121)', function () {
  this.timeout(300_000);
  beforeEach(closeAllButLocal);

  /** A fresh empty window for the row to act on. */
  async function freshWindow(): Promise<string> {
    return nextEmptyWindow(() =>
      inWindow('local', 'workbench.action.newWindow'),
    );
  }

  it('F-2003 AC-1 (c121-listed): "Remote-SSH: Show Log" is listed in the Command Palette, and running it shows the channel', async () => {
    const name = await freshWindow();
    try {
      const listed = await paletteItems(name, 'Remote-SSH: Show Log');
      await runFromPalette(name, 'Remote-SSH: Show Log');
      await windowState(name);
      deepStrictEqual(
        {
          listed: listed.includes('Remote-SSH: Show Log'),
          channel: await outputChannelOf(name),
        },
        {listed: true, channel: 'Remote - SSH'},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2003 AC-2 (c121-panel): Show Log opens the panel on the Output view with the channel selected and the keyboard focus in it', async () => {
    const name = await freshWindow();
    try {
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      deepStrictEqual(
        {
          channel: await outputChannelOf(name),
          focused: await outputPanelFocused(name),
        },
        {channel: 'Remote - SSH', focused: true},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2003 AC-4 (c121-again): with the channel already shown, Show Log again changes nothing visible and shows no notification, dialog or pick', async () => {
    const name = await freshWindow();
    try {
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      const state = windowEvents(name)
        .filter(each => each.event === 'state')
        .at(-1);
      deepStrictEqual(
        {
          channel: state?.visibleOutputChannel,
          dialog: await dialogOf(name),
          notices: await notifications(name),
          quickPick: await quickPickOf(name),
        },
        {
          channel: 'Remote - SSH',
          dialog: undefined,
          notices: [],
          quickPick: undefined,
        },
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2003 AC-7 (c121-stays-hidden): a successful connection leaves the panel hidden', async () => {
    await openWindow('harness', 'c121-hidden');
    try {
      await connectedWithin('c121-hidden', 60_000);
      const states = windowEvents('c121-hidden').filter(
        each => each.event === 'state',
      );
      deepStrictEqual(
        [
          states.every(
            each =>
              each.visibleOutputChannel === undefined ||
              each.visibleOutputChannel === null,
          ),
          await outputChannelOf('c121-hidden'),
        ],
        [true, undefined],
      );
    } finally {
      await closeWindow('c121-hidden').catch(() => undefined);
    }
  });

  it('F-2003 AC-8 (c121-refused-panel): a refused connection with no detected issues shows the panel on the Remote - SSH channel', async () => {
    await openWindow('refused', 'c121-refused');
    try {
      await waitFor(
        'the failure dialog of c121-refused',
        () => recordLines('failureDialog', 'c121-refused').length > 0,
        300_000,
      );
      await waitFor(
        'the panel of c121-refused on the Remote - SSH channel',
        async () => (await outputChannelOf('c121-refused')) === 'Remote - SSH',
        60_000,
      );
      deepStrictEqual(await outputChannelOf('c121-refused'), 'Remote - SSH');
    } finally {
      await closeWindow('c121-refused').catch(() => undefined);
    }
  });

  it('F-2003 AC-15 (c121-out-of-enum): a log level outside the enum connects, and the extension shows no error notification or dialog', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({'remote.SSH.logLevel': 'info'});
      await openWindow('harness', 'c121-enum');
      try {
        await connectedWithin('c121-enum', 60_000);
        deepStrictEqual(
          {
            dialog: await dialogOf('c121-enum'),
            notices: await notifications('c121-enum'),
          },
          {dialog: undefined, notices: []},
        );
      } finally {
        await closeWindow('c121-enum').catch(() => undefined);
      }
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2003 AC-25 (c121-first-lines): a fresh window\'s channel opens with the log level, the editor version, the extension\'s name and version, and the client platform and architecture', async () => {
    const name = await freshWindow();
    try {
      const mark = connectionLog().length;
      await inWindow(name, 'opensshremotes.showLog');
      await waitFor(
        `the opening lines of ${name}`,
        () => connectionLog().length > mark,
        60_000,
      );
      const [level, editor, extension, platform] = connectionLog().slice(
        mark,
      );
      const levelText = level ?? '';
      const editorText = editor ?? '';
      const extensionText = extension ?? '';
      const platformText = platform ?? '';
      deepStrictEqual(
        [
          levelText.includes('Log level'),
          editorText.includes('Editor version'),
          extensionText.includes('remote-ssh'),
          platformText.includes('linux') &&
            (platformText.includes('x64') || platformText.includes('arm64')),
        ],
        [true, true, true, true],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  /** The last non-empty line of the active terminal of window `name`, trimmed at the end; empty when it shows none. */
  async function troubleLine(name: string): Promise<string> {
    const lines = (await terminalText(name))
      .split('\n')
      .map(line => line.trimEnd())
      .filter(line => line !== '');
    return lines.at(-1) ?? '';
  }

  /** Waits until the quick pick of window `name` is open, whatever it lists. */
  async function pickOpen(name: string): Promise<void> {
    await waitFor(
      `the quick pick of ${name}`,
      async () => (await quickPickOf(name)) !== undefined,
      15_000,
    );
  }

  it('F-2003 AC-3 (c121-show-anywhere): with the Output on another channel, the Terminal tab in front, or the editor focused, Show Log brings the panel back on the Remote - SSH channel with the focus in it', async () => {
    const name = await freshWindow();
    const seen: Array<{channel: string | undefined; focused: boolean}> = [];
    try {
      // The Output view shows another channel: the core pick switches it away from ours.
      await inWindow(name, 'opensshremotes.showLog');
      await startInWindow(name, 'workbench.action.output.showOutputChannels');
      await pickOpen(name);
      const channels = (await quickPickOf(name))?.items ?? [];
      const other =
        channels.find(each => each !== 'Remote - SSH') ?? channels.at(-1);
      if (other === undefined) {
        throw new Error(`the channel pick of ${name} lists no channel`);
      }
      await chooseQuickPickRow(name, other);
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      seen.push({
        channel: await outputChannelOf(name),
        focused: await outputPanelFocused(name),
      });
      // The Terminal tab is in front.
      await inWindow(name, 'workbench.action.terminal.new');
      await new Promise(resolve => setTimeout(resolve, 2_000));
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      seen.push({
        channel: await outputChannelOf(name),
        focused: await outputPanelFocused(name),
      });
      // The editor is focused.
      await inWindow(name, 'workbench.action.files.newUntitledFile');
      await inWindow(name, 'workbench.action.focusActiveEditorGroup');
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      seen.push({
        channel: await outputChannelOf(name),
        focused: await outputPanelFocused(name),
      });
      deepStrictEqual(seen, [
        {channel: 'Remote - SSH', focused: true},
        {channel: 'Remote - SSH', focused: true},
        {channel: 'Remote - SSH', focused: true},
      ]);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2003 AC-5 (c121-before-activation): in a fresh window the core channel pick lists no Remote - SSH, and Show Log activates the extension and shows the channel', async () => {
    const name = await freshWindow();
    try {
      await startInWindow(name, 'workbench.action.output.showOutputChannels');
      await pickOpen(name);
      const listed = (await quickPickOf(name))?.items ?? [];
      await pressEscape(name);
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      deepStrictEqual(
        {
          listed: listed.includes('Remote - SSH'),
          channel: await outputChannelOf(name),
        },
        {listed: false, channel: 'Remote - SSH'},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2003 AC-6 (c121-show-log-link): the Show log link of the forwarding refusal notification runs Show Log, the panel comes up on the Remote - SSH channel, and the notification stays open', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const name = 'c121-link';
      appendScript([
        {
          // Held, so the notification stays open until the row releases it.
          surface: 'notice',
          match: 'Failed to set up',
          answer: 'dismiss',
          after: 'c121-link-free',
          window: name,
        },
        ...dismissals(name),
      ]);
      await openWindow('noforward', name);
      try {
        await waitFor(
          'the forwarding refusal notification of c121-link',
          async () =>
            (await notifications(name)).some(each => each.includes('Show log')),
          180_000,
        );
        // The link runs the command it names, which the row runs, as the editor does for a click.
        await inWindow(name, 'opensshremotes.showLog');
        await windowState(name);
        deepStrictEqual(
          {
            channel: await outputChannelOf(name),
            focused: await outputPanelFocused(name),
            still: (await notifications(name)).some(each =>
              each.includes('Show log'),
            ),
          },
          {channel: 'Remote - SSH', focused: true, still: true},
        );
        signal('c121-link-free');
      } finally {
        await closeWindow(name).catch(() => undefined);
      }
    });
  });

  it('F-2003 AC-9 (c121-trouble-link): a failure with detected issues shows the troubleshooting terminal, its last line the S125 line with the Output Log... link', async () => {
    appendScript(dismissals('c121-trouble'));
    await openWindow('nowhere', 'c121-trouble');
    try {
      await waitFor(
        'the failure dialog of c121-trouble',
        () => recordLines('failureDialog', 'c121-trouble').length > 0,
        INSTALL_MILLISECONDS,
      );
      await waitFor(
        'the S125 line of c121-trouble',
        async () => (await troubleLine('c121-trouble')) === S125_LINE,
        60_000,
      );
      deepStrictEqual(await troubleLine('c121-trouble'), S125_LINE);
    } finally {
      await closeWindow('c121-trouble').catch(() => undefined);
    }
  });

  it('F-2003 AC-11 (c121-full-order): a fresh connect\'s record holds the BR-6 kinds in order: the log level, the resolve start, the settings, the client search, the remote output, the listening port, the resolved authority, the rule and the analysis', async () => {
    await freshHost();
    const mark = connectionLog().length;
    await openConnected('c121-order', INSTALL_MILLISECONDS);
    try {
      const lines = connectionLog().slice(mark);
      const versions = lines.findIndex(each =>
        each.includes('Editor version'),
      );
      const resolving = lines.findIndex(
        each => each.startsWith('Resolving ssh-remote+harness, attempt 1'),
      );
      const setting = lines.findIndex(each => each.startsWith('remote.SSH.'));
      const searched = lines.findIndex(each =>
        each.startsWith('Searched for ssh in:'),
      );
      const using = lines.findIndex(each =>
        each.startsWith('Using ssh client:'),
      );
      const remote = lines.findIndex(each => each.startsWith('[remote] '));
      const listening = lines.findIndex(each =>
        each.startsWith('Remote server listening on port '),
      );
      const resolved = lines.findIndex(each =>
        each.startsWith('Resolved ssh-remote+harness to local port '),
      );
      const separator = lines.findIndex(each => each === SEPARATOR_LINE);
      const analysis = lines.findIndex(each =>
        each.includes('recent session'),
      );
      deepStrictEqual(
        [
          (lines[0] ?? '').includes('Log level'),
          versions >= 0,
          resolving >= 0,
          setting > resolving,
          searched > setting,
          using > searched,
          remote > using,
          listening > remote,
          resolved > listening,
          separator > resolved,
          analysis > separator,
        ],
        [true, true, true, true, true, true, true, true, true, true, true],
      );
    } finally {
      await closeWindow('c121-order').catch(() => undefined);
    }
  });

  it('F-2003 AC-12 (c121-trace-server): a fresh connect at trace keeps ssh\'s verbose lines, more than the same fresh connect at debug, and the host\'s remoteagent.log holds trace entries', async () => {
    this.timeout(600_000);
    const saved = readUserSettings();
    let serverTrace = 0;
    const counts: Array<{debug1: number}> = [];
    try {
      for (const level of ['debug', 'trace'] as const) {
        await userSettings({'remote.SSH.logLevel': level});
        await freshHost();
        const mark = connectionLog().length;
        await openConnected(`c121-${level}`, INSTALL_MILLISECONDS);
        if (level === 'trace') {
          serverTrace = Number.parseInt(
            (
              await onHost(
                'sh',
                '-c',
                "find /home/harness/.local/state -name 'remoteagent.log' -exec grep -ci trace {} + 2>/dev/null | awk '{s += $1} END {print s + 0}'",
              )
            ).trim(),
            10,
          );
        }
        counts.push({
          debug1: connectionLog()
            .slice(mark)
            .filter(each => each.startsWith('[ssh] debug1: ')).length,
        });
        await closeWindow(`c121-${level}`).catch(() => undefined);
      }
      const [debug, trace] = counts;
      deepStrictEqual(
        {
          more: (trace?.debug1 ?? 0) > (debug?.debug1 ?? 0),
          verbose: (trace?.debug1 ?? 0) >= 1,
          serverTrace: serverTrace > 0,
        },
        {more: true, verbose: true, serverTrace: true},
      );
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2003 AC-13 (c121-live-trace): a reconnection after the user setting changes to trace without a reload carries the trace additions', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({'remote.SSH.logLevel': 'debug'});
      await openWindow('harness', 'c121-live');
      try {
        await connectedWithin('c121-live', INSTALL_MILLISECONDS);
        const mark = connectionLog().length;
        await userSettings({'remote.SSH.logLevel': 'trace'});
        await inWindow('c121-live', 'opensshremotes.cleanLocalServer');
        await waitFor(
          'the reconnection of c121-live',
          () =>
            connectionLog().slice(mark).some(each =>
              each.includes('reconnection'),
            ),
          120_000,
        );
        const record = connectionLog().slice(mark);
        deepStrictEqual(
          {
            reconnected: record.some(each =>
              each.startsWith('Resolving ssh-remote+harness'),
            ),
            traceLines: record.some(each => each.startsWith('[ssh] debug1: ')),
          },
          {reconnected: true, traceLines: true},
        );
      } finally {
        await closeWindow('c121-live').catch(() => undefined);
      }
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2003 AC-14 (c121-folder-level): a log level set in the folder settings, or under the lowercase key, is ignored: the record starts at debug', async () => {
    const saved = readUserSettings();
    const seen: Array<{level: boolean}> = [];
    try {
      await userSettings({'remote.SSH.logLevel': 'debug'});
      for (const [key, name] of [
        ['remote.SSH.logLevel', 'c121-folder'],
        ['remote.SSH.loglevel', 'c121-lower'],
      ] as const) {
        await onHost('mkdir', '-p', `/home/harness/${name}/.vscode`);
        await onHost(
          'sh',
          '-c',
          `printf '{"${key}": "trace"}' > /home/harness/${name}/.vscode/settings.json`,
        );
        const mark = connectionLog().length;
        await openWindow('harness', name);
        try {
          await connectedWithin(name, INSTALL_MILLISECONDS);
          const levelLine =
            connectionLog().slice(mark).find(each => each.includes('Log level')) ??
            '';
          seen.push({
            level: levelLine.includes('debug') && !levelLine.includes('trace'),
          });
        } finally {
          await closeWindow(name).catch(() => undefined);
        }
      }
      deepStrictEqual(seen, [{level: true}, {level: true}]);
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2003 AC-17 (c121-two-windows): two windows on different hosts each show only their own connection, backed by their own log file', async () => {
    appendScript([
      {
        surface: 'maskedInput',
        match: 'Enter password',
        answer: {text: hostPassword()},
        window: 'c121-two-b',
      },
    ]);
    const before = new Set(
      logFiles(editorLogsFolder()).filter(each =>
        each.endsWith('-Remote - SSH.log'),
      ),
    );
    await openWindow('harness', 'c121-two-a');
    await openWindow('password', 'c121-two-b');
    try {
      await connectedWithin('c121-two-a', INSTALL_MILLISECONDS);
      await connectedWithin('c121-two-b', INSTALL_MILLISECONDS);
      await inWindow('c121-two-a', 'opensshremotes.showLog');
      await inWindow('c121-two-b', 'opensshremotes.showLog');
      const fresh = logFiles(editorLogsFolder())
        .filter(each => each.endsWith('-Remote - SSH.log'))
        .filter(each => !before.has(each));
      function read(each: string): string {
        return readFileSync(each, 'utf8');
      }
      const aOnly = fresh.filter(each => {
        const text = read(each);
        return (
          text.includes('ssh-remote+harness') &&
          !text.includes('ssh-remote+password')
        );
      });
      const bOnly = fresh.filter(each => {
        const text = read(each);
        return (
          text.includes('ssh-remote+password') &&
          !text.includes('ssh-remote+harness')
        );
      });
      deepStrictEqual(
        {
          windowA: await outputChannelOf('c121-two-a'),
          windowB: await outputChannelOf('c121-two-b'),
          aOnly: aOnly.length >= 1,
          bOnly: bOnly.length >= 1,
        },
        {
          windowA: 'Remote - SSH',
          windowB: 'Remote - SSH',
          aOnly: true,
          bOnly: true,
        },
      );
    } finally {
      await closeWindow('c121-two-a').catch(() => undefined);
      await closeWindow('c121-two-b').catch(() => undefined);
    }
  });

  it('F-2003 AC-18 (c121-reload-file): a reload of the window starts a new log file, and the earlier one still exists', async () => {
    await openWindow('harness', 'c121-file');
    try {
      await connectedWithin('c121-file', INSTALL_MILLISECONDS);
      const before = logFiles(editorLogsFolder()).filter(each =>
        each.endsWith('-Remote - SSH.log'),
      );
      await reloadWindow('c121-file');
      await connectedWithin('c121-file', INSTALL_MILLISECONDS);
      const after = logFiles(editorLogsFolder()).filter(each =>
        each.endsWith('-Remote - SSH.log'),
      );
      deepStrictEqual(
        {
          before: before.length >= 1,
          grew: after.length > before.length,
          kept: before.every(each => after.includes(each)),
        },
        {before: true, grew: true, kept: true},
      );
    } finally {
      await closeWindow('c121-file').catch(() => undefined);
    }
  });

  it('F-2003 AC-19 (c121-setting-editor): the Settings editor lists the log level with its description, and its dropdown holds debug and trace with debug the default', async () => {
    await inWindow('local', 'workbench.action.openSettings', 'remote.SSH.logLevel');
    try {
      await waitFor(
        'the setting on the Settings editor list',
        async () => (await settingRow('local')) !== undefined,
        30_000,
      );
      const levelRow = await settingRow('local');
      const control = await settingControlOf('local');
      const options = await settingControlOptions('local');
      deepStrictEqual(
        {
          title: (levelRow?.lines[0] ?? '').includes('Log Level'),
          description: levelRow?.lines[1],
          count: levelRow?.count,
          default: control,
          options,
        },
        {
          title: true,
          description: 'The log level for the extension.',
          count: 1,
          default: 'debug',
          options: ['debug', 'trace'],
        },
      );
    } finally {
      await inWindow('local', 'workbench.action.closeActiveEditor').catch(
        () => undefined,
      );
    }
  });

  it('F-2003 AC-20 (c121-one-channel): after activation the core channel pick lists exactly one Remote - SSH for the window', async () => {
    const name = await freshWindow();
    try {
      await inWindow(name, 'opensshremotes.showLog');
      await windowState(name);
      await startInWindow(name, 'workbench.action.output.showOutputChannels');
      await pickOpen(name);
      const items = (await quickPickOf(name))?.items ?? [];
      await pressEscape(name);
      deepStrictEqual(
        {
          count: items.filter(each => each === 'Remote - SSH').length,
          channel: await outputChannelOf(name),
        },
        {count: 1, channel: 'Remote - SSH'},
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });

  it('F-2003 AC-22 (c121-s125-out-of-enum): with a log level outside the enum a failure with detected issues still ends the terminal with the S125 line', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({'remote.SSH.logLevel': 'off'});
      appendScript(dismissals('c121-s125'));
      await openWindow('nowhere', 'c121-s125');
      try {
        await waitFor(
          'the failure dialog of c121-s125',
          () => recordLines('failureDialog', 'c121-s125').length > 0,
          INSTALL_MILLISECONDS,
        );
        await waitFor(
          'the S125 line of c121-s125',
          async () => (await troubleLine('c121-s125')) === S125_LINE,
          60_000,
        );
        deepStrictEqual(await troubleLine('c121-s125'), S125_LINE);
      } finally {
        await closeWindow('c121-s125').catch(() => undefined);
      }
    } finally {
      restoreUserSettings(saved);
    }
  });

  it('F-2003 AC-23 (c121-summary): after a failure with issues the channel holds the rule and the session summary; after one without issues, that no hints were found', async () => {
    async function captured(host: string, folder: string): Promise<string[]> {
      appendScript(dismissals(folder));
      await openWindow(host, folder);
      const mark = connectionLog().length;
      try {
        await waitFor(
          `the failure dialog of ${folder}`,
          () => recordLines('failureDialog', folder).length > 0,
          INSTALL_MILLISECONDS,
        );
        return connectionLog().slice(mark);
      } finally {
        await closeWindow(folder).catch(() => undefined);
      }
    }
    const withIssues = await captured('nowhere', 'c121-sum1');
    const withoutIssues = await captured('refused', 'c121-sum2');
    deepStrictEqual(
      {
        separator: withIssues.includes(SEPARATOR_LINE),
        heading: withIssues.some(each => each.includes('[Session Summary]')),
        issue: withIssues.some(each =>
          /^\[[A-Za-z][A-Za-z]*\]: .+$/u.test(each),
        ),
        order:
          withIssues.indexOf(SEPARATOR_LINE) <
          withIssues.findIndex(each => each.includes('[Session Summary]')),
        noHints: withoutIssues.includes(
          'No hints found in the recent session.',
        ),
        separator2: withoutIssues.includes(SEPARATOR_LINE),
      },
      {
        separator: true,
        heading: true,
        issue: true,
        order: true,
        noHints: true,
        separator2: true,
      },
    );
  });

  it('F-2003 AC-26 (c121-live-change): a log level changed in the user settings needs no reload: the next SSH operation completes with no error, at trace and at an out-of-enum value', async () => {
    const saved = readUserSettings();
    const seen: Array<{value: string; clean: boolean}> = [];
    try {
      await userSettings({'remote.SSH.logLevel': 'debug'});
      await openWindow('harness', 'c121-live26');
      try {
        await connectedWithin('c121-live26', INSTALL_MILLISECONDS);
        for (const value of ['trace', 'off'] as const) {
          await userSettings({'remote.SSH.logLevel': value});
          await inWindow('c121-live26', 'opensshremotes.cleanLocalServer');
          await connectedWithin('c121-live26', 120_000);
          seen.push({
            value,
            clean:
              (await dialogOf('c121-live26')) === undefined &&
              (await notifications('c121-live26')).length === 0,
          });
        }
        deepStrictEqual(seen, [
          {value: 'trace', clean: true},
          {value: 'off', clean: true},
        ]);
      } finally {
        await closeWindow('c121-live26').catch(() => undefined);
      }
    } finally {
      restoreUserSettings(saved);
    }
  });
});
