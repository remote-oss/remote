import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectionLog,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
} from './harness.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
  openConnected,
} from './maintenance.ts';

/** The `[ssh] ` lines of the log written after `mark`, without the prefix. */
function sshLinesSince(mark: number): string[] {
  return connectionLog()
    .slice(mark)
    .filter(line => line.startsWith('[ssh] '))
    .map(line => line.slice('[ssh] '.length));
}

/** What the lines of one connect at `level` show, as the rows state it. */
function shapeOf(lines: readonly string[]): {
  authenticated: boolean;
  debugLines: number;
  hostKeyOnly: boolean;
} {
  const debug = lines.filter(line => line.startsWith('debug1: '));
  return {
    authenticated: lines.some(line => line.startsWith('Authenticated to ')),
    debugLines: debug.length,
    hostKeyOnly: debug.every(line => line.includes('Server host key')),
  };
}

describe('ssh’s own lines in the log (card connect-66)', function () {
  this.timeout(600_000);

  let saved: ReturnType<typeof readUserSettings>;

  beforeEach(async () => {
    saved = readUserSettings();
    await closeAllButLocal();
  });

  afterEach(async () => {
    restoreUserSettings(saved);
    await closeAllButLocal();
  });

  it('F-2003 BR-8 (ssh-debug): at debug the log holds ssh’s lines without debug1, but the server host key’s', async () => {
    await userSettings({'remote.SSH.logLevel': 'debug'});
    const mark = connectionLog().length;
    await openConnected('sl1', INSTALL_MILLISECONDS);
    try {
      const lines = sshLinesSince(mark);
      deepStrictEqual(
        {
          ...shapeOf(lines),
          debugLines:
            lines.filter(line => line.startsWith('debug1: ')).length <= 1,
        },
        {authenticated: true, debugLines: true, hostKeyOnly: true},
      );
    } finally {
      await closeWindow('sl1');
    }
  });

  it('F-2003 BR-9 point 1 (ssh-trace): at trace the log holds ssh’s debug1 lines too', async () => {
    await userSettings({'remote.SSH.logLevel': 'trace'});
    const mark = connectionLog().length;
    await openConnected('sl2', INSTALL_MILLISECONDS);
    try {
      const lines = sshLinesSince(mark);
      deepStrictEqual(
        {
          authenticated: shapeOf(lines).authenticated,
          debugLines:
            lines.filter(line => line.startsWith('debug1: ')).length > 1,
        },
        {authenticated: true, debugLines: true},
      );
    } finally {
      await closeWindow('sl2');
    }
  });

  for (const level of ['debug', 'trace']) {
    it(`F-2003 AC-24 (ssh-refused-${level}): a refused connect logs ssh’s refusal line verbatim at ${level}`, async () => {
      await userSettings({'remote.SSH.logLevel': level});
      const mark = connectionLog().length;
      const window = `sr-${level}`;
      appendScript([...dismissals(window)]);
      await openWindow('refused', window);
      await waitFor(
        `the failure dialog of ${window}`,
        () => recordLines('failureDialog', window).length > 0,
        INSTALL_MILLISECONDS,
      );
      const lines = sshLinesSince(mark);
      await closeWindow(window);
      deepStrictEqual(
        [
          lines.some(
            line =>
              line.startsWith('ssh: connect to host 127.0.0.1 port ') &&
              line.endsWith('Connection refused'),
          ),
          lines.filter(line => line.startsWith('debug1: ')).length > 0,
        ],
        [true, level === 'trace'],
      );
    });
  }
});
