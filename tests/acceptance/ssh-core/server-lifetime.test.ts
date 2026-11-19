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
  cutHostNetwork,
  editorLogsFolder,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreHostNetwork,
  restoreUserSettings,
  userSettings,
  waitFor,
  windowEvents,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
  pickHost,
  runWith,
  serverProcesses,
  serversGoneWithin,
} from '../windows/maintenance.ts';
import {
  answerDialog,
  dialogOf,
  notifications,
  pageText,
  statusBarText,
} from '../windows/renderer.ts';
import {PLATFORMS} from '../windows/tunnel-support.ts';

/** The setting of the feature. */
const GRACE = 'remote.SSH.reconnectionGraceTime';

/** Core's dialogs in the page, where the row can read them: the dialog that it cannot reconnect is otherwise a native one. */
const CUSTOM_DIALOGS = 'window.dialogStyle';

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

/** The process id of the host's server itself (not its children), which a reconnection must not change. */
async function serverMain(): Promise<string> {
  return (
    await onHost(
      'pgrep',
      '-u',
      'harness',
      '-f',
      `${DATA_FOLDER}/bin/.*/out/server-main.js`,
    ).catch(() => '')
  ).trim();
}

/**
 * What the host holds of the server at this moment, for a failure to show: every process of the server folder with its
 * parent, its start and its command line, the files of the folder with their times (the locks, the pid, token and log
 * files), the content of the pid file and the end of the server's log.
 */
async function serverFacts(): Promise<string> {
  return onHost(
    'sh',
    '-c',
    `for pid in $(pgrep -f '${DATA_FOLDER}/bin/'); do [ "$pid" != "$$" ] || continue; echo "$pid parent $(awk '{print $4}' /proc/$pid/stat 2>/dev/null) start $(stat -c %y /proc/$pid 2>/dev/null) $(tr '\\0' ' ' </proc/$pid/cmdline 2>/dev/null)"; done; ls -lA --full-time ${DATA_FOLDER} ${DATA_FOLDER}/bin/* 2>&1; for pidfile in ${DATA_FOLDER}/.*.pid; do echo "$pidfile: $(cat "$pidfile" 2>&1)"; done; tail -n 20 ${DATA_FOLDER}/.*.log 2>&1; true`,
  ).catch(
    (caught: unknown) => `the facts could not be read: ${String(caught)}`,
  );
}

/** The host's clock as a second of the day, which its log lines' own time stamps are on. */
async function hostSecond(): Promise<number> {
  const [hours, minutes, seconds] = (await onHost('date', '+%H:%M:%S'))
    .trim()
    .split(':')
    .map(Number);
  return (hours ?? 0) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0);
}

/** One state of a window's reconnection, as core shows it: the remote indicator and the modal dialog, if any. */
interface Seen {
  /** Milliseconds from the cut of the network. */
  after: number;
  indicator: string;
  dialog: string | undefined;
  buttons: string[];
  notices: string[];
}

/**
 * Samples window `name` once a second until `stop` says so or `limit` milliseconds passed, and gives each change of its
 * indicator or dialog, the seconds of a countdown ("in 26 seconds") written as `N seconds`.
 */
async function observed(
  name: string,
  began: number,
  stop: (seen: Seen) => boolean,
  limit: number,
): Promise<Seen[]> {
  const states: Seen[] = [];
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    const indicator = await statusBarText(name, 'status.host').catch(() => '');
    const dialog = await dialogOf(name).catch(() => undefined);
    const text =
      dialog === undefined
        ? undefined
        : (dialog.message || dialog.details).replace(
            /\d+ seconds?/,
            'N seconds',
          );
    const current: Seen = {
      after: Date.now() - began,
      indicator,
      dialog: text,
      buttons: dialog?.buttons ?? [],
      notices: await notifications(name).catch(() => []),
    };
    const last = states.at(-1);
    if (
      last?.indicator !== indicator ||
      last.dialog !== text ||
      last.notices.join('|') !== current.notices.join('|')
    ) {
      states.push(current);
    }
    if (stop(current)) {
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return states;
}

/** Cuts the host's network, samples the window until `stop` or `limit`, and brings the network back. */
async function cutObserved(
  name: string,
  stop: (seen: Seen) => boolean,
  limit: number,
): Promise<Seen[]> {
  const began = Date.now();
  cutHostNetwork();
  try {
    return await observed(name, began, stop, limit);
  } finally {
    restoreHostNetwork();
  }
}

/** `lines` without the repeats, in order. */
function unique(lines: string[]): string[] {
  return [...new Set(lines)];
}

/** The text of core's dialog that the reconnection gave up. */
const GAVE_UP = 'Cannot reconnect. Please reload the window.';

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
    const graced = await serverGrace();
    const reloaded = {
      server: {
        parsed: graced.parsed,
        extensionHost: unique(graced.extensionHost),
      },
      remoteLog: connectionLog()
        .slice(mark)
        .filter(line => /grace/i.test(line)),
      client: unique(clientGraceSince(since)),
    };
    const servers = await serverProcesses();
    await runWith('local', 'opensshremotes.cleanRemoteServer', [
      pickHost('harness'),
    ]);
    await serversGoneWithin(servers, 30_000);
    await closeWindow(name).catch(() => undefined);
    const again = Date.now();
    appendScript(dismissals('c2651-running-2'));
    await openWindow('harness', 'c2651-running-2');
    await connectedWithin('c2651-running-2', 180_000);
    await new Promise(resolve => setTimeout(resolve, 3000));
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
          client: [
            'Client received grace time from server: 10800000ms (10800s)',
          ],
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

  it('F-2413 AC-8, AC-35, AC-36 (c2651-cut-sixty): with 60 s a lost network ends in core’s dialogs of the reconnection, then the dialog that it cannot reconnect with Cancel and Reload Window and the indicator Disconnected from SSH, and Cancel closes it and leaves the window disconnected', async () => {
    const name = 'c2651-cut-sixty';
    await connectFresh(name, {[GRACE]: 60, [CUSTOM_DIALOGS]: 'custom'});
    const states = await cutObserved(
      name,
      seen => seen.indicator.startsWith('Disconnected'),
      200_000,
    );
    await new Promise(resolve => setTimeout(resolve, 5000));
    const shown = {
      dialog: await dialogOf(name).catch(() => undefined),
      page: (await pageText(name))
        .split('\n')
        .filter(line => /reconnect|Reload|Cancel/i.test(line)),
      notices: await notifications(name),
    };
    const last = states.at(-1);
    await answerDialog(name, 'Cancel').catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 2000));
    const after = {
      dialog: await dialogOf(name).catch(() => undefined),
      indicator: await statusBarText(name, 'status.host'),
    };
    deepStrictEqual(
      {
        reconnecting: states.some(each =>
          each.indicator.startsWith('Reconnecting to SSH: harness'),
        ),
        attempting: states.find(
          each => each.dialog === 'Disconnected. Attempting to reconnect...',
        )?.buttons,
        countdown: states.find(each =>
          each.dialog?.startsWith('Attempting to reconnect in N seconds'),
        )?.buttons,
        gaveUp: [last?.dialog, last?.buttons, last?.indicator],
        withinBounds:
          (last?.after ?? 0) > 60_000 && (last?.after ?? Infinity) < 150_000,
        afterCancel: after,
      },
      {
        reconnecting: true,
        attempting: ['Dismiss', 'Reload Window'],
        countdown: ['Reload Window', 'Dismiss', 'Reconnect Now'],
        gaveUp: [
          GAVE_UP,
          ['Cancel', 'Reload Window'],
          'Disconnected from SSH: harness',
        ],
        withinBounds: true,
        afterCancel: {
          dialog: undefined,
          indicator: 'Disconnected from SSH: harness',
        },
      },
      `${JSON.stringify(states)} ${JSON.stringify(shown)} ${JSON.stringify(
        recordLines(undefined, name)
          .slice(-4)
          .map(line => [line.surface, line.question, line.buttons]),
      )}`,
    );
  });

  it('F-2413 AC-10 (c2651-cut-reload): after the dialog that it cannot reconnect and with the host reachable, Reload Window connects to the server that still runs, which no new install follows', async () => {
    const name = 'c2651-cut-reload';
    await connectFresh(name, {[GRACE]: 60, [CUSTOM_DIALOGS]: 'custom'});
    const server = await serverMain();
    await cutObserved(name, seen => seen.dialog === GAVE_UP, 200_000);
    const mark = connectionLog().length;
    await new Promise(resolve => setTimeout(resolve, 3000));
    await answerDialog(name, 'Reload Window');
    await connectedWithin(name, 120_000);
    const reloaded = await serverMain();
    deepStrictEqual(
      [
        reloaded,
        connectionLog()
          .slice(mark)
          .filter(line => /install|download/i.test(line)),
      ],
      [server, []],
      `${JSON.stringify(connectionLog().slice(mark))}\nthe host's server before the reload: ${server}\n${reloaded === server ? '' : await serverFacts()}`,
    );
  });

  it('F-2413 AC-9 (c2651-cut-default): with the default grace time a network lost for 90 s and back reconnects the window to the same server without a reload', async () => {
    const name = 'c2651-cut-default';
    await connectFresh(name, {});
    const server = await serverMain();
    function activations(): number {
      return windowEvents(name).filter(each => each.event === 'activated')
        .length;
    }
    const before = activations();
    cutHostNetwork();
    try {
      await new Promise(resolve => setTimeout(resolve, 90_000));
    } finally {
      restoreHostNetwork();
    }
    await waitFor(
      'the window to be connected again',
      async () =>
        (await statusBarText(name, 'status.host').catch(() => '')) ===
        'SSH: harness',
      120_000,
    );
    deepStrictEqual([await serverMain(), activations() - before], [server, 0]);
  });

  it('F-2413 AC-28 (c2651-cut-log): with 60 s and a network lost for 110 s the server logs no disconnect while the network is down, logs it with a one-minute wait about 30 s after the network returned, and still runs once the client has given up', async () => {
    const name = 'c2651-cut-log';
    await connectFresh(name, {[GRACE]: 60});
    const server = await serverMain();
    const cutAt = await hostSecond();
    cutHostNetwork();
    let restoredAt: number;
    try {
      await new Promise(resolve => setTimeout(resolve, 110_000));
    } finally {
      restoreHostNetwork();
      restoredAt = await hostSecond();
    }
    const gaveUp = (await statusBarText(name, 'status.host')).startsWith(
      'Disconnected',
    );
    await new Promise(resolve => setTimeout(resolve, 60_000));
    const disconnects = (
      await onHost(
        'sh',
        '-c',
        `cat ${DATA_FOLDER}/.*.log 2>/dev/null | grep -F 'The client has disconnected' ; true`,
      )
    )
      .split('\n')
      .filter(line => line !== '');
    const seconds = disconnects.map(line => {
      const found = /^\[(\d\d):(\d\d):(\d\d)\]/.exec(line);
      return found === null
        ? -1
        : Number(found[1]) * 3600 + Number(found[2]) * 60 + Number(found[3]);
    });
    const lateBy = (seconds[0] ?? -1) - restoredAt;
    deepStrictEqual(
      {
        disconnectsWhileDown: seconds.filter(
          second => second >= cutAt && second < restoredAt,
        ).length,
        waits: disconnects.map(line =>
          line.includes('will wait for reconnection 1m'),
        ),
        aboutThirtySecondsLater: lateBy >= 20 && lateBy <= 45,
        gaveUp,
        running: (await serverMain()) === server,
      },
      {
        disconnectsWhileDown: 0,
        waits: [true],
        aboutThirtySecondsLater: true,
        gaveUp: true,
        running: true,
      },
      JSON.stringify({cutAt, restoredAt, lateBy, disconnects}),
    );
  });

  it('F-2413 AC-33 (c2651-restart-reads): in the legacy mode a value changed 10 s or more before the server dies is the one the new server runs with, started by the automatic reconnection', async () => {
    const name = 'c2651-restart-reads';
    await connectFresh(name, {'remote.SSH.useExecServer': false});
    await userSettings({[GRACE]: 60});
    await new Promise(resolve => setTimeout(resolve, 12_000));
    const before = await serverMain();
    await onHost(
      'pkill',
      '-u',
      'harness',
      '-f',
      `${DATA_FOLDER}/bin/.*/out/server-main.js`,
    );
    await waitFor(
      'a new server with 60 s',
      async () =>
        (await serverMain()) !== '' &&
        (await serverMain()) !== before &&
        (await serverGrace()).parsed.some(line => line.includes('60s')),
      180_000,
    );
    deepStrictEqual((await serverGrace()).parsed, [
      'Parsed CLI argument: 60s -> 60000ms',
    ]);
  });
});
