import {deepStrictEqual} from 'node:assert';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {
  ENGINE_HOST_ADDRESS,
  ENGINE_HOST_CONTEXT,
} from '../../../tools/acceptance-launches.ts';
import {
  dockerWith,
  engineSettingsAre,
  type SecondEngine,
  secondEngine,
  showsNoEngine,
  viewLabels,
} from '../windows/engine-fixture.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  closeWindow,
  readUserSettings,
  reopenInContainer,
  restoreUserSettings,
  runLabelArguments,
  runScopedName,
  variable,
} from '../windows/harness.ts';
import {windowTitle} from '../windows/renderer.ts';

/** Which of the engines' own containers the labels list, by the engines' names. */
function listedOf(
  labels: readonly string[] | undefined,
  engines: Readonly<Record<string, SecondEngine>>,
): string[] | undefined {
  return labels === undefined
    ? undefined
    : Object.entries(engines)
        .filter(([, engine]) =>
          labels.some(each => each.startsWith(engine.marker)),
        )
        .map(([name]) => name);
}

describe('the engine of an editor that starts with a DOCKER_HOST and a DOCKER_CONTEXT (card containers-133)', function () {
  this.timeout(900_000);

  let saved: string | undefined;
  let editorHost: SecondEngine;
  let setting: SecondEngine;
  let named: SecondEngine;
  const context = runScopedName('c133named');
  // The daemon of the editor's DOCKER_HOST binds the folders the title row opens from here, outside the daemon's own /tmp.
  const shared = path.join(
    homedir(),
    '.cache',
    'remote-oss-acceptance',
    runScopedName('c133env'),
  );

  /** The engines the view lists after the settings are `change`. */
  async function listedAfter(
    change: Readonly<Record<string, unknown>>,
  ): Promise<string[] | undefined> {
    await engineSettingsAre(saved, change);
    return listedOf(await viewLabels(), {process: editorHost, setting, named});
  }

  before(async () => {
    saved = readUserSettings();
    // Made here so that the folder is the user's: the daemon's container would create it as root.
    mkdirSync(shared, {recursive: true});
    editorHost = await secondEngine({
      hostPort: Number(new URL(ENGINE_HOST_ADDRESS).port),
      shared,
    });
    setting = await secondEngine();
    named = await secondEngine();
    await dockerWith(
      {},
      'context',
      'create',
      context,
      '--docker',
      `host=${named.address}`,
    );
    await dockerWith(
      {},
      'context',
      'create',
      ENGINE_HOST_CONTEXT,
      '--docker',
      `host=${named.address}`,
    );
  });

  after(async () => {
    rmSync(shared, {recursive: true, force: true});
    restoreUserSettings(saved);
    for (const each of [context, ENGINE_HOST_CONTEXT]) {
      await dockerWith({}, 'context', 'rm', '--force', each).catch(
        () => undefined,
      );
    }
    for (const each of [editorHost, setting, named]) {
      await each.stop();
    }
  });

  it('F-0205 AC-14d (c133-env-conflict): with DOCKER_HOST and a conflicting DOCKER_CONTEXT in the editor’s environment, the view lists the containers of the DOCKER_HOST endpoint only', async () => {
    deepStrictEqual(await listedAfter({}), ['process']);
  });

  it('F-0205 AC-38 (c133-env-title): a container opened through the DOCKER_HOST of the editor names that address after its name, in the window’s title and its indicator', async () => {
    const folder = path.join(shared, 'c133-env-title');
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      JSON.stringify({
        name: 'Env Title',
        image: variable('HARNESS_DEVCONTAINER_IMAGE'),
        runArgs: runLabelArguments(),
      }),
    );
    await engineSettingsAre(saved, {});
    const window = await openFolderWindow(folder);
    try {
      await reopenInContainer(window);
      deepStrictEqual(
        (await windowTitle(window)).includes(
          `[Dev Container: Env Title @ ${ENGINE_HOST_ADDRESS}]`,
        ),
        true,
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0205 AC-32 (c133-env-precedence): a DOCKER_HOST in any of the three settings wins over the editor’s, and the editor’s DOCKER_HOST wins over a DOCKER_CONTEXT in containers.environment', async () => {
    deepStrictEqual(
      [
        await listedAfter({
          'containers.environment': {DOCKER_HOST: setting.address},
        }),
        await listedAfter({
          'docker.environment': {DOCKER_HOST: setting.address},
        }),
        await listedAfter({'docker.host': setting.address}),
        await listedAfter({
          'containers.environment': {DOCKER_CONTEXT: context},
        }),
      ],
      [['setting'], ['setting'], ['setting'], ['process']],
    );
  });

  it('F-0205 AC-42 (c133-env-three): with the editor’s DOCKER_HOST, a named context and another endpoint, containers.environment holding the context and the endpoint gives the endpoint’s containers only', async () => {
    deepStrictEqual(
      await listedAfter({
        'containers.environment': {
          DOCKER_CONTEXT: context,
          DOCKER_HOST: setting.address,
        },
      }),
      ['setting'],
    );
  });

  it('F-0205 AC-14b (c133-env-broken): with a working current context and a DOCKER_HOST of the editor that nothing answers, the view shows the welcome content of an unreachable engine', async () => {
    await dockerWith({}, 'context', 'use', context);
    try {
      await editorHost.stop();
      await engineSettingsAre(saved, {});
      deepStrictEqual(await showsNoEngine(), true);
    } finally {
      await dockerWith({}, 'context', 'use', 'default').catch(() => undefined);
    }
  });
});
