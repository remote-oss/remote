import {deepStrictEqual} from 'node:assert';
import {readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  connectedWithin,
  connectionLog,
  variable,
  reloadWindow,
  terminalNames,
  waitFor,
} from '../windows/harness.ts';
import {
  INSTALL_MILLISECONDS,
  linesSince,
  pickHost,
  runWith,
  serverProcesses,
  serversGoneWithin,
  setting,
} from '../windows/maintenance.ts';
import {
  failedOn,
  surfaceLines,
  removeHomeFiles,
  freshServer,
  taskEnvironment,
  withWindow,
  writeHomeFile,
} from './shell-support.ts';

describe('login shells in the window, by mode and by command (card coverage-49)', function () {
  this.timeout(900_000);

  it('F-2704 AC-22 (kill-server): after Kill VS Code Server on Host the window reconnects to a new server within 60 s, and after a reload a task sees the changed .profile', async () => {
    await freshServer('harness-bash');
    await writeHomeFile('harness-bash', '.profile', 'export F2704_KILL=old\n');
    try {
      await withWindow('harness-bash', 'wm-ac22', async () => {
        const window = 'wm-ac22';
        const servers = await serverProcesses();
        await writeHomeFile(
          'harness-bash',
          '.profile',
          'export F2704_KILL=new\n',
        );
        const killedAt = Date.now();
        const mark = await runWith(
          'local',
          'opensshremotes.cleanRemoteServer',
          [pickHost('harness-bash')],
        );
        await serversGoneWithin(servers, 10_000);
        await waitFor(
          `${window} to be resolved again by core’s reconnection`,
          () =>
            linesSince(mark, window).some(
              line =>
                line.surface === 'progress' &&
                line.question === 'Setting up SSH Host harness-bash',
            ),
          60_000,
        );
        const reconnectedAt =
          linesSince(mark, window).find(
            line =>
              line.surface === 'progress' &&
              line.question === 'Setting up SSH Host harness-bash',
          )?.time ?? Infinity;
        await reloadWindow(window);
        await connectedWithin(window, INSTALL_MILLISECONDS);
        deepStrictEqual(
          [
            reconnectedAt - killedAt < 30_000,
            (await taskEnvironment(window, 'harness-bash', 'wm-ac22'))
              .F2704_KILL,
          ],
          [true, 'new'],
        );
      });
    } finally {
      await removeHomeFiles('harness-bash', '.profile');
    }
  });

  /** Runs `body` in the terminal mode: no local server, and the platform of `harness-bash` named so that no pick is asked. */
  async function inTerminalMode(body: () => Promise<void>): Promise<void> {
    await setting('remote.SSH.remotePlatform', {'harness-bash': 'linux'});
    await setting('remote.SSH.useLocalServer', false);
    try {
      await body();
    } finally {
      await setting('remote.SSH.showLoginTerminal', undefined);
      await setting('remote.SSH.useLocalServer', undefined);
      await setting('remote.SSH.remotePlatform', undefined);
      await removeHomeFiles('harness-bash', '.profile');
    }
  }

  it('F-2704 AC-18 (terminal-output): in the terminal mode a .profile that prints a line still connects, and the line is not in the log', async () => {
    await inTerminalMode(async () => {
      await freshServer('harness-bash');
      await writeHomeFile('harness-bash', '.profile', 'echo F2704-PRINTED\n');
      const mark = connectionLog().length;
      await withWindow('harness-bash', 'wm-ac18', () => Promise.resolve());
      deepStrictEqual(
        connectionLog()
          .slice(mark)
          .filter(line => line.includes('F2704-PRINTED')),
        [],
      );
    });
  });

  it('F-2704 AC-19 (login-terminal-name): in the terminal mode with remote.SSH.showLoginTerminal the window holds a terminal named install', async () => {
    await inTerminalMode(async () => {
      await setting('remote.SSH.showLoginTerminal', true);
      await freshServer('harness-bash');
      const names = await withWindow('harness-bash', 'wm-ac19', () =>
        terminalNames('wm-ac19'),
      );
      deepStrictEqual(names, ['install']);
    });
  });

  /** The stanza of the run's file for `Host harness-bash`, as lines. */
  function bashStanza(): string[] {
    const lines = readFileSync(variable('HARNESS_SSH_CONFIG'), 'utf8').split(
      '\n',
    );
    const start = lines.indexOf('Host harness-bash');
    const length = lines
      .slice(start + 1)
      .findIndex(line => !line.startsWith(' '));
    return lines.slice(start + 1, start + 1 + length);
  }

  /** Runs `body` with `remote.SSH.configFile` naming a file that includes the run's and adds the hosts `remoteCommands` names, each with its RemoteCommand. */
  async function withRemoteCommands(
    remoteCommands: Readonly<Record<string, string>>,
    body: () => Promise<void>,
  ): Promise<void> {
    const file = path.join(variable('HARNESS_RUN_FOLDER'), 'ssh_config_rc');
    writeFileSync(
      file,
      [
        `Include ${variable('HARNESS_SSH_CONFIG')}`,
        '',
        ...Object.entries(remoteCommands).flatMap(([alias, command]) => [
          `Host ${alias}`,
          ...bashStanza(),
          `  RemoteCommand ${command}`,
          '',
        ]),
      ].join('\n'),
    );
    await setting('remote.SSH.configFile', file);
    try {
      await body();
    } finally {
      await setting('remote.SSH.enableRemoteCommand', undefined);
      await setting('remote.SSH.configFile', variable('HARNESS_SSH_CONFIG'));
    }
  }

  it('F-2704 AC-30 (remote-command-off): a host with RemoteCommand exec zsh -l is connected as bash while remote.SSH.enableRemoteCommand is off', async () => {
    await withRemoteCommands({'rc-zsh': 'exec zsh -l'}, async () => {
      await freshServer('harness-bash');
      await setting('remote.SSH.enableRemoteCommand', false);
      const mark = connectionLog().length;
      await withWindow('rc-zsh', 'wm-ac30', () => Promise.resolve());
      deepStrictEqual(
        connectionLog()
          .slice(mark)
          .filter(line => line.includes('login shell is')),
        ["the host's login shell is /bin/bash (bash)"],
      );
    });
  });

  it('F-2704 AC-31 (remote-command-echo): a host with RemoteCommand echo hi and enableRemoteCommand on fails within 5 s with the dialog of AC-13 and no notice', async () => {
    await withRemoteCommands({'rc-end': 'echo hi'}, async () => {
      await freshServer('harness-bash');
      await setting('remote.SSH.enableRemoteCommand', true);
      const failed = await failedOn('rc-end', 'wm-ac31', 60_000);
      deepStrictEqual(
        {
          question: failed.dialog.question,
          buttons: failed.dialog.buttons,
          quick: failed.dialog.sinceConnectStarted < 2000,
          notices: surfaceLines('wm-ac31', 'notice'),
        },
        {
          question: 'Could not establish connection to "rc-end".',
          buttons: ['Close Remote', 'Retry', 'More Actions...'],
          quick: true,
          notices: [],
        },
      );
    });
  });
});
