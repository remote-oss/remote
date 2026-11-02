import {deepStrictEqual} from 'node:assert';
import {execFile} from 'node:child_process';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {dockerWrapper} from '../windows/dev-containers-view.ts';
import {
  readUserSettings,
  restoreUserSettings,
  runScopedName,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {setUserSetting} from '../windows/folder-windows.ts';
import {
  DEAD,
  dockerWith,
  engineSettingsAre,
  lists,
  refresh,
  type SecondEngine,
  secondEngine,
  showsNoEngine,
} from '../windows/engine-fixture.ts';

const execFileAsync = promisify(execFile);

/** What the engine at `engine` holds, as the lists of its containers, images, volumes and networks. */
async function stateOf(engine: SecondEngine): Promise<string[]> {
  const environment = {DOCKER_HOST: engine.address};
  return Promise.all(
    [
      ['ps', '-a', '--format', '{{.ID}} {{.State}}'],
      ['image', 'ls', '--format', '{{.ID}}'],
      ['volume', 'ls', '--format', '{{.Name}}'],
      ['network', 'ls', '--format', '{{.ID}}'],
    ].map(async parameters =>
      (await dockerWith(environment, ...parameters))
        .split('\n')
        .sort()
        .join(','),
    ),
  );
}

/** How many times the counting program was run with `ps` as its first argument, from its log `file`. */
function callsTo(file: string): number {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(each => each === 'ps').length;
}

/** The environment of this process with `home` as its HOME and no Docker configuration folder of its own. */
function environmentWithHome(home: string): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries({...process.env, HOME: home}).filter(
      ([name]) => name !== 'DOCKER_CONFIG',
    ),
  );
}

/** The names of the Docker contexts that a `docker` with HOME `home` lists. */
async function contextNames(home: string): Promise<string[]> {
  const {stdout} = await execFileAsync(
    'docker',
    ['context', 'ls', '--format', '{{.Name}}'],
    {env: environmentWithHome(home)},
  );
  return stdout.trim().split('\n');
}

describe('the checks of the Dev Containers view against the engine it uses (card containers-133)', function () {
  this.timeout(900_000);

  let saved: string | undefined;
  let plain: SecondEngine;

  before(async () => {
    saved = readUserSettings();
    plain = await secondEngine();
  });

  after(async () => {
    restoreUserSettings(saved);
    await plain.stop();
  });

  it('F-0205 AC-15 (c133-nothing-created): listing the containers of the engine and refreshing the view create, change and remove no container, image, volume or network there', async () => {
    await engineSettingsAre(saved, {'docker.host': plain.address});
    const listed = await lists(plain.marker);
    const before = await stateOf(plain);
    await refresh();
    await lists(plain.marker);
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual([listed, await stateOf(plain)], [true, before]);
  });

  it('F-0205 AC-16 (c133-retry): after a failed check, the same trigger with nothing changed runs the check again', async () => {
    const calls = path.join(variable('HARNESS_RUN_FOLDER'), 'c133-calls.txt');
    writeFileSync(calls, '');
    const program = dockerWrapper('c133-counting', `echo "$1" >> ${calls}`);
    await setUserSetting('dev.containers.dockerPath', program);
    try {
      await engineSettingsAre(saved, {
        'dev.containers.dockerPath': program,
        'docker.host': DEAD,
      });
      await showsNoEngine();
      const first = callsTo(calls);
      await refresh();
      await waitFor(
        'the check to run again',
        () => Promise.resolve(callsTo(calls) > first),
        30_000,
      );
      const second = callsTo(calls);
      await refresh();
      await waitFor(
        'the check to run a third time',
        () => Promise.resolve(callsTo(calls) > second),
        30_000,
      );
      deepStrictEqual([first > 0, second > first], [true, true]);
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
    }
  });

  it('F-0205 AC-17 (c133-home): a Docker context created under one HOME is not listed by a process with another HOME', async () => {
    const context = runScopedName('c133home');
    const homes = ['home-a', 'home-b'].map(each => {
      const folder = path.join(variable('HARNESS_RUN_FOLDER'), `c133-${each}`);
      mkdirSync(folder, {recursive: true});
      return folder;
    });
    await execFileAsync(
      'docker',
      ['context', 'create', context, '--docker', `host=${DEAD}`],
      {env: environmentWithHome(homes[0] ?? '')},
    );
    deepStrictEqual(
      [
        (await contextNames(homes[0] ?? '')).includes(context),
        (await contextNames(homes[1] ?? '')).includes(context),
      ],
      [true, false],
    );
  });
});
