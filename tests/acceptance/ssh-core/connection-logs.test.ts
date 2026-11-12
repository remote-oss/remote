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
  waitFor,
  windowEvents,
  windowState,
} from '../windows/harness.ts';
import {
  dialogOf,
  notifications,
  outputChannelOf,
  outputPanelFocused,
  quickPickOf,
} from '../windows/renderer.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
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
      deepStrictEqual(
        await outputChannelOf('c121-refused'),
        'Remote - SSH',
      );
    } finally {
      await closeWindow('c121-refused').catch(() => undefined);
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
      const platformText = platform ?? '';
      deepStrictEqual(
        [
          level === 'debug' || level === '2',
          (editor ?? '').includes('1.'),
          (extension ?? '').includes('Remote - SSH'),
          platformText.includes('linux') &&
            (platformText.includes('x64') || platformText.includes('arm64')),
        ],
        [true, true, true, true],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
