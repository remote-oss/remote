/**
 * @fileoverview A user's ControlPersist master outlives the end of the attempt that started it (card #2664, F-2102
 * 6.8): the product ends the process group of the ssh it started, and the master, which OpenSSH detaches into a session
 * of its own, is not in it.
 */

import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  inWindow,
  windowState,
} from '../windows/harness.ts';
import {connectWith, launchSsh} from '../windows/config-keywords-support.ts';
import {pickHost} from '../windows/maintenance.ts';

const execFileAsync = promisify(execFile);

/** The ControlPersist master processes of this user, as `pid ppid pgid sid`, with the command line of each. */
async function masters(alias: string): Promise<string[]> {
  const {stdout} = await execFileAsync('ps', [
    '-u',
    String(process.getuid?.() ?? 0),
    '-o',
    'pid=,ppid=,pgid=,sid=,args=',
  ]);
  return stdout
    .split('\n')
    .filter(line => line.includes(alias) && line.includes('[mux]'));
}

describe('a ControlPersist master and the end of the attempt (card #2664, F-2102 6.8)', function () {
  this.timeout(300_000);

  /**
   * The answer of `ssh -O check` once the window of `mode` ended its attempt, by closing the window or, in the local-server
   * mode, by Kill Local Connection Server, whether the window is then still connected, and the master as `ps` shows it before.
   */
  async function checkAfterEnd(
    mode: 'server' | 'terminal',
    ending: 'close' | 'kill' = 'close',
  ): Promise<{
    connected: boolean;
    before: string[];
    check: string;
    stillConnected: boolean | undefined;
  }> {
    const alias = `c2664-cp-${mode}`;
    return connectWith(
      alias,
      [
        'ControlMaster auto',
        'ControlPersist 600',
        `ControlPath /tmp/c2664-cp-${mode}-%C`,
      ],
      'connects',
      async (connect, file) => {
        const before = await masters(alias);
        if (ending === 'kill') {
          // Kill Local Connection Server For Host... asks which host; the script takes the alias.
          appendScript([pickHost(alias)]);
          await inWindow(alias, 'opensshremotes.cleanLocalServer');
        } else {
          await closeWindow(alias);
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        const stillConnected =
          ending === 'kill'
            ? (await windowState(alias)).remoteName === 'ssh-remote'
            : undefined;
        let after: string;
        try {
          after = (
            await execFileAsync(launchSsh(), ['-F', file, '-O', 'check', alias])
          ).stderr.trim();
        } catch (failure) {
          after = `failed: ${(failure as {stderr?: string}).stderr ?? ''}`;
        }
        await execFileAsync(launchSsh(), [
          '-F',
          file,
          '-O',
          'exit',
          alias,
        ]).catch(() => undefined);
        return {
          connected: connect.connected,
          before,
          check: after,
          stillConnected,
        };
      },
      {
        settings: {
          ...(mode === 'terminal' ? {'remote.SSH.useLocalServer': false} : {}),
          'remote.SSH.remotePlatform': {[alias]: 'linux'},
        },
      },
    );
  }

  it('card #2664 (c2664-control-persist-server): in the local-server mode the master is still running after the window ended its attempt', async () => {
    const found = await checkAfterEnd('server');
    deepStrictEqual(
      found.check.startsWith('Master running'),
      true,
      JSON.stringify(found),
    );
  });

  it('card #2664 (c2664-control-persist-terminal): in the terminal mode the master is still running after the window ended its attempt', async () => {
    const found = await checkAfterEnd('terminal');
    deepStrictEqual(
      found.check.startsWith('Master running'),
      true,
      JSON.stringify(found),
    );
  });

  it('card #2664 (c2664-control-persist-kill): Kill Local Connection Server leaves the master running and the window connected', async () => {
    const found = await checkAfterEnd('server', 'kill');
    deepStrictEqual(
      [found.check.startsWith('Master running'), found.stillConnected],
      [true, true],
      JSON.stringify(found),
    );
  });
});
