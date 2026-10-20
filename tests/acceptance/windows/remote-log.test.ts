import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectionLog,
  onHost,
  readUserSettings,
  restoreUserSettings,
  userSettings,
} from './harness.ts';
import {
  closeAllButLocal,
  DATA_FOLDER,
  INSTALL_MILLISECONDS,
  openConnected,
} from './maintenance.ts';

/** Ends the host's servers and removes their installs, so that the next connect installs the server afresh. */
async function freshHost(): Promise<void> {
  await closeAllButLocal();
  // The bracket keeps pkill's pattern from matching this shell's own command line.
  const servers = `${DATA_FOLDER.replace('/.', '/[.]')}/bin/`;
  await onHost(
    'sh',
    '-c',
    `pkill -f '${servers}' || true; rm -rf '${DATA_FOLDER}/bin' '${DATA_FOLDER}/cli'`,
  );
}

/**
 * What the log of one connect shows of the remote side: whether it has remote output, an install step, and the
 * script's unpack progress among the remote output.
 */
function remoteSideOf(lines: readonly string[]): {
  remoteOutput: boolean;
  installing: boolean;
  unpackProgress: boolean;
} {
  const remote = lines.filter(line => line.startsWith('[remote] '));
  return {
    remoteOutput: remote.length > 0,
    installing: lines.includes('Progress: installing'),
    unpackProgress: remote.some(line =>
      line.includes('remote-oss-server-progress unpack'),
    ),
  };
}

describe('the remote install and start output in the log (card connect-67)', function () {
  this.timeout(600_000);

  it('F-2003 AC-11 (remote-output): a fresh install logs the remote output and its progress, and never the server\u2019s token (BR-6 item 8, BR-14)', async () => {
    await freshHost();
    const mark = connectionLog().length;
    await openConnected('rl1', INSTALL_MILLISECONDS);
    try {
      const lines = connectionLog().slice(mark);
      const tokens = (
        await onHost(
          'sh',
          '-c',
          `find '${DATA_FOLDER}' -maxdepth 3 -name '*.token' -exec cat {} +`,
        )
      )
        .split('\n')
        .filter(token => token !== '');
      deepStrictEqual(
        {
          ...remoteSideOf(lines),
          tokenRead: tokens.length > 0,
          tokenLogged: lines.some(line =>
            tokens.some(token => line.includes(token)),
          ),
        },
        {
          remoteOutput: true,
          installing: true,
          unpackProgress: true,
          tokenRead: true,
          tokenLogged: false,
        },
      );
    } finally {
      await closeWindow('rl1');
    }
  });

  it('F-2003 AC-29 (terminal-install): a fresh terminal-mode install at trace logs the remote output, and no local connection server (BR-16)', async () => {
    const saved = readUserSettings();
    await userSettings({
      'remote.SSH.useLocalServer': false,
      'remote.SSH.remotePlatform': {harness: 'linux'},
      'remote.SSH.logLevel': 'trace',
    });
    try {
      await freshHost();
      const mark = connectionLog().length;
      await openConnected('rl2', INSTALL_MILLISECONDS);
      try {
        const lines = connectionLog().slice(mark);
        deepStrictEqual(
          {
            ...remoteSideOf(lines),
            localServer: lines.some(line =>
              /local connection server/i.test(line),
            ),
          },
          {
            remoteOutput: true,
            installing: true,
            unpackProgress: true,
            localServer: false,
          },
        );
      } finally {
        await closeWindow('rl2');
      }
    } finally {
      restoreUserSettings(saved);
    }
  });
});
