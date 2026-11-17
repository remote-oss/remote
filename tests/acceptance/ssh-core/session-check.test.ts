/**
 * @fileoverview The session check of a window that lost its transport (card #2751, F-2505 AC-25's second half): the
 * shared `ssh` carries every window of a host, so a window whose own connection broke while the host answers must
 * not end the session for the others.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedWithin,
  connectionLog,
  openWindow,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {resolvedCount} from '../windows/config-keywords-support.ts';
import {closeAllButLocal} from '../windows/maintenance.ts';
import {statusItem} from '../windows/renderer.ts';
import {keepingSettings, PLATFORMS} from '../windows/tunnel-support.ts';

const execFileAsync = promisify(execFile);

/** The local port each window of alias `harness` was resolved to, in the order the windows started. */
function windowPorts(): number[] {
  return connectionLog()
    .map(line => /Resolved ssh-remote\+harness to local port (\d+)/u.exec(line))
    .flatMap(match => (match?.[1] === undefined ? [] : [Number(match[1])]));
}

/** The process ids of the runner's `ssh` that holds the host's SOCKS forward, which the connection helper started. */
async function sharedSshIds(): Promise<number[]> {
  const {stdout} = await execFileAsync('pgrep', [
    '-f',
    'ssh .* -D 127.0.0.1',
  ]).catch(() => ({stdout: ''}));
  return stdout
    .split('\n')
    .filter(line => line !== '')
    .map(Number)
    .sort();
}

/** Resets every connection of the runner's side of window port `port`, as a broken transport of that window alone does. */
async function breakConnectionsOf(port: number): Promise<void> {
  try {
    await execFileAsync('sudo', [
      '-n',
      'ss',
      '-K',
      '-tn',
      'state',
      'established',
      `( sport = :${String(port)} or dport = :${String(port)} )`,
    ]);
  } catch (caught) {
    throw new Error(
      `the row needs a passwordless sudo and a kernel that lets ss reset sockets, and \`sudo -n ss -K\` failed: ${String(caught)}`,
      {cause: caught},
    );
  }
}

describe('the session check of a window that lost its transport (card #2751)', function () {
  this.timeout(300_000);

  beforeEach(closeAllButLocal);

  it('F-2505 AC-25 (c2751-one-window): when one window of a host loses its own connection while the host answers, its reconnection finds the shared session alive, ends nothing and the other window stays connected on the same ssh', async () => {
    await keepingSettings(async () => {
      await userSettings({...PLATFORMS});
      const first = 'c2751-a';
      const second = 'c2751-b';
      await openWindow('harness', first);
      await connectedWithin(first, 90_000);
      await openWindow('harness', second);
      await connectedWithin(second, 90_000);
      const before = await sharedSshIds();
      const resolved = resolvedCount('harness');
      const mark = connectionLog().length;
      await breakConnectionsOf(windowPorts()[0] ?? 0);
      await waitFor(
        'the first window to reconnect',
        () => resolvedCount('harness') > resolved,
        120_000,
      );
      const lines = connectionLog().slice(mark);
      const indicator = (await statusItem(second, 'status.host')).text;
      const after = await sharedSshIds();
      await closeWindow(second);
      await closeWindow(first);
      deepStrictEqual(
        {
          checks: lines.filter(line =>
            line.startsWith('the held connection was checked'),
          ),
          reconnections: lines.filter(line => line.includes('reconnection'))
            .length,
          indicator,
          sameSsh: after.join() === before.join(),
          oneSsh: before.length,
        },
        {
          checks: ['the held connection was checked: its session answers'],
          reconnections: 1,
          indicator: 'SSH: harness',
          sameSsh: true,
          oneSsh: 1,
        },
      );
    });
  });
});
