import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  changed,
  connectedWindow,
  dockerInLaunch,
  noticesAfter,
  noticesWhen,
  rewriteConfiguration,
  storedHashes,
} from '../windows/config-watch-support.ts';
import {
  closeWindow,
  connectedToContainer,
  devContainerFolder,
  devContainersOf,
  reloadWindow,
  runScopedName,
} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';

describe('the rebuild prompt on a reconnect to an existing container (card coverage-106)', function () {
  this.timeout(900_000);

  it('F-0303 AC-12b, AC-12c (c106-reuse): a stopped container reconnected by a window that holds its acknowledgment is told the edit and keeps the acknowledgment; reconnected by a window of another workspace identity (the Docker context is in the authority) the edit is acknowledged silently, and a further edit is told; the container is the same each time and the edit is not applied', async () => {
    const context = runScopedName('c106ctx');
    const folder = devContainerFolder('c106-reuse', {name: 'C106 Reuse'});
    await dockerInLaunch(
      'context',
      'create',
      context,
      '--docker',
      'host=unix:///var/run/docker.sock',
    );
    let name = await connectedWindow(folder);
    await new Promise(resolve => setTimeout(resolve, 5000));
    const built = storedHashes(folder, {without: context});
    const [container = ''] = await devContainersOf(folder);
    const containers: string[] = [];
    const seen: string[][] = [];
    try {
      await closeWindow(name);
      await dockerInLaunch('stop', container);
      rewriteConfiguration(folder, {containerEnv: {R9_CE: 'edited'}});
      name = await connectedWindow(folder);
      containers.push(...(await devContainersOf(folder)));
      seen.push(await noticesWhen(name, 1));
      const kept = storedHashes(folder, {without: context});
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      seen.push(await noticesWhen(name, 1));
      await closeWindow(name);
      await dockerInLaunch('stop', container);
      await dockerInLaunch('context', 'use', context);
      name = await connectedWindow(folder);
      containers.push(...(await devContainersOf(folder)));
      seen.push(await noticesAfter(name, 8));
      const seeded = storedHashes(folder, {context});
      const edited = createHash('sha256')
        .update(
          readFileSync(path.join(folder, '.devcontainer', 'devcontainer.json')),
        )
        .digest('hex');
      await reloadWindow(name);
      await connectedToContainer(name, 300_000);
      seen.push(await noticesAfter(name, 8));
      rewriteConfiguration(folder, {containerEnv: {R9_CE: 'again'}});
      seen.push(await noticesWhen(name, 1));
      const environment = await dockerInLaunch(
        'inspect',
        '-f',
        '{{json .Config.Env}}',
        container,
      );
      deepStrictEqual(
        {
          seen,
          sameContainer: containers.every(each => each === container),
          applied: environment.includes('R9_CE'),
          builtHashes: Object.keys(built ?? {}),
          unchanged: kept,
          seeded: seeded?.['devcontainer.json'],
        },
        {
          seen: [
            [changed('devcontainer.json')],
            [changed('devcontainer.json')],
            [],
            [],
            [changed('devcontainer.json')],
          ],
          sameContainer: true,
          applied: false,
          builtHashes: ['devcontainer.json'],
          unchanged: built,
          seeded: edited,
        },
      );
    } finally {
      await dockerInLaunch('context', 'use', 'default').catch(() => undefined);
      await dockerInLaunch('context', 'rm', '--force', context).catch(
        () => undefined,
      );
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
