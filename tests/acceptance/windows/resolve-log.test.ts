import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  connectionLog,
  hostPassword,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
} from './harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  dismissals,
  freshHost,
  INSTALL_MILLISECONDS,
  openConnected,
} from './maintenance.ts';

/** The connection tokens of the servers the host's data folder holds. */
async function hostTokens(): Promise<string[]> {
  return (
    await onHost(
      'sh',
      '-c',
      `find '${DATA_FOLDER}' -maxdepth 3 -name '*.token' -exec cat {} +`,
    )
  )
    .split('\n')
    .filter(token => token !== '');
}

/** The index of the first line of `lines` that starts with `start`; -1 when none does. */
function firstStarting(lines: readonly string[], start: string): number {
  return lines.findIndex(line => line.startsWith(start));
}

describe('the resolve and its ports in the log (card connect-65)', function () {
  this.timeout(600_000);

  after(async () => {
    await closeAllButLocal();
  });

  it('F-2003 BR-6 items 1, 9 and 10 (resolve-lines): on a fresh install the log names the resolve, then the remote side, then the ports', async () => {
    await freshHost();
    const mark = connectionLog().length;
    await openConnected('rs1', INSTALL_MILLISECONDS);
    try {
      const lines = connectionLog().slice(mark);
      const resolving = lines.indexOf(
        'Resolving ssh-remote+harness, attempt 1',
      );
      const remote = firstStarting(lines, '[remote] ');
      const result = lines.findLastIndex(line =>
        line.startsWith('Server result: '),
      );
      const listening = firstStarting(
        lines,
        'Remote server listening on port ',
      );
      const resolved = firstStarting(
        lines,
        'Resolved ssh-remote+harness to local port ',
      );
      deepStrictEqual(
        {
          inOrder:
            resolving >= 0 &&
            resolving < remote &&
            remote < result &&
            result < listening &&
            listening < resolved,
          installing: lines.indexOf('Progress: installing') > resolving,
          ports: [
            /^Remote server listening on port \d+$/.test(
              lines[listening] ?? '',
            ),
            /^Resolved ssh-remote\+harness to local port \d+$/.test(
              lines[resolved] ?? '',
            ),
          ],
        },
        {inOrder: true, installing: true, ports: [true, true]},
      );
    } finally {
      await closeWindow('rs1');
    }
  });

  it('F-2003 AC-16 (typed-answers): neither a wrong nor the right password typed into the question is in the log', async () => {
    const wrong = `wr0ngPw-${variable('HARNESS_RUN_ID')}`;
    const mark = connectionLog().length;
    appendScript([
      {
        surface: 'maskedInput',
        match: 'password',
        answer: {text: wrong},
        window: 'pw1',
      },
      ...dismissals('pw1'),
    ]);
    await openWindow('password', 'pw1');
    await waitFor(
      'the failure dialog of the wrong password',
      () => recordLines('failureDialog', 'pw1').length > 0,
      INSTALL_MILLISECONDS,
    );
    await closeWindow('pw1');
    appendScript([
      {
        surface: 'maskedInput',
        match: 'password',
        answer: {text: hostPassword()},
        window: 'pw2',
      },
    ]);
    await openWindow('password', 'pw2');
    try {
      await connectedWithin('pw2', INSTALL_MILLISECONDS);
      const text = connectionLog().slice(mark).join('\n');
      deepStrictEqual(
        [text.includes(wrong), text.includes(hostPassword())],
        [false, false],
      );
    } finally {
      await closeWindow('pw2');
    }
  });

  it('F-2003 AC-21 (sentinel-and-token): a fresh connect at debug, and another at trace, log neither the environment sentinel nor the server’s token', async () => {
    const sentinel = variable('REMOTE_OSS_SENTINEL');
    const saved = readUserSettings();
    const seen: Array<{level: string; sentinel: boolean; token: boolean}> = [];
    try {
      for (const level of ['debug', 'trace']) {
        await userSettings({'remote.SSH.logLevel': level});
        await freshHost();
        const mark = connectionLog().length;
        await openConnected('se1', INSTALL_MILLISECONDS);
        try {
          const lines = connectionLog().slice(mark);
          const tokens = await hostTokens();
          seen.push({
            level,
            sentinel: lines.some(line => line.includes(sentinel)),
            token:
              tokens.length === 0 ||
              lines.some(line => tokens.some(token => line.includes(token))),
          });
        } finally {
          await closeWindow('se1');
        }
      }
    } finally {
      restoreUserSettings(saved);
    }
    deepStrictEqual(seen, [
      {level: 'debug', sentinel: false, token: false},
      {level: 'trace', sentinel: false, token: false},
    ]);
  });
});
