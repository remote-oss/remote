/**
 * @fileoverview A Remote-SSH window on an SSH host that has Docker (card #3081): the host is the run's second engine
 * with OpenSSH's server (`tests/acceptance/ssh-engine`), whose image is that of the Docker daemon and not the harness
 * host's. This row is the probe the card asks for first: it shows that the editor's server installs and starts there,
 * so that the rows of containers in a Remote-SSH window (F-0207 AC-28 and later) have a host.
 */

import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  waitFor,
} from '../windows/harness.ts';
import {
  ASK_WITHOUT,
  freshKnown,
  hostBlock,
  writeConfig,
} from '../windows/config-keywords-support.ts';
import {ownEngineDocker, sshEngine} from '../windows/engine-fixture.ts';

/** The account of the host that logs in by the run's key. */
const ACCOUNT = 'engine';

/** The alias the window connects through. */
const ALIAS = 'c3081-docker-host';

/** The processes of container `container`, by their command lines. */
async function processesOf(container: string): Promise<string[]> {
  return (await ownEngineDocker('exec', container, 'ps', '-o', 'args'))
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '');
}

describe('a Remote-SSH window on an SSH host with Docker (card #3081)', function () {
  this.timeout(900_000);

  it('c3081-probe: a window connects to the second engine host over SSH, and the editor’s server runs in its container', async () => {
    const host = await sshEngine();
    const saved = readUserSettings();
    const name = ALIAS;
    const known = freshKnown(ALIAS);
    let file = '';
    try {
      const port = host.address(ACCOUNT).split(':').pop() ?? '';
      file = writeConfig(ALIAS, [
        hostBlock(
          ALIAS,
          [
            `Port ${port}`,
            `User ${ACCOUNT}`,
            'StrictHostKeyChecking accept-new',
            `UserKnownHostsFile ${known}`,
          ],
          ['Port', 'User', ...ASK_WITHOUT],
        ),
      ]);
      await userSettings({
        'remote.SSH.configFile': file,
        'remote.SSH.remotePlatform': {[ALIAS]: 'linux'},
      });
      await ownEngineDocker(
        'exec',
        host.container,
        'sh',
        '-c',
        `mkdir -p /home/${ACCOUNT}/${name} && chown ${ACCOUNT} /home/${ACCOUNT}/${name}`,
      );
      void inWindow(
        'local',
        'acceptance.agent.openWindow',
        `vscode-remote://ssh-remote+${ALIAS}/home/${ACCOUNT}/${name}`,
      );
      // The window carries the remote's name from the start, so it is connected once a file it writes through its remote
      // file system reaches the host's container.
      await waitFor(
        `window ${name} to connect through ${ALIAS}`,
        async () => {
          try {
            await inWindow(
              name,
              'acceptance.agent.writeFile',
              'probe.txt',
              name,
            );
            return (
              (await ownEngineDocker(
                'exec',
                host.container,
                'cat',
                `/home/${ACCOUNT}/${name}/probe.txt`,
              )) === name
            );
          } catch {
            return false;
          }
        },
        240_000,
      ).catch(async (caught: unknown) => {
        throw new Error(
          `${String(caught)}; the host's processes: ${JSON.stringify(await processesOf(host.container))}`,
          {cause: caught},
        );
      });
      const probe = await ownEngineDocker(
        'exec',
        host.container,
        'cat',
        `/home/${ACCOUNT}/${name}/probe.txt`,
      );
      const running = (await processesOf(host.container)).filter(line =>
        line.includes('server'),
      );
      deepStrictEqual(
        {probe, serverRuns: running.length > 0},
        {probe: name, serverRuns: true},
        `the host's processes: ${JSON.stringify(await processesOf(host.container))}`,
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      restoreUserSettings(saved);
      // The row's own config and known hosts file go with it: nothing of it stays in the run's folder.
      rmSync(file, {force: true});
      rmSync(known, {force: true});
      await host.stop();
    }
  });
});
