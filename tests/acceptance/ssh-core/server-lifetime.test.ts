/**
 * @fileoverview The grace time of the server a connect starts (card #2651, F-2413): what the setting
 * `remote.SSH.reconnectionGraceTime` makes the server and the window log, in each start mode, with a running server, and
 * for the values the spec names. The host's server log and the window's own log carry the value the server parsed.
 */

import {deepStrictEqual} from 'node:assert';
import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  editorLogsFolder,
  hostAnswer,
  inWindow,
  onHost,
  openWindow,
  readUserSettings,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
} from '../windows/maintenance.ts';
import {dialogOf, notifications} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** The setting of the feature. */
const GRACE = 'remote.SSH.reconnectionGraceTime';

/** What the server's log says of its grace time, with the line's own time and ids left out. */
interface ServerGrace {
  parsed: string[];
  extensionHost: string[];
}

/** Ends every server process of the host and waits until none runs, so that the next connect starts one. */
async function noServers(): Promise<void> {
  await onHost('pkill', '-u', 'harness', '-f', `${DATA_FOLDER}/`).catch(
    () => undefined,
  );
  await waitFor(
    'no server process on the host',
    async () =>
      onHost('pgrep', '-u', 'harness', '-f', `${DATA_FOLDER}/`).then(
        () => false,
        () => true,
      ),
    60_000,
  );
}

/** The grace-time lines of the host's server logs, as the server wrote them after its own time stamp and ids. */
async function serverGrace(): Promise<ServerGrace> {
  const lines = (
    await onHost(
      'sh',
      '-c',
      `cat ${DATA_FOLDER}/.*.log 2>/dev/null | grep -F '[reconnection-grace-time]' ; true`,
    )
  )
    .split('\n')
    .filter(line => line !== '')
    .map(line => line.slice(line.indexOf('[reconnection-grace-time]') + 26));
  return {
    parsed: lines.filter(
      line =>
        line.startsWith('Parsed CLI argument') ||
        line.startsWith('No CLI argument'),
    ),
    extensionHost: lines.filter(line => line.startsWith('Extension host')),
  };
}

/** The log files of `folder`, whatever their depth. */
function logFilesOf(folder: string): string[] {
  return readdirSync(folder, {withFileTypes: true}).flatMap(entry => {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      return logFilesOf(file);
    }
    return file.endsWith('.log') ? [file] : [];
  });
}

/** What the windows' own logs (core's) say the client received from the server since `since` (milliseconds). */
function clientGraceSince(since: number): string[] {
  return logFilesOf(editorLogsFolder())
    .flatMap(file =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter(line =>
          line.includes('Client received grace time from server'),
        ),
    )
    .filter(line => {
      const found = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3})/.exec(
        line,
      );
      return (
        found !== null &&
        new Date(
          Number(found[1]),
          Number(found[2]) - 1,
          Number(found[3]),
          Number(found[4]),
          Number(found[5]),
          Number(found[6]),
          Number(found[7]),
        ).getTime() >= since
      );
    })
    .map(line => line.slice(line.indexOf('Client received')));
}

describe('the grace time of the server a connect starts (card #2651, F-2413)', function () {
  this.timeout(600_000);
  let saved: string | undefined;

  before(() => {
    saved = readUserSettings();
  });

  beforeEach(closeAllButLocal);

  afterEach(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  /** Starts a server from none under `settings`, connects window `name`, and gives the time the connect began. */
  async function connectFresh(
    name: string,
    settings: Readonly<Record<string, unknown>>,
  ): Promise<number> {
    await noServers();
    restoreUserSettings(saved);
    await userSettings({...PLATFORMS, ...settings});
    appendScript(dismissals(name));
    const began = Date.now();
    await openWindow('harness', name);
    await connectedWithin(name, 180_000);
    await new Promise(resolve => setTimeout(resolve, 3000));
    return began;
  }

  it('F-2413 AC-2, AC-38 (c2651-sixty): with 60 a connect with no server starts one that logs 60 s, the window gets it, the window connects normally and no notification offers a server update', async () => {
    const began = await connectFresh('c2651-sixty', {[GRACE]: 60});
    deepStrictEqual(
      {
        server: await serverGrace(),
        client: clientGraceSince(began),
        notices: (await notifications('c2651-sixty')).filter(text =>
          /update/i.test(text),
        ),
        dialog: await dialogOf('c2651-sixty'),
      },
      {
        server: {
          parsed: ['Parsed CLI argument: 60s -> 60000ms'],
          extensionHost: [
            'Extension host: read VSCODE_RECONNECTION_GRACE_TIME=60000ms (60s)',
          ],
        },
        client: ['Client received grace time from server: 60000ms (60s)'],
        notices: [],
        dialog: undefined,
      },
    );
  });

  it('F-2413 AC-3 (c2651-default): with null a server uses 10800 s', async () => {
    const began = await connectFresh('c2651-default', {});
    deepStrictEqual(
      {server: await serverGrace(), client: clientGraceSince(began)},
      {
        server: {
          parsed: [
            'No CLI argument provided, using default: 10800000ms (10800s)',
          ],
          extensionHost: [
            'Extension host: read VSCODE_RECONNECTION_GRACE_TIME=10800000ms (10800s)',
          ],
        },
        client: ['Client received grace time from server: 10800000ms (10800s)'],
      },
    );
  });

  it('F-2413 AC-4 (c2651-modes): with 60 the server runs with 60 s in the exec server mode (the default), in the legacy mode and with the local server off', async () => {
    const seen: Array<[string, string[]]> = [];
    for (const [mode, settings] of [
      ['default', {}],
      ['legacy', {'remote.SSH.useExecServer': false}],
      ['terminal', {'remote.SSH.useLocalServer': false}],
    ] as const) {
      const name = `c2651-mode-${mode}`;
      await connectFresh(name, {[GRACE]: 60, ...settings});
      seen.push([mode, (await serverGrace()).parsed]);
      await closeWindow(name).catch(() => undefined);
    }
    deepStrictEqual(seen, [
      ['default', ['Parsed CLI argument: 60s -> 60000ms']],
      ['legacy', ['Parsed CLI argument: 60s -> 60000ms']],
      ['terminal', ['Parsed CLI argument: 60s -> 60000ms']],
    ]);
  });

  it('F-2413 AC-5 (c2651-change): changing the setting shows no notification or dialog and does not reload the window', async () => {
    const name = 'c2651-change';
    await connectFresh(name, {});
    function resolves(): number {
      return connectionLog().filter(line =>
        line.includes('Resolving ssh-remote+'),
      ).length;
    }
    const before = resolves();
    for (const value of [60, null, 120]) {
      await userSettings({[GRACE]: value});
    }
    await new Promise(resolve => setTimeout(resolve, 4000));
    deepStrictEqual(
      {
        notices: await notifications(name),
        dialog: await dialogOf(name),
        resolves: resolves() - before,
      },
      {notices: [], dialog: undefined, resolves: 0},
    );
  });

  it('F-2413 AC-6, AC-7 (c2651-running): a running server keeps its grace time through a reload with 60, which the logs show as no new grace line, and after Kill VS Code Server on Host the next connect starts a server with 60 s', async () => {
    const name = 'c2651-running';
    await connectFresh(name, {});
    const mark = connectionLog().length;
    const since = Date.now();
    await userSettings({[GRACE]: 60});
    await reloadWindow(name);
    await connectedWithin(name, 180_000);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const reloaded = {
      server: await serverGrace(),
      remoteLog: connectionLog()
        .slice(mark)
        .filter(line => /grace/i.test(line)),
      client: clientGraceSince(since),
    };
    appendScript([hostAnswer(name, {label: 'harness'})]);
    await inWindow(name, 'opensshremotes.cleanRemoteServer');
    await waitFor(
      'the server to be gone',
      async () =>
        onHost('pgrep', '-u', 'harness', '-f', `${DATA_FOLDER}/`).then(
          () => false,
          () => true,
        ),
      60_000,
    );
    await closeWindow(name).catch(() => undefined);
    const again = await connectFresh('c2651-running-2', {[GRACE]: 60});
    deepStrictEqual(
      [reloaded, (await serverGrace()).parsed, clientGraceSince(again)],
      [
        {
          server: {
            parsed: [
              'No CLI argument provided, using default: 10800000ms (10800s)',
            ],
            extensionHost: [
              'Extension host: read VSCODE_RECONNECTION_GRACE_TIME=10800000ms (10800s)',
            ],
          },
          remoteLog: [],
          client: [],
        },
        ['Parsed CLI argument: 60s -> 60000ms'],
        ['Client received grace time from server: 60000ms (60s)'],
      ],
      JSON.stringify(connectionLog().slice(mark)),
    );
  });

  it('F-2413 AC-22 (c2651-zero): with 0 a server uses 10800 s and the window connects', async () => {
    await connectFresh('c2651-zero', {[GRACE]: 0});
    deepStrictEqual((await serverGrace()).parsed, [
      'No CLI argument provided, using default: 10800000ms (10800s)',
    ]);
  });

  it('F-2413 AC-24 (c2651-invalid-running): with an invalid value and a running server a reload connects to the running server with no error', async () => {
    const name = 'c2651-invalid-running';
    await connectFresh(name, {});
    await userSettings({[GRACE]: -5});
    await reloadWindow(name);
    await connectedWithin(name, 180_000);
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [await dialogOf(name), await notifications(name)],
      [undefined, []],
    );
  });

  it('F-2413 AC-25 (c2651-legacy-invalid): in the legacy mode -5, "abc" and a per-host object connect and the server uses 10800 s', async () => {
    const seen: Array<[string, boolean, string[]]> = [];
    for (const [label, value] of [
      ['minus-five', -5],
      ['text', 'abc'],
      ['object', {harness: 30}],
    ] as const) {
      const name = `c2651-legacy-${label}`;
      await connectFresh(name, {
        [GRACE]: value,
        'remote.SSH.useExecServer': false,
      });
      seen.push([label, true, (await serverGrace()).parsed]);
      await closeWindow(name).catch(() => undefined);
    }
    const dflt = [
      'No CLI argument provided, using default: 10800000ms (10800s)',
    ];
    deepStrictEqual(seen, [
      ['minus-five', true, dflt],
      ['text', true, dflt],
      ['object', true, dflt],
    ]);
  });
});
