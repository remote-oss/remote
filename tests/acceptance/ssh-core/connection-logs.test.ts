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
  onHost,
  openWindow,
} from '../windows/harness.ts';

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
