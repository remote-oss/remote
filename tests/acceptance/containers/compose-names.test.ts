import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  devContainersOf,
  reopenStarted,
  variable,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';
import {waitForDialog} from '../windows/renderer.ts';
import {
  composeFolder,
  type ComposePlace,
  openedCompose,
  removeComposeContainers,
  runningServicesOf,
} from './compose-support.ts';

/** The generic dialog of a setup that fails (F-0410's). */
const GENERIC_DIALOG = 'An error occurred setting up the container.';

/** Opens a folder made by `options` in its container, closes the window, and gives the project and its running services. */
async function projectOfFolder(
  options: Parameters<typeof composeFolder>[0],
): Promise<{project: string; services: string[]}> {
  const folder = composeFolder(options);
  const {name, project} = await openedCompose(folder);
  const services = await runningServicesOf(project);
  await closeWindow(name);
  return {project, services};
}

describe('the Compose project of a configuration (card containers-143)', function () {
  this.timeout(300_000);

  afterEach(async () => {
    await removeComposeContainers();
  });

  it('F-0413 AC-1, AC-8 (c143-place): a compose file in the workspace folder gives the folder’s name, in .devcontainer/ the name and _devcontainer, in .devcontainer/app/ the name app, and both services run', async () => {
    const results: Array<[ComposePlace, string, string[]]> = [];
    for (const place of ['workspace', 'devcontainer', 'nested'] as const) {
      const {project, services} = await projectOfFolder({
        name: `c143-${place}`,
        place,
      });
      results.push([place, project, services]);
      await removeComposeContainers();
    }
    deepStrictEqual(results, [
      ['workspace', 'c143-workspace', ['app', 'db']],
      ['devcontainer', 'c143-devcontainer_devcontainer', ['app', 'db']],
      ['nested', 'app', ['app', 'db']],
    ]);
  });

  it('F-0413 AC-39 (c143-normalized): a workspace folder’s name is lower-cased, loses what Compose does not allow and any leading - or _', async () => {
    const projects: string[] = [];
    for (const name of ['F0413 My.App', 'F0413Ü', '-_-F0413Mix.Lead']) {
      projects.push(
        (await projectOfFolder({name, place: 'workspace'})).project,
      );
      await removeComposeContainers();
    }
    deepStrictEqual(projects, ['f0413myapp', 'f0413', 'f0413mixlead']);
  });

  it('F-0413 AC-39 (c143-declared): a top-level name: and the workspace folder’s .env are normalized the same way', async () => {
    const declared = await projectOfFolder({
      name: 'c143-declared',
      place: 'devcontainer',
      headLines: ['name: "F0413 Name.X"'],
    });
    await removeComposeContainers();
    const leading = await projectOfFolder({
      name: 'c143-leading',
      place: 'devcontainer',
      headLines: ['name: "-F0413NmLead"'],
    });
    await removeComposeContainers();
    const env = await projectOfFolder({
      name: 'c143-env',
      place: 'devcontainer',
      workspaceEnv: 'COMPOSE_PROJECT_NAME=F0413 Env.Y\n',
    });
    deepStrictEqual(
      [declared.project, leading.project, env.project],
      ['f0413namex', 'f0413nmlead', 'f0413envy'],
    );
  });

  it('F-0413 AC-40 (c143-env-order): the workspace folder’s .env wins over the one beside the compose file, which is used once the other is gone', async () => {
    const name = 'c143-env-order';
    const first = await projectOfFolder({
      name,
      place: 'devcontainer',
      workspaceEnv: 'COMPOSE_PROJECT_NAME=a\n',
      composeEnv: 'COMPOSE_PROJECT_NAME=b\n',
    });
    await removeComposeContainers();
    rmSync(path.join(variable('HARNESS_RUN_FOLDER'), name, '.env'));
    const second = await projectOfFolder({
      name,
      place: 'devcontainer',
      composeEnv: 'COMPOSE_PROJECT_NAME=b\n',
    });
    deepStrictEqual([first.project, second.project], ['a', 'b']);
  });

  it('F-0413 AC-41 (c143-declared-later): the later of two files’ name: is the project’s, and a single file may declare devcontainer', async () => {
    const later = await projectOfFolder({
      name: 'c143-declared-later',
      place: 'devcontainer',
      headLines: ['name: first'],
      overrideLines: ['name: second'],
    });
    await removeComposeContainers();
    const single = await projectOfFolder({
      name: 'c143-devcontainer-name',
      place: 'devcontainer',
      headLines: ['name: devcontainer'],
    });
    deepStrictEqual(
      [later.project, single.project],
      ['second', 'devcontainer'],
    );
  });

  it('F-0413 AC-57 (c143-invalid): a name that normalizes to nothing fails with the generic dialog and creates no container', async () => {
    const folder = composeFolder({
      name: 'c143-invalid',
      place: 'devcontainer',
      headLines: ['name: "+++"'],
    });
    const name = await openFolderWindow(folder);
    try {
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 60_000);
      deepStrictEqual(
        [dialog.details, await devContainersOf(folder)],
        [GENERIC_DIALOG, []],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
