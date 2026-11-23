/**
 * @fileoverview The configurations kept outside a repository, found by the repository's remotes under the roots of
 * `dev.containers.repositoryConfigurationPaths` (card containers-161, F-0302): the connection from a mirrored file, the
 * pick beside the folder's own files, a multi-root workspace, and the reopen notification.
 */

import {deepStrictEqual} from 'node:assert';
import {execFile, execFileSync} from 'node:child_process';
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {
  closeWindow,
  connectedToContainer,
  runLabelArguments,
  startInWindow,
  variable,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  openWorkspaceWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {
  dialogOf,
  type NotificationLink,
  notificationCentre,
  notificationLinks,
  quickPickFacts,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {closeScreen, rowsOf, storeRoot} from '../windows/authoring-support.ts';
import {
  clearNotifications,
  noticesAfter,
} from '../windows/config-watch-support.ts';

const execFileAsync = promisify(execFile);

const SETTING = 'dev.containers.repositoryConfigurationPaths';
const REOPEN = 'remote-containers.reopenInContainer';

/** The start of the reopen notification of a configuration outside the folder (F-0402 S368). */
const EXTERNAL_NOTICE_START =
  'There is a Dev Container configuration available for this repository.';

/** The page the notification's last link opens. */
const INTRODUCTION =
  'https://github.com/remote-oss/remote/blob/main/packages/remote-containers/README.md';

/** The title of the pick that asks where to create a configuration, which a lookup that finds nothing ends in. */
const WHERE_TITLE = 'Add Dev Container Configuration Files';

const MAIN = '.devcontainer/devcontainer.json';

/** The configuration a row connects with: the run's image and the labels the run's clean-up finds it by. */
function connectable(
  configuration: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    image: variable('HARNESS_DEVCONTAINER_IMAGE'),
    runArgs: runLabelArguments(),
    ...configuration,
  });
}

/** Writes `text` at `relative` below `folder`, making the folders on the way. */
function writeAt(folder: string, relative: string, text: string): string {
  const file = path.join(folder, relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, text);
  return file;
}

/** The run's folder `label`, made empty. */
function freshFolder(label: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** A Git repository `<run>/<label>` whose remotes are `urls`, named remote0, remote1, and so on. */
function repositoryWith(label: string, urls: readonly string[]): string {
  const folder = freshFolder(label);
  execFileSync('git', ['init', '-q', folder]);
  urls.forEach((url, index) => {
    execFileSync('git', [
      '-C',
      folder,
      'remote',
      'add',
      `remote${String(index)}`,
      url,
    ]);
  });
  return folder;
}

/** The file with the home folder written as `~`, as the pick shows an external file. */
function tilde(file: string): string {
  const relative = path.relative(os.homedir(), file);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? file
    : path.join('~', relative);
}

/** The label `label` of the first container the engine made for `folder`. */
async function labelOf(folder: string, label: string): Promise<string> {
  const {stdout: containerIds} = await execFileAsync('docker', [
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  ]);
  const [container = ''] = containerIds.split('\n');
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    `{{index .Config.Labels "${label}"}}`,
    container,
  ]);
  return stdout.trim();
}

/** The text of the file `inside` in the first container of `folder`. */
async function textInContainer(
  folder: string,
  inside: string,
): Promise<string> {
  const {stdout: containerIds} = await execFileAsync('docker', [
    'ps',
    '--quiet',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  ]);
  const [container = ''] = containerIds.split('\n');
  const {stdout} = await execFileAsync('docker', [
    'exec',
    container,
    'cat',
    inside,
  ]);
  return stdout;
}

/** The bind mounts of the first container the engine made for `folder`, as "source -> destination". */
async function bindMountsOf(folder: string): Promise<string[]> {
  const {stdout: containerIds} = await execFileAsync('docker', [
    'ps',
    '--quiet',
    '--filter',
    `label=devcontainer.local_folder=${folder}`,
  ]);
  const [container = ''] = containerIds.split('\n');
  const {stdout} = await execFileAsync('docker', [
    'inspect',
    '-f',
    '{{range .Mounts}}{{if eq .Type "bind"}}{{.Source}} -> {{.Destination}}\n{{end}}{{end}}',
    container,
  ]);
  return stdout
    .split('\n')
    .filter(line => line.endsWith(` -> /workspaces/${path.basename(folder)}`));
}

describe('configurations outside the repository (card containers-161, F-0302)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await setUserSetting(SETTING, undefined);
  });

  it('F-0302 AC-1, AC-16, AC-31, AC-46, F-0303 AC-19 (c161-reopen): Reopen in Container on a folder with no configuration of its own, whose two remotes have one URL, builds from the mirrored file with no pick, with the folder’s mount and labels, and the mirrored file’s deletion shows no notification', async () => {
    const name = 'c161-reopen';
    const folder = repositoryWith(name, [
      `https://github.com/o/${name}.git`,
      `https://github.com/o/${name}.git`,
    ]);
    const root = freshFolder(`${name}-root`);
    const mirrored = path.join(root, 'github.com', 'o', name);
    const file = writeAt(
      mirrored,
      MAIN,
      connectable({
        name: 'X-${localWorkspaceFolderBasename}',
        build: {dockerfile: 'Dockerfile', context: '..'},
      }),
    );
    writeAt(
      mirrored,
      '.devcontainer/Dockerfile',
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nCOPY seed.txt /seed.txt\n`,
    );
    writeAt(mirrored, 'seed.txt', 'from the mirrored folder\n');
    await setUserSetting(SETTING, [root]);
    const window = await openFolderWindow(folder);
    try {
      await startInWindow(window, REOPEN);
      await connectedToContainer(window, 600_000);
      const facts = {
        title: (await windowTitle(window)).includes(
          `[Dev Container: X-${name}]`,
        ),
        configFile: await labelOf(folder, 'devcontainer.config_file'),
        localFolder: await labelOf(folder, 'devcontainer.local_folder'),
        seed: await textInContainer(folder, '/seed.txt'),
        mounts: await bindMountsOf(folder),
        pick: await quickPickFacts(window),
      };
      await clearNotifications(window);
      rmSync(file);
      const notices = await noticesAfter(window, 25);
      deepStrictEqual(
        [facts, notices, (await windowState(window)).remoteName],
        [
          {
            title: true,
            configFile: file,
            localFolder: folder,
            seed: 'from the mirrored folder\n',
            mounts: [`${folder} -> /workspaces/${name}`],
            pick: undefined,
          },
          [],
          'dev-container',
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0302 AC-12, AC-13, AC-31, AC-37 (c161-pick): the folder’s own file and the mirrored files of two remotes under two roots are all listed, none collapsed, ordered by absolute path with the first focused, each named by its name or Main, with ~ paths for the external ones', async () => {
    const name = 'c161-pick';
    const folder = repositoryWith(name, [
      `https://github.com/o/${name}.git`,
      `git@github.com:u/${name}.git`,
    ]);
    writeAt(folder, MAIN, connectable({name: 'Local'}));
    const first = freshFolder(`${name}-one`);
    const second = freshFolder(`${name}-two`);
    const files = [
      writeAt(first, path.join('github.com', 'o', name, MAIN), connectable()),
      writeAt(
        second,
        path.join('github.com', 'o', name, MAIN),
        connectable({name: 'Beta'}),
      ),
      writeAt(second, path.join('github.com', 'u', name, MAIN), connectable()),
      path.join(folder, MAIN),
    ];
    const names = new Map<string, string>([
      [files[0] ?? '', 'Main'],
      [files[1] ?? '', 'Beta'],
      [files[2] ?? '', 'Main'],
      [files[3] ?? '', 'Local'],
    ]);
    await setUserSetting(SETTING, [second, first]);
    const window = await openFolderWindow(folder);
    try {
      await startInWindow(window, REOPEN);
      await waitForQuickPick(window, 180_000);
      const rows = await rowsOf(window);
      const placeholder = (await quickPickFacts(window))?.placeholder;
      await closeScreen(window);
      const ordered = [...files].sort();
      deepStrictEqual(
        [
          placeholder,
          rows.map(each => [each[0], each[1]]),
          rows.map(each => each[3]),
        ],
        [
          'Select a devcontainer.json file.',
          ordered.map(file => [
            names.get(file),
            file === path.join(folder, MAIN) ? MAIN : tilde(file),
          ]),
          ordered.map((each, index) => (each === '' ? false : index === 0)),
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0302 AC-25, AC-26 (c161-multi): in a saved workspace of several folders neither a mirrored file nor a stored one is looked up, and the command ends in the pick that asks where to create a configuration', async () => {
    const name = 'c161-multi';
    const base = freshFolder(name);
    const first = repositoryWith(`${name}/one`, [
      `https://github.com/o/${name}-one.git`,
    ]);
    const second = repositoryWith(`${name}/two`, []);
    const root = freshFolder(`${name}-root`);
    writeAt(
      root,
      path.join('github.com', 'o', `${name}-one`, MAIN),
      connectable(),
    );
    writeAt(path.join(storeRoot(), 'two'), MAIN, connectable({name: 'Stored'}));
    writeAt(
      path.join(storeRoot(), 'two'),
      '.devcontainer/.devcontainer-internal.json',
      `// Maintained by the Dev Container extension\n${JSON.stringify({rootFolder: second})}\n`,
    );
    const file = path.join(base, `${name}.code-workspace`);
    writeFileSync(
      file,
      JSON.stringify({folders: [{path: 'one'}, {path: 'two'}]}),
    );
    await setUserSetting(SETTING, [root]);
    const window = await openWorkspaceWindow(file);
    try {
      await startInWindow(window, REOPEN);
      await waitForQuickPick(window, 180_000);
      const title = (await quickPickFacts(window))?.title;
      await closeScreen(window);
      deepStrictEqual(
        [title, (await windowState(window)).remoteName, first],
        [WHERE_TITLE, null, first],
      );
    } finally {
      rmSync(path.join(storeRoot(), 'two'), {recursive: true, force: true});
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0302 AC-3, AC-13, AC-36, AC-44 (c161-notice): the window of a repository with a mirrored file shows the notification with the repository’s wording, also beside its own file, for a portless ssh remote and for a subfolder; a root written with ~, ${env:HOME} or ${userHome} matches nothing and a trailing slash still matches', async () => {
    const name = 'c161-notice';
    const root = freshFolder(`${name}-root`);
    const home = os.homedir();
    const relative = path.relative(home, root);
    const underHome = !relative.startsWith('..') && !path.isAbsolute(relative);
    async function noticeFor(
      label: string,
      folder: string,
      roots: readonly string[],
    ): Promise<{shown: boolean; links: NotificationLink[]}> {
      await setUserSetting(SETTING, roots);
      const window = await openFolderWindow(folder);
      try {
        const shown = await waitFor(
          `the notification of ${label}`,
          async () =>
            (await notificationCentre(window)).some(text =>
              text.startsWith(EXTERNAL_NOTICE_START),
            ),
          12_000,
        ).then(
          () => true,
          () => false,
        );
        const links = shown
          ? await notificationLinks(window, EXTERNAL_NOTICE_START)
          : [];
        return {shown, links};
      } finally {
        await closeWindow(window).catch(() => undefined);
      }
    }
    writeAt(
      root,
      path.join('example.com', 'o', name, MAIN),
      connectable({name: 'Mirror'}),
    );
    const portless = repositoryWith(`${name}-ssh`, [
      `ssh://git@example.com/o/${name}.git`,
    ]);
    const beside = repositoryWith(`${name}-beside`, [
      `git://example.com/o/${name}.git`,
    ]);
    writeAt(beside, MAIN, connectable({name: 'Own'}));
    const nested = path.join(
      repositoryWith(`${name}-sub`, [`ssh://example.com/o/${name}.git`]),
      'packages',
      'app',
    );
    mkdirSync(nested, {recursive: true});
    const outcomes = {
      portless: await noticeFor('portless', portless, [root]),
      beside: await noticeFor('beside', beside, [root]),
      subfolder: await noticeFor('subfolder', nested, [root]),
      trailing: await noticeFor('trailing', portless, [`${root}/`]),
      userHome: await noticeFor('userHome', portless, [
        path.join('${userHome}', underHome ? relative : 'none'),
      ]),
      env: await noticeFor('env', portless, [
        path.join('${env:HOME}', underHome ? relative : 'none'),
      ]),
      tilde: await noticeFor('tilde', portless, [
        path.join('~', underHome ? relative : 'none'),
      ]),
    };
    const links = [
      {
        text: 'Dev Container configuration',
        href: 'command:remote-containers.openDevContainerFile',
      },
      {text: 'learn more', href: INTRODUCTION},
    ];
    deepStrictEqual(
      [
        Object.entries(outcomes).map(([key, each]) => [key, each.shown]),
        outcomes.portless.links,
        outcomes.beside.links,
      ],
      [
        [
          ['portless', true],
          ['beside', true],
          ['subfolder', true],
          ['trailing', true],
          ['userHome', false],
          ['env', false],
          ['tilde', false],
        ],
        links,
        links,
      ],
    );
  });

  it('F-0302 AC-11 (c161-none): roots with no file for the remote and a root that does not exist change nothing: no error, and the pick that asks where to create a configuration shows', async () => {
    const name = 'c161-none';
    const folder = repositoryWith(name, [`https://github.com/o/${name}.git`]);
    const root = freshFolder(`${name}-root`);
    await setUserSetting(SETTING, [path.join(root, 'missing'), root]);
    const window = await openFolderWindow(folder);
    try {
      await startInWindow(window, REOPEN);
      await waitForQuickPick(window, 180_000);
      const title = (await quickPickFacts(window))?.title;
      await closeScreen(window);
      deepStrictEqual(
        [title, await dialogOf(window)],
        [WHERE_TITLE, undefined],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
