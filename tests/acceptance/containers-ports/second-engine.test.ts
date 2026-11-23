/**
 * @fileoverview F-1101 AC-23 (card tooling-123): a dev container on an engine in its own network namespace, here the
 * run's second daemon reached as `tcp://` through `docker.host`. forwardPorts goes through the window's tunnel to this
 * machine, while appPort publishes on the engine's side only.
 */

import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {
  dockerWith,
  engineSettingsAre,
  secondEngine,
} from '../windows/engine-fixture.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {
  closeWindow,
  readUserSettings,
  reopenInContainer,
  restoreUserSettings,
  runLabelArguments,
  runScopedName,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {statusItem} from '../windows/renderer.ts';
import {echoes, freePort, rowsWhen, showPorts} from './ports-support.ts';

describe('the ports of a dev container on an engine of its own namespace (card tooling-123)', function () {
  this.timeout(900_000);

  it('F-1101 AC-23 (c205-second-engine-ports): with forwardPorts [F] and appPort [A, "H:C"] on a tcp:// engine, F answers on this machine through the tunnel, nothing listens here on A or H, no row is Statically Forwarded, and the status bar counts F alone', async () => {
    const saved = readUserSettings();
    const shared = path.join(
      homedir(),
      '.cache',
      'remote-oss-acceptance',
      runScopedName('c205ports'),
    );
    const folder = path.join(shared, 'c205-ports');
    const [forwarded, published, host, container] = [
      await freePort(),
      await freePort(),
      await freePort(),
      await freePort(),
    ];
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'Ports Elsewhere',
        image: variable('HARNESS_DEVCONTAINER_IMAGE'),
        runArgs: runLabelArguments(),
        forwardPorts: [forwarded],
        appPort: [published, `${String(host)}:${String(container)}`],
      }),
    );
    const second = await secondEngine({shared});
    const engine = {DOCKER_HOST: second.address};
    let window: string | undefined;
    try {
      await engineSettingsAre(saved, {'docker.host': second.address});
      window = await openFolderWindow(folder);
      await reopenInContainer(window);
      const [found = ''] = (
        await dockerWith(
          engine,
          'ps',
          '-q',
          '--filter',
          `label=devcontainer.local_folder=${folder}`,
        )
      ).split('\n');
      await dockerWith(
        engine,
        'exec',
        '-d',
        found,
        'nc',
        '-lk',
        '-p',
        String(forwarded),
        '-e',
        'cat',
      );
      const answersHere = await waitFor(
        `port ${String(forwarded)} to answer through the tunnel`,
        () => echoes(`127.0.0.1:${String(forwarded)}`),
        60_000,
      ).then(
        () => true,
        () => false,
      );
      await showPorts(window);
      const rows = await rowsWhen(window, shown => shown.length > 0);
      deepStrictEqual(
        {
          answersHere,
          publishedHere: await echoes(`127.0.0.1:${String(published)}`),
          hostHere: await echoes(`127.0.0.1:${String(host)}`),
          staticRows: rows.filter(
            each => each.origin === 'Statically Forwarded',
          ).length,
          status: (await statusItem(window, 'status.forwardedPorts')).ariaLabel,
        },
        {
          answersHere: true,
          publishedHere: false,
          hostHere: false,
          staticRows: 0,
          status: `Forwarded Ports: ${String(forwarded)}`,
        },
      );
    } finally {
      if (window !== undefined) {
        await closeWindow(window).catch(() => undefined);
      }
      restoreUserSettings(saved);
      await second.stop();
      rmSync(shared, {recursive: true, force: true});
    }
  });
});
