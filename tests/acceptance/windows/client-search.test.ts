import {deepStrictEqual} from 'node:assert';
import {existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {redact} from 'lib-log';
import {
  appendScript,
  closeWindow,
  connectionHelpers,
  connectionLog,
  inWindow,
  openWindow,
  readUserSettings,
  reloadWindow,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowEvents,
  windowState,
} from './harness.ts';

/** The program of the fake client `name`, as the harness wrote it. */
function client(name: string): string {
  return path.join(variable('HARNESS_RUN_FOLDER'), 'clients', `${name}/ssh`);
}

/** The lines the fakes' calls log holds. */
function callLines(): string[] {
  const file = path.join(
    variable('HARNESS_RUN_FOLDER'),
    'clients',
    'calls.log',
  );
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(line => line !== '')
    : [];
}

/** coverage-14 §2's "connected": the window is on the host and can put a file there. */
async function connected(name: string): Promise<void> {
  await waitFor(
    `window ${name} to connect`,
    async () => (await windowState(name)).remoteName === 'ssh-remote',
    60_000,
  );
  await inWindow(name, 'acceptance.agent.writeFile', 'probe.txt', name);
}

/** The log's not-valid line for a configured client, as log-content's notValidLine writes it, redacted the way the log writes it: the windows suite's tsconfig references no product package, so the shape is inlined. */
function notValid(program: string): string {
  return redact(`remote.SSH.path "${program}" is not a valid SSH binary`, []);
}

/** The user settings' bytes at the file's start, put back whatever failed. */
let settingsBytes: string | undefined;

describe('the client search of windows (F-2101 AC-3, 14, 15, 16)', function () {
  this.timeout(180_000);

  before(async () => {
    // Close every window of the earlier files that is still open, and wait out their helpers.
    const folder = path.dirname(variable('REMOTE_OSS_ACCEPTANCE_WINDOWS'));
    const names = existsSync(folder)
      ? readdirSync(folder)
          .map(file => file.replace(/\.events\.jsonl$/, ''))
          .filter(name => name !== 'local' && !name.startsWith('empty-'))
      : [];
    for (const name of names) {
      const events = windowEvents(name);
      if (
        events.some(each => each.event === 'activated') &&
        !events.some(each => each.event === 'deactivated')
      ) {
        await closeWindow(name);
      }
    }
    await waitFor(
      'no connection helper of the run',
      async () => (await connectionHelpers()).length === 0,
      60_000,
    );
    settingsBytes = readUserSettings();
  });

  after(() => {
    restoreUserSettings(settingsBytes);
  });

  it('F-2101 AC-3 (new-window): a new window on the host runs the configured client for check, options and connect', async () => {
    const callsStart = callLines().length;
    await userSettings({'remote.SSH.path': client('configured')});
    await openWindow('harness', 'cs1');
    try {
      await connected('cs1');
      deepStrictEqual(callLines().slice(callsStart), [
        'configured/ssh\tcheck',
        'configured/ssh\toptions',
        'configured/ssh\tconnect',
      ]);
    } finally {
      await closeWindow('cs1');
    }
  });

  it('F-2101 AC-14 (reload-invalid): a reload with an invalid remote.SSH.path connects through the running server with no check and no lookup', async () => {
    await userSettings({'remote.SSH.path': client('configured')});
    await openWindow('harness', 'cs14');
    try {
      await connected('cs14');
      await userSettings({'remote.SSH.path': '/nonexistent/ssh'});
      const callsStart = callLines().length;
      await reloadWindow('cs14');
      await connected('cs14');
      deepStrictEqual(callLines().slice(callsStart), []);
    } finally {
      await closeWindow('cs14');
    }
  });

  it('F-2101 AC-15: in terminal mode a connect checks the client, rejects it, and connects through the PATH', async () => {
    const callsStart = callLines().length;
    const logStart = connectionLog().length;
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': {harness: 'linux'},
      'remote.SSH.path': client('fails'),
    });
    await openWindow('harness', 'cs3');
    try {
      await connected('cs3');
      const invalid = notValid(client('fails'));
      deepStrictEqual(
        [
          callLines().slice(callsStart),
          connectionLog()
            .slice(logStart)
            .filter(line => line === invalid).length,
        ],
        [['fails/ssh\tcheck'], 1],
      );
    } finally {
      await closeWindow('cs3');
    }
  });

  it('F-2101 AC-15: in terminal mode a reload checks the client again, and no client answers options or connect', async () => {
    await openWindow('harness', 'cs4');
    try {
      await connected('cs4');
      const callsStart = callLines().length;
      const logStart = connectionLog().length;
      await reloadWindow('cs4');
      await connected('cs4');
      const invalid = notValid(client('fails'));
      deepStrictEqual(
        [
          callLines().slice(callsStart),
          connectionLog()
            .slice(logStart)
            .filter(line => line === invalid).length,
        ],
        [['fails/ssh\tcheck'], 1],
      );
    } finally {
      await closeWindow('cs4');
    }
  });

  it('F-2101 AC-16: an empty window from the local host pick runs no client and logs no client line', async () => {
    const callsStart = callLines().length;
    const logStart = connectionLog().length;
    const recordStart = recordLines().length;
    restoreUserSettings(settingsBytes);
    await userSettings({'remote.SSH.path': client('configured')});
    appendScript([
      {
        surface: 'hostPick',
        match: 'Select configured SSH host',
        answer: 'dismiss',
        window: 'local',
      },
    ]);
    await inWindow('local', 'opensshremotes.openEmptyWindow');
    const hostPick = recordLines()
      .slice(recordStart)
      .filter(line => line.surface === 'hostPick' && line.window === 'local');
    deepStrictEqual(
      [
        hostPick.length,
        callLines().slice(callsStart),
        connectionLog()
          .slice(logStart)
          .filter(
            line =>
              line.startsWith('Checking ssh client: ') ||
              line.startsWith('Using ssh client: '),
          ),
      ],
      [1, [], []],
    );
  });
});
