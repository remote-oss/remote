/**
 * @fileoverview A Remote-SSH window on an SSH host that has Docker (card #3081): the host is the run's second engine
 * with OpenSSH's server (`tests/acceptance/ssh-engine`), whose image is that of the Docker daemon and not the harness
 * host's. This row is the probe the card asks for first: it shows that the editor's server installs and starts there,
 * so that the rows of containers in a Remote-SSH window (F-0207 AC-28 and later) have a host.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  inWindow,
  readUserSettings,
  restoreUserSettings,
  userSettings,
  variable,
  waitFor,
  windowState,
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
    try {
      const port = host.address(ACCOUNT).split(':').pop() ?? '';
      const file = writeConfig(ALIAS, [
        hostBlock(
          ALIAS,
          [
            `Port ${port}`,
            `User ${ACCOUNT}`,
            'StrictHostKeyChecking accept-new',
            `UserKnownHostsFile ${freshKnown(ALIAS)}`,
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
      await waitFor(
        `window ${name} to connect through ${ALIAS}`,
        async () =>
          (await windowState(name).catch(() => undefined))?.remoteName ===
          'ssh-remote',
        240_000,
      ).catch(async (caught: unknown) => {
        throw new Error(
          `${String(caught)}; the host's processes: ${JSON.stringify(await processesOf(host.container))}; ${variable('HARNESS_RUN_FOLDER')}`,
          {cause: caught},
        );
      });
      await inWindow(name, 'acceptance.agent.writeFile', 'probe.txt', name);
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
      await host.stop();
    }
  });
});
