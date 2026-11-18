/**
 * @fileoverview The server's lifetime after the client's editor ended without closing the connection (card #2669, F-2413
 * 6.3), one case per launch like `containers-killed-*`: `ssh-killed-12`, `ssh-killed-13` and `ssh-killed-14` run this one
 * suite with their case named in `HARNESS_KILLED_CASE`, and a launch registers only its own row. The row connects a
 * window to the host, kills the launch's editor tree and goes on against the host alone; the row of case 14 asks the
 * harness for a new editor, which opens the second window.
 */

import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  killWindow,
  onHost,
  openWindow,
  relaunchEditor,
  userSettings,
} from '../windows/harness.ts';
import {DATA_FOLDER, dismissals} from '../windows/maintenance.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** The case of this launch: `12`, `13` or `14`, one killed-editor row per launch. */
const KILLED_CASE = process.env.HARNESS_KILLED_CASE ?? '';

/** The setting of the grace time. */
const GRACE = 'remote.SSH.reconnectionGraceTime';

/**
 * The process ids of the host's processes whose command line holds `pattern`. `pgrep` ends with status 1 when no process
 * does, which is none; any other failure (the container gone, `pgrep` missing, a bad pattern) fails the call, so a read
 * that did not work is never taken for a server that has ended.
 */
async function processesOf(pattern: string): Promise<string[]> {
  let found: string;
  try {
    found = await onHost('pgrep', '-u', 'harness', '-f', '--', pattern);
  } catch (caught) {
    if ((caught as {code?: unknown}).code === 1) {
      return [];
    }
    throw caught;
  }
  return found.split('\n').filter(line => line !== '');
}

/** The server itself, not its children. */
function serverMains(): Promise<string[]> {
  return processesOf(`${DATA_FOLDER}/bin/.*/out/server-main.js`);
}

/** Every process of the host's server. */
function serverProcesses(): Promise<string[]> {
  return processesOf(`${DATA_FOLDER}/`);
}

/** The remote extension hosts of the server. */
function extensionHosts(): Promise<string[]> {
  return processesOf('--type=extensionHost');
}

/** The host's clock as a second of the day, which its log lines' own time stamps are on. */
async function hostSecond(): Promise<number> {
  const [hours, minutes, seconds] = (await onHost('date', '+%H:%M:%S'))
    .trim()
    .split(':')
    .map(Number);
  return (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
}

/** The seconds of the day of the server's log lines that hold `text`. */
async function logSeconds(text: string): Promise<number[]> {
  return (
    await onHost(
      'sh',
      '-c',
      `cat ${DATA_FOLDER}/.*.log 2>/dev/null | grep -F '${text}' ; true`,
    )
  )
    .split('\n')
    .flatMap(line => {
      const found = /^\[(\d\d):(\d\d):(\d\d)\]/.exec(line);
      return found === null
        ? []
        : [Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3])];
    });
}

/** Pauses for `milliseconds`. */
function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

/** Connects window `name` to the host with the grace time `grace` (the default for null) and gives its server and extension hosts, which it checks are there. */
async function connected(
  name: string,
  grace: number | null,
): Promise<{server: string[]; extensionHosts: string[]}> {
  await userSettings({...PLATFORMS, [GRACE]: grace});
  appendScript(dismissals(name));
  await openWindow('harness', name);
  await connectedWithin(name, 180_000);
  await pause(5000);
  const standing = {
    server: await serverMains(),
    extensionHosts: await extensionHosts(),
  };
  deepStrictEqual(
    [standing.server.length > 0, standing.extensionHosts.length > 0],
    [true, true],
    `the server and an extension host of ${name} stand on the host before its editor is killed: ${JSON.stringify(standing)}`,
  );
  return standing;
}

/** The row of each case, registered by its launch. */
const ROWS: Record<string, () => void> = {
  '12': () =>
    it('F-2413 AC-12 (k12): with 60 s, a server whose client ended without closing the connection keeps it for 60 s and all its processes are gone about six minutes later', async () => {
      await connected('c2669-k12', 60);
      const killed = await hostSecond();
      await killWindow('c2669-k12', 'tree');
      const began = Date.now();
      let goneAfter = -1;
      while (Date.now() - began < 540_000 && goneAfter < 0) {
        await pause(5000);
        if ((await serverProcesses()).length === 0) {
          goneAfter = Math.round((Date.now() - began) / 1000);
        }
      }
      const noticed = (await logSeconds('will wait for reconnection 1m')).map(
        second => second - killed,
      );
      deepStrictEqual(
        {
          waitedOneMinute: noticed.length > 0,
          goneAboutSixMinutesAfter: goneAfter >= 300 && goneAfter <= 420,
        },
        {waitedOneMinute: true, goneAboutSixMinutesAfter: true},
        `gone ${String(goneAfter)} s after the kill; the disconnect was logged ${JSON.stringify(noticed)} s after it`,
      );
    }),
  '13': () =>
    it('F-2413 AC-13 (k13): with the default grace time, a server whose client ended without closing the connection still runs nine minutes later, with its extension host', async () => {
      const before = await connected('c2669-k13', null);
      await killWindow('c2669-k13', 'tree');
      await pause(9 * 60_000);
      deepStrictEqual(
        {
          server: await serverMains(),
          extensionHosts: (await extensionHosts()).length > 0,
        },
        {server: before.server, extensionHosts: true},
      );
    }),
  '14': () =>
    it('F-2413 AC-14 (k14): another window connecting to a server whose connection waits in its grace time shortens that wait to five minutes', async () => {
      const before = await connected('c2669-k14', null);
      await killWindow('c2669-k14', 'tree');
      await pause(10_000);
      const own = await relaunchEditor({}, 'the second window');
      await userSettings({...PLATFORMS});
      appendScript(dismissals('c2669-k14b'));
      await openWindow('harness', 'c2669-k14b');
      await connectedWithin('c2669-k14b', 180_000);
      const joined = Date.now();
      const firstWindowHosts = before.extensionHosts;
      let endedAfter = -1;
      while (Date.now() - joined < 480_000 && endedAfter < 0) {
        await pause(5000);
        const running = await extensionHosts();
        if (firstWindowHosts.every(process => !running.includes(process))) {
          endedAfter = Math.round((Date.now() - joined) / 1000);
        }
      }
      deepStrictEqual(
        {
          own,
          serverStillRuns:
            (await serverMains()).join() === before.server.join(),
          oldHostEndsAboutFiveMinutesAfter:
            endedAfter >= 240 && endedAfter <= 360,
        },
        {
          own: 'local',
          serverStillRuns: true,
          oldHostEndsAboutFiveMinutesAfter: true,
        },
        `the first window's extension host ended ${String(endedAfter)} s after the second window connected`,
      );
    }),
};

describe('the lifetime of the server after the editor ended without closing the connection (card #2669, F-2413)', function () {
  this.timeout(1_200_000);

  (ROWS[KILLED_CASE] ?? (() => undefined))();
});
