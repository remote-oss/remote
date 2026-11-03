/**
 * @fileoverview F-0205 with a Docker engine reached over SSH (card tooling-123): the Dev Containers view through an
 * `ssh://` context, the window's title and indicator, and a host that stops answering and comes back. The engine is the
 * run's SSH Docker host (`sshEngine`), whose key is known and whose `engine` account takes the run's key.
 */

import {deepStrictEqual} from 'node:assert';
import {
  dockerWith,
  lists,
  showsNoEngine,
  sshClientEnvironment,
  sshEngine,
  type SshEngine,
} from '../windows/engine-fixture.ts';
import {runScopedName, waitFor} from '../windows/harness.ts';
import {
  connectSurface,
  dialogOf,
  inputBoxOf,
  toastDetails,
  windowTitle,
} from '../windows/renderer.ts';

/** What the local window shows besides the view: its title, its remote indicator, and any dialog, toast or input box. */
async function surfaceOf(): Promise<{
  title: string;
  indicator: string;
  dialog: boolean;
  toasts: string[];
  inputBox: boolean;
}> {
  return {
    title: await windowTitle('local'),
    indicator: (await connectSurface('local')).indicator,
    dialog: (await dialogOf('local')) !== undefined,
    toasts: (await toastDetails('local')).map(each => each.message),
    inputBox: (await inputBoxOf('local')) !== undefined,
  };
}

describe('F-0205, the Dev Containers view on an engine reached over SSH (card tooling-123)', function () {
  this.timeout(900_000);
  let engine: SshEngine;
  const context = runScopedName('c205-ssh');

  before(async () => {
    engine = await sshEngine();
    await dockerWith(
      sshClientEnvironment(),
      'context',
      'create',
      context,
      '--docker',
      `host=${engine.address('engine')}`,
    );
  });

  afterEach(async () => {
    await dockerWith({}, 'context', 'use', 'default').catch(() => undefined);
  });

  after(async () => {
    await dockerWith({}, 'context', 'rm', '--force', context).catch(
      () => undefined,
    );
    await engine.stop();
  });

  it('F-0205 AC-1 (c205-view): with an ssh:// context made current, the view lists the container only that engine holds, and no dialog, notification or input box shows', async () => {
    await dockerWith({}, 'context', 'use', context);
    const listed = await lists(engine.marker);
    const {dialog, toasts, inputBox} = await surfaceOf();
    deepStrictEqual(
      {listed, dialog, toasts, inputBox},
      {listed: true, dialog: false, toasts: [], inputBox: false},
    );
  });

  it('F-0205 AC-18 (c205-title): with the view listing the engine over SSH, the window’s title and remote indicator read as with the local engine', async () => {
    const local = await surfaceOf();
    await dockerWith({}, 'context', 'use', context);
    const listed = await lists(engine.marker);
    const remote = await surfaceOf();
    deepStrictEqual(
      {listed, title: remote.title, indicator: remote.indicator},
      {listed: true, title: local.title, indicator: local.indicator},
    );
  });

  it('F-0205 AC-20 (c205-back): with the host paused the view shows the welcome content of an unreachable engine, and once it answers again Refresh lists its container', async () => {
    await dockerWith({}, 'context', 'use', context);
    const listedFirst = await lists(engine.marker);
    await dockerWith({}, '--context', 'default', 'pause', engine.container);
    const unreachable = await waitFor(
      'the welcome content of an unreachable engine',
      showsNoEngine,
      120_000,
    ).then(
      () => true,
      () => false,
    );
    await dockerWith({}, '--context', 'default', 'unpause', engine.container);
    let listedAgain = false;
    await waitFor(
      'the engine’s container after Refresh',
      async () => {
        listedAgain = await lists(engine.marker);
        return listedAgain;
      },
      120_000,
    );
    deepStrictEqual(
      {listedFirst, unreachable, listedAgain},
      {listedFirst: true, unreachable: true, listedAgain: true},
    );
  });
});
