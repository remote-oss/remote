import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  isTrusted,
  connectedToContainer,
  runLabelArguments,
  runScopedName,
  startInWindow,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  DEAD,
  dockerWith,
  lists,
  type SecondEngine,
  secondEngine,
  showsNoEngine,
} from '../windows/engine-fixture.ts';
import {answerDialog, waitForDialog, windowTitle} from '../windows/renderer.ts';

/** Writes the folder's `.vscode/settings.json`. */
function folderSettings(folder: string, settings: unknown): void {
  mkdirSync(path.join(folder, '.vscode'), {recursive: true});
  writeFileSync(
    path.join(folder, '.vscode', 'settings.json'),
    JSON.stringify(settings),
  );
}

describe('the engine settings of a folder in Restricted Mode (card containers-133)', function () {
  this.timeout(900_000);

  let plain: SecondEngine;

  before(async () => {
    plain = await secondEngine();
  });

  after(async () => {
    await plain.stop();
  });

  it('F-0205 AC-34 (c133-folder): in an untrusted folder the endpoint of its .vscode/settings.json is used by the view, and a change of the file is used at the next refresh with no reload', async () => {
    const folder = devContainerFolder('c133-folder');
    folderSettings(folder, {
      'containers.environment': {DOCKER_HOST: plain.address},
    });
    const window = await openFolderWindow(folder);
    try {
      const trusted = await isTrusted(window);
      const first = await lists(plain.marker, window);
      folderSettings(folder, {'docker.host': DEAD});
      const second = await showsNoEngine(window);
      folderSettings(folder, {'docker.host': plain.address});
      const third = await lists(plain.marker, window);
      deepStrictEqual(
        [trusted, first, second, third],
        [false, true, true, true],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0205 AC-50 (c133-hijack): in Restricted Mode a PATH, HOME or DOCKER_CONFIG in the folder’s containers.environment changes nothing and runs no program of the folder, in the view and in the container window after trust, and a DOCKER_HOST beside the PATH is taken and the program is still not run', async () => {
    const folder = devContainerFolder('c133-hijack', {name: 'Hijack'});
    const programs = path.join(folder, 'bin');
    const marker = path.join(variable('HARNESS_RUN_FOLDER'), 'c133-ran');
    mkdirSync(programs, {recursive: true});
    for (const name of ['docker', 'ssh']) {
      const program = path.join(programs, name);
      writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
      chmodSync(program, 0o755);
    }
    // C is the `.docker` folder of a home of its own, so that the HOME case points the CLI at it.
    const home = path.join(variable('HARNESS_RUN_FOLDER'), 'c133-home');
    const config = path.join(home, '.docker');
    mkdirSync(config, {recursive: true});
    const dead = runScopedName('c133deadctx');
    execFileSync(
      'docker',
      ['context', 'create', dead, '--docker', `host=${DEAD}`],
      {
        env: {...process.env, DOCKER_CONFIG: config},
      },
    );
    writeFileSync(
      path.join(config, 'config.json'),
      JSON.stringify({currentContext: dead}),
    );
    // The control: with that HOME the CLI finds the dead current context, so the HOME case could fail.
    let controlFails = false;
    try {
      execFileSync('docker', ['ps', '-q'], {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([name]) =>
                !['DOCKER_CONFIG', 'DOCKER_HOST', 'DOCKER_CONTEXT'].includes(
                  name,
                ),
            ),
          ),
          HOME: home,
        },
        stdio: 'ignore',
      });
    } catch {
      controlFails = true;
    }
    const own = runScopedName('c133local');
    await dockerWith(
      {},
      '--context',
      'default',
      'tag',
      variable('HARNESS_DEVCONTAINER_IMAGE'),
      `${own}:only`,
    );
    await dockerWith(
      {},
      '--context',
      'default',
      'run',
      '-d',
      ...runLabelArguments(),
      `${own}:only`,
      'sleep',
      '3600',
    );
    const seen: boolean[] = [];
    const window = await openFolderWindow(folder);
    try {
      for (const environment of [
        {PATH: `${programs}:${process.env.PATH ?? ''}`},
        {HOME: home},
        {DOCKER_CONFIG: config},
      ]) {
        folderSettings(folder, {'containers.environment': environment});
        seen.push(await lists(own, window));
      }
      folderSettings(folder, {
        'containers.environment': {
          PATH: `${programs}:${process.env.PATH ?? ''}`,
          DOCKER_HOST: 'ssh://127.0.0.1:9',
        },
      });
      seen.push(await showsNoEngine(window));
      folderSettings(folder, {
        'containers.environment': {
          PATH: `${programs}:${process.env.PATH ?? ''}`,
        },
      });
      // The reopen reads the folder's settings when it starts, so it starts only once the view has taken the change of
      // the file: with the dead host still in force the connect waits on it.
      seen.push(await lists(own, window));
      void startInWindow(window, 'remote-containers.reopenInContainer');
      await waitForDialog(window, 60_000);
      await answerDialog(window, 'Trust Folder & Continue');
      await connectedToContainer(window);
      const title = await windowTitle(window);
      deepStrictEqual(
        [controlFails, seen, title.includes(' @ '), existsSync(marker)],
        [true, [true, true, true, true, true], false, false],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
