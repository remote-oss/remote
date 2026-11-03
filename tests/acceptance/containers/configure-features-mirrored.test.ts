/**
 * @fileoverview Configure Container Features on a configuration kept outside the repository (card containers-161,
 * F-0807 BR-21, F-0302): the mirrored file is the one written, in place, through the same candidate list as the
 * folder's own, and the folders the remotes' URLs map to are exactly those BR-1 gives.
 */

import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  closeWindow,
  containersLog,
  inWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, setUserSetting} from '../windows/folder-windows.ts';
import {
  chooseQuickPickRow,
  dialogOf,
  editorTabs,
  pressEscape,
  pressQuickPickTitleButton,
  quickPickChrome,
  toggleQuickPickRow,
  waitForDialog,
} from '../windows/renderer.ts';
import {
  FEATURES_PLACEHOLDER,
  rowsOf,
  screenWith,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const SETTING = 'dev.containers.repositoryConfigurationPaths';
const PLAIN = 'Lab Plain';
const CONFIGURATION_PLACEHOLDER = 'Select a devcontainer.json file.';
const MAIN = '.devcontainer/devcontainer.json';

/** The run's folder `label`, made empty. */
function freshFolder(label: string): string {
  const folder = path.join(variable('HARNESS_RUN_FOLDER'), label);
  rmSync(folder, {recursive: true, force: true});
  mkdirSync(folder, {recursive: true});
  return folder;
}

/** Writes `text` at `relative` below `folder`, making the folders on the way, and gives the file. */
function writeAt(folder: string, relative: string, text: string): string {
  const file = path.join(folder, relative);
  mkdirSync(path.dirname(file), {recursive: true});
  writeFileSync(file, text);
  return file;
}

/** A Git repository `<run>/<label>` with the remote `url` as `origin`. */
function repositoryWith(label: string, url: string): string {
  const folder = freshFolder(label);
  execFileSync('git', ['init', '-q', folder]);
  execFileSync('git', ['-C', folder, 'remote', 'add', 'origin', url]);
  return folder;
}

/** The file with the home folder written as `~`. */
function tilde(file: string): string {
  const relative = path.relative(os.homedir(), file);
  return relative.startsWith('..') || path.isAbsolute(relative)
    ? file
    : path.join('~', relative);
}

/** Whether the configuration file holds a "features" entry; a file being written counts as not yet. */
function hasFeatures(file: string): boolean {
  try {
    return (
      (JSON.parse(readFileSync(file, 'utf8')) as {features?: unknown})
        .features !== undefined
    );
  } catch {
    return false;
  }
}

/** Runs the command in `window`, checks the Feature `PLAIN` on the screen it reaches and presses Finish. */
async function finishedWithPlain(window: string): Promise<void> {
  inWindow(window, COMMAND).catch(() => undefined);
  await screenWith(window, FEATURES_PLACEHOLDER);
  await toggleQuickPickRow(window, PLAIN);
  await pressQuickPickTitleButton(window, 'Finish');
}

describe('Configure Container Features on a configuration outside the repository (card containers-161, part B)', function () {
  this.timeout(900_000);

  afterEach(async () => {
    await setUserSetting(SETTING, undefined);
  });

  it('F-0807 AC-66, AC-67 (c161-features): a mirrored file with no configuration of the folder opens Select Features directly, receives the Feature in place and becomes the active editor, nothing is created in the folder, and the next run counts the Feature', async () => {
    const name = 'c161-features';
    const folder = repositoryWith(name, `https://github.com/o/${name}.git`);
    const root = freshFolder(`${name}-root`);
    const file = writeAt(
      root,
      path.join('github.com', 'o', name, MAIN),
      '{"image": "x"}\n',
    );
    await setUserSetting(SETTING, [root]);
    const window = await openFolderWindow(folder);
    try {
      await finishedWithPlain(window);
      await waitFor(
        'the Feature in the mirrored file',
        () => hasFeatures(file),
        30_000,
      );
      await waitFor(
        'the mirrored file as the active editor',
        async () =>
          (await editorTabs(window)).some(
            each => each.label === 'devcontainer' && each.active,
          ),
        30_000,
      );
      const created = existsSync(path.join(folder, '.devcontainer'));
      inWindow(window, COMMAND).catch(() => undefined);
      await screenWith(window, FEATURES_PLACEHOLDER);
      const counter = (await quickPickChrome(window)).counter;
      await pressEscape(window);
      deepStrictEqual(
        [created, counter, await dialogOf(window)],
        [false, '1 Selected', undefined],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0807 AC-68 (c161-both): the mirrored file and the folder’s own are both listed, the mirrored first with its path and the folder’s with its relative path, and the one picked is the only one written', async () => {
    const name = 'c161-both';
    const folder = repositoryWith(name, `https://github.com/o/${name}.git`);
    const own = writeAt(folder, MAIN, '{"name": "Local", "image": "x"}\n');
    const root = freshFolder(`${name}-root`);
    const mirrored = writeAt(
      root,
      path.join('github.com', 'o', name, MAIN),
      '{"name": "Mirror", "image": "x"}\n',
    );
    await setUserSetting(SETTING, [root]);
    const window = await openFolderWindow(folder);
    try {
      inWindow(window, COMMAND).catch(() => undefined);
      await screenWith(window, CONFIGURATION_PLACEHOLDER);
      const rows = (await rowsOf(window)).map(each => [
        each[0],
        each[1],
        each[3],
      ]);
      await chooseQuickPickRow(window, 'Local');
      await screenWith(window, FEATURES_PLACEHOLDER);
      await toggleQuickPickRow(window, PLAIN);
      await pressQuickPickTitleButton(window, 'Finish');
      await waitFor(
        'the Feature in the folder’s file',
        () => hasFeatures(own),
        30_000,
      );
      deepStrictEqual(
        [rows, hasFeatures(mirrored)],
        [
          [
            ['Mirror', tilde(mirrored), true],
            ['Local', MAIN, false],
          ],
          false,
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0302 AC-14, AC-42, AC-43, AC-44 (c161-spellings): each spelling of a remote maps to exactly its folder under the root: the file there is the one written, with no pick, and no decoy folder is a candidate', async () => {
    const name = 'c161-spellings';
    const spellings: Array<{url: string; exact: string; decoys: string[]}> = [
      {
        url: 'https://someone@github.com/o/r.git',
        exact: 'someone@github.com/o/r',
        decoys: ['github.com/o/r'],
      },
      {
        url: 'https://example.com:8443/o/r.git',
        exact: 'example.com:8443/o/r',
        decoys: ['example.com/o/r', 'example.com/8443/o/r'],
      },
      {
        url: 'https://GitHub.com/O/R.git',
        exact: 'GitHub.com/O/R',
        decoys: ['github.com/o/r'],
      },
      {
        url: 'https://github.com/o/r',
        exact: 'github.com/o/r',
        decoys: ['github.com/o/r.git'],
      },
      {
        url: 'ssh://git@example.com:2222/o/r.git',
        exact: 'example.com/2222/o/r',
        decoys: [
          'example.com/o/r',
          'example.com:2222/o/r',
          'git@example.com:2222/o/r',
          'git@example.com/2222/o/r',
        ],
      },
      {
        url: 'git://example.com/o/r.git',
        exact: 'example.com/o/r',
        decoys: ['git@example.com/o/r'],
      },
      {
        url: 'ssh://git@example.com/o/r.git',
        exact: 'example.com/o/r',
        decoys: ['git@example.com/o/r'],
      },
      {
        url: 'ssh://example.com/o/r.git',
        exact: 'example.com/o/r',
        decoys: ['git@example.com/o/r'],
      },
    ];
    const folder = repositoryWith(name, spellings[0]?.url ?? '');
    const root = path.join(variable('HARNESS_RUN_FOLDER'), `${name}-root`);
    await setUserSetting(SETTING, [root]);
    const window = await openFolderWindow(folder);
    const written: Array<[string, string[]]> = [];
    try {
      for (const spelling of spellings) {
        rmSync(root, {recursive: true, force: true});
        const exact = writeAt(
          root,
          path.join(spelling.exact, MAIN),
          '{"image": "x"}\n',
        );
        const decoys = spelling.decoys.map(decoy =>
          writeAt(root, path.join(decoy, MAIN), '{"image": "x"}\n'),
        );
        execFileSync('git', [
          '-C',
          folder,
          'remote',
          'set-url',
          'origin',
          spelling.url,
        ]);
        await finishedWithPlain(window);
        await waitFor(
          `the Feature in ${spelling.exact}`,
          () => hasFeatures(exact),
          30_000,
        );
        written.push([
          spelling.url,
          [exact, ...decoys]
            .filter(file => hasFeatures(file))
            .map(file => path.relative(root, path.dirname(path.dirname(file)))),
        ]);
        await inWindow(window, 'workbench.action.closeAllEditors');
      }
      deepStrictEqual(
        written,
        spellings.map(spelling => [spelling.url, [spelling.exact]]),
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });

  it('F-0302 AC-18, AC-32 (c161-log): roots with no file for the remote, one of them missing, give no error, and the Dev Containers log names the candidate path checked under each, the same way for both', async () => {
    const name = 'c161-log';
    const folder = repositoryWith(name, `https://github.com/o/${name}.git`);
    const root = freshFolder(`${name}-root`);
    const missing = path.join(root, 'absent-folder');
    await setUserSetting(SETTING, [missing, root]);
    const window = await openFolderWindow(folder);
    try {
      const mark = containersLog().length;
      inWindow(window, COMMAND).catch(() => undefined);
      const dialog = await waitForDialog(window, 60_000);
      await pressEscape(window);
      const lines = containersLog()
        .slice(mark)
        .filter(line => line.includes('looking for a configuration in'));
      deepStrictEqual(
        [
          dialog.details.includes('No container configuration file found.') ||
            dialog.message.includes('No container configuration file found.'),
          [missing, root].map(each =>
            lines.some(line =>
              line.endsWith(
                `looking for a configuration in ${path.join(each, 'github.com', 'o', name)}`,
              ),
            ),
          ),
          containersLog()
            .slice(mark)
            .some(line => line.includes('does not exist')),
        ],
        [true, [true, true], false],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
