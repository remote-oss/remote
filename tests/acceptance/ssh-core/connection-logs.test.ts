import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectionLog,
  editorLogsFolder,
  onHost,
  openWindow,
} from '../windows/harness.ts';

/** The files of the client's editor logs folder, whatever their depth. */
function logFiles(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    return entry.isDirectory() ? logFiles(file) : [file];
  });
}

/** What names a WebSocket compression in a log line. */
const COMPRESSION =
  /websocket.*compress|compress.*websocket|permessage-deflate/i;

describe('the logs of a connected SSH window (card connect-125, #1600)', function () {
  this.timeout(300_000);

  it('F-2508 AC-33 (c125-logs): the resolver returned a managed connection, and no client or server log mentions WebSocket compression', async () => {
    await openWindow('harness', 'c125-logs');
    try {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const clientMentions = logFiles(editorLogsFolder())
        .filter(file => file.endsWith('.log'))
        .filter(file => COMPRESSION.test(readFileSync(file, 'utf8')));
      const serverMentions = (
        await onHost(
          'sh',
          '-c',
          `grep -rliE 'websocket.*compress|compress.*websocket|permessage-deflate' /home/harness/.local/state /home/harness/.vscodium-server-insiders/*.log 2>/dev/null || true`,
        )
      ).trim();
      deepStrictEqual(
        [
          connectionLog().some(line =>
            line.startsWith('Resolved ssh-remote+harness to local port'),
          ),
          clientMentions,
          serverMentions,
        ],
        [true, [], ''],
      );
    } finally {
      await closeWindow('c125-logs').catch(() => undefined);
    }
  });
});
