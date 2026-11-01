import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import {
  appendScript,
  closeWindow,
  connectedWithin,
  hostAnswer,
  kill,
  messagesSince,
  onHost,
  openWindow,
  readUserSettings,
  recordLines,
  reloadWindow,
  restoreUserSettings,
  userSettings,
  variable,
  connected,
} from './harness.ts';
import {
  DATA_FOLDER,
  freshHost,
  INSTALL_MILLISECONDS,
  password,
} from './maintenance.ts';

/** The `Host harness` block of the run's ssh_config, as its lines. */
function harnessBlock(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.indexOf('Host harness');
  const end = lines.indexOf('', start);
  return lines.slice(start, end);
}

describe('more of the server on a socket (card coverage-81)', function () {
  this.timeout(600_000);

  let saved: string | undefined;
  let sshConfig = '';

  before(async () => {
    saved = readUserSettings();
    sshConfig = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8');
    await freshHost();
    await userSettings({
      'remote.SSH.remoteServerListenOnSocket': true,
      'remote.SSH.remotePlatform': {
        harness: 'linux',
        bindmask: 'linux',
        password: 'linux',
      },
    });
  });

  after(async () => {
    writeFileSync(variable('HARNESS_SSH_CONFIG'), sshConfig);
    restoreUserSettings(saved);
    await freshHost();
  });

  it('F-2410 AC-17: with StreamLocalBindMask 0000 and StreamLocalBindUnlink yes in the host’s block the connect succeeds and the server’s socket keeps its mode', async () => {
    const block = harnessBlock(sshConfig).map(line =>
      line === 'Host harness' ? 'Host bindmask' : line,
    );
    writeFileSync(
      variable('HARNESS_SSH_CONFIG'),
      `${sshConfig}\n${[...block, '  StreamLocalBindMask 0000', '  StreamLocalBindUnlink yes'].join('\n')}\n`,
    );
    await openWindow('bindmask', 'm17');
    await connectedWithin('m17', INSTALL_MILLISECONDS);
    deepStrictEqual(
      (
        await onHost(
          'sh',
          '-c',
          'for f in /tmp/code-*; do [ -S "$f" ] && stat -c %A "$f"; done',
        )
      )
        .split('\n')
        .filter(line => line !== ''),
      ['srwxr-xr-x'],
    );
  });

  it('F-2410 AC-33: Kill Local Connection Server For Host... with the connected host picked shows no notification or dialog and the window stays connected', async () => {
    await openWindow('harness', 'm33');
    await connectedWithin('m33', INSTALL_MILLISECONDS);
    appendScript([hostAnswer('m33', {label: 'harness'})]);
    const mark = recordLines().length;
    await kill('m33');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual([messagesSince(mark), await connected('m33')], [[], true]);
  });

  it('F-2410 AC-32: with a password host the input is shown twice, once for the install and once for the tunnel', async () => {
    appendScript([
      {...password(), window: 'm32'},
      {...password(), window: 'm32'},
    ]);
    await openWindow('password', 'm32');
    await connectedWithin('m32', INSTALL_MILLISECONDS);
    const lines = recordLines(undefined, 'm32');
    const tunnel = lines.find(
      line => line.question === 'Setting up SSH tunnel',
    )?.time;
    const [first, second] = lines.filter(
      line => line.surface === 'maskedInput',
    );
    deepStrictEqual(
      [
        lines
          .filter(line => line.surface === 'maskedInput')
          .map(line => line.question),
        (first?.time ?? 0) < (tunnel ?? 0),
        (second?.time ?? 0) >= (tunnel ?? Infinity),
      ],
      [
        [
          'Enter password for harness-pw@127.0.0.1',
          'Enter password for harness-pw@127.0.0.1',
        ],
        true,
        true,
      ],
    );
  });

  it('F-2410 AC-20: with the user value false and the remote machine settings value true the first connect uses a port and the reload uses a socket', async () => {
    await freshHost();
    // The pid files of the servers the earlier rows ended stay behind: this row reads them.
    await onHost('sh', '-c', `rm -f ${DATA_FOLDER}/.*.pid`);
    await userSettings({'remote.SSH.remoteServerListenOnSocket': false});
    const machine = `${DATA_FOLDER}/data/Machine/settings.json`;
    await onHost(
      'sh',
      '-c',
      `mkdir -p ${DATA_FOLDER}/data/Machine && printf '%s' '{"remote.SSH.remoteServerListenOnSocket": true}' > ${machine}`,
    );
    async function pidFiles(): Promise<string[]> {
      return (
        await onHost(
          'sh',
          '-c',
          `for f in ${DATA_FOLDER}/.*.pid; do case "$f" in *.socket.pid) echo socket;; *) echo port;; esac; done 2>/dev/null; true`,
        )
      )
        .split('\n')
        .filter(line => line !== '');
    }
    try {
      await openWindow('harness', 'm20');
      await connectedWithin('m20', INSTALL_MILLISECONDS);
      const first = await pidFiles();
      await reloadWindow('m20');
      await connectedWithin('m20', 60_000);
      deepStrictEqual(
        [first, await pidFiles()],
        [['port'], ['port', 'socket']],
      );
    } finally {
      await onHost('sh', '-c', `rm -f ${machine}`);
      await closeWindow('m20').catch(() => undefined);
    }
  });

  after(async () => {
    for (const name of ['m17', 'm33', 'm32']) {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
