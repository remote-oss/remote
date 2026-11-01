import {deepStrictEqual} from 'node:assert';
import {chmodSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  recentlyOpenedIn,
  reloadWindow,
  reopenInContainer,
  startInWindow,
  variable,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  detailedQuickPickRows,
  pressEscape,
  statusItemText,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';

/** The Docker context the rows connect through. */
const CONTEXT = 'f0504ctx';

/** The engine the rows' contexts point at: the one the run uses. */
function endpoint(): string {
  return process.env.DOCKER_HOST ?? 'unix:///var/run/docker.sock';
}

/** A `docker` for `dev.containers.dockerPath` with a config folder of its own that holds {@link CONTEXT}. */
function contextDocker(): {
  program: string;
  makeCurrent(context: string | undefined): void;
  breakDefault(broken: boolean): void;
  remove(): void;
} {
  const base = path.join(variable('HARNESS_RUN_FOLDER'), 'docker-context');
  const config = path.join(base, 'config');
  const broken = path.join(base, 'default-broken');
  const program = path.join(base, 'docker');
  const real = execFileSync('sh', ['-c', 'command -v docker'])
    .toString()
    .trim();
  mkdirSync(config, {recursive: true});
  execFileSync(
    real,
    ['context', 'create', CONTEXT, '--docker', `host=${endpoint()}`],
    {env: {...process.env, DOCKER_CONFIG: config}},
  );
  // While the default context is broken, a call that names no context cannot reach an engine.
  writeFileSync(
    program,
    `#!/bin/sh\nexport DOCKER_CONFIG=${config}\nif [ -f ${broken} ] && [ -z "$DOCKER_CONTEXT" ]; then export DOCKER_HOST=unix:///tmp/remote-oss-no-daemon.sock; fi\nexec ${real} "$@"\n`,
  );
  chmodSync(program, 0o755);
  return {
    program,
    makeCurrent: context => {
      writeFileSync(
        path.join(config, 'config.json'),
        JSON.stringify(context === undefined ? {} : {currentContext: context}),
      );
    },
    breakDefault: isBroken => {
      if (isBroken) {
        writeFileSync(broken, '');
      } else {
        rmSync(broken, {force: true});
      }
    },
    remove: () => {
      rmSync(base, {recursive: true, force: true});
    },
  };
}

/** The dev container entries of the Open Recent list for `folder`, with the payload of each authority decoded. */
async function entriesOf(window: string, folder: string) {
  return (await recentlyOpenedIn(window))
    .filter(
      entry =>
        entry.remoteAuthority?.startsWith('dev-container+') === true &&
        entry.uri.endsWith(`/workspaces/${path.basename(folder)}`),
    )
    .map(entry => ({
      label: entry.label,
      payload: JSON.parse(
        Buffer.from(
          (entry.remoteAuthority ?? '').slice('dev-container+'.length),
          'hex',
        ).toString('utf8'),
      ) as Record<string, unknown>,
    }));
}

describe('The Docker context in a dev container window (card coverage-74)', function () {
  this.timeout(900_000);

  it('F-0501 AC-26, F-0504 AC-32 (c74-context): a connect under a Docker context names it in the payload, the title, the indicator and the Open Recent label, reconnects through it when default is current, and a connect under default makes a second entry without it', async () => {
    const folder = devContainerFolder('c74-context', {name: 'Context Name'});
    const docker = contextDocker();
    try {
      await setUserSetting('dev.containers.dockerPath', docker.program);
      docker.makeCurrent(CONTEXT);
      const first = await openFolderWindow(folder);
      await reopenInContainer(first);
      const connected = {
        indicator: await statusItemText(
          first,
          'status.host',
          `Dev Container: Context Name @ ${CONTEXT}`,
          60_000,
        ),
        title: await windowTitle(first),
        entries: await entriesOf(first, folder),
      };
      docker.makeCurrent(undefined);
      docker.breakDefault(true);
      await reloadWindow(first);
      const reloaded = {
        indicator: await statusItemText(
          first,
          'status.host',
          `Dev Container: Context Name @ ${CONTEXT}`,
          60_000,
        ),
        title: await windowTitle(first),
        containers: (await devContainersOf(folder)).length,
      };
      await closeWindow(first);
      docker.breakDefault(false);
      const second = await openFolderWindow(folder);
      await reopenInContainer(second);
      await startInWindow(second, 'workbench.action.openRecent');
      await waitForQuickPick(second, 30_000);
      await new Promise(resolve => setTimeout(resolve, 2000));
      const picker = (await detailedQuickPickRows(second))
        .map(entry => entry.label)
        .filter(label => label.startsWith('c74-context'))
        .sort();
      await pressEscape(second);
      const afterDefault = await entriesOf(second, folder);
      await closeWindow(second);
      deepStrictEqual(
        {
          connected: {
            ...connected,
            entries: connected.entries.map(entry => entry.payload.settings),
          },
          labels: connected.entries.map(entry =>
            (entry.label ?? '').endsWith(` @ ${CONTEXT} [Dev Container]`),
          ),
          reloaded,
          picker,
          payloads: afterDefault
            .map(entry =>
              entry.payload.settings === undefined
                ? 'no settings'
                : JSON.stringify(entry.payload.settings),
            )
            .sort(),
        },
        {
          connected: {
            indicator: `Dev Container: Context Name @ ${CONTEXT}`,
            title: `[c74-context [Dev Container: Context Name @ ${CONTEXT}]]`,
            entries: [{context: CONTEXT}],
          },
          labels: [true],
          reloaded: {
            indicator: `Dev Container: Context Name @ ${CONTEXT}`,
            title: `[c74-context [Dev Container: Context Name @ ${CONTEXT}]]`,
            containers: 1,
          },
          picker: [
            'c74-context',
            `c74-context @ ${CONTEXT} [Dev Container]`,
            'c74-context [Dev Container]',
          ],
          payloads: ['no settings', JSON.stringify({context: CONTEXT})],
        },
      );
    } finally {
      await setUserSetting('dev.containers.dockerPath', undefined);
      docker.remove();
      await removeContainers(folder);
    }
  });
});
