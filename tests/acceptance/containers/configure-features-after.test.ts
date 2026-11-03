/**
 * @fileoverview What follows the write of Configure Container Features (card containers-150, part D): the rebuild prompt
 * of a window attached to a dev container, no prompt in a local window, and the version check in the log.
 */

import {deepStrictEqual} from 'node:assert';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  connectedToContainer,
  containersLog,
  devContainerFolder,
  devContainersOf,
  inWindow,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {
  answerNotification,
  notificationButtons,
  pressQuickPickTitleButton,
  toggleQuickPickRow,
} from '../windows/renderer.ts';
import {
  changed,
  CHANGED_START,
  clearNotifications,
  connectedWindow,
  noticesAfter,
  noticesWhen,
} from '../windows/config-watch-support.ts';
import {
  FEATURES_PLACEHOLDER,
  screenWith,
} from '../windows/authoring-support.ts';

const COMMAND = 'remote-containers.configureContainerFeatures';
const PLAIN = 'Lab Plain';

/** The features of the configuration of `folder`, as the JSON file holds them. */
function featuresOf(folder: string): string[] {
  const file = path.join(folder, '.devcontainer', 'devcontainer.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
    features?: Record<string, unknown>;
  };
  return Object.keys(parsed.features ?? {});
}

/** Runs the command in `window`, checks the Feature `PLAIN` and presses Finish. */
async function finishedWithPlain(window: string): Promise<void> {
  inWindow(window, COMMAND).catch(() => undefined);
  await screenWith(window, FEATURES_PLACEHOLDER);
  await toggleQuickPickRow(window, PLAIN);
  await pressQuickPickTitleButton(window, 'Finish');
}

describe('Configure Container Features: after the write (card containers-150, part D)', function () {
  this.timeout(900_000);

  it('F-0807 AC-20, AC-22 (c150-ignore): in a window attached to a dev container the write shows the rebuild notification with Rebuild and Ignore, Ignore dismisses it, the file keeps the edit and the container is the same', async () => {
    const folder = devContainerFolder('c150-ignore', {name: 'C150 Ignore'});
    const window = await connectedWindow(folder);
    try {
      const [before = ''] = await devContainersOf(folder);
      await clearNotifications(window);
      await finishedWithPlain(window);
      const shown = await noticesWhen(window, 1);
      const buttons = await notificationButtons(window, CHANGED_START);
      await answerNotification(window, CHANGED_START, 'Ignore');
      await new Promise(resolve => setTimeout(resolve, 3000));
      const [after = ''] = await devContainersOf(folder);
      deepStrictEqual(
        [
          shown,
          buttons,
          await noticesAfter(window, 0),
          featuresOf(folder).length,
          after === before,
        ],
        [[changed('devcontainer.json')], ['Rebuild', 'Ignore'], [], 1, true],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0807 AC-21 (c150-rebuild): Rebuild on that notification recreates the container in the same window and writes devcontainer-lock.json beside the configuration', async () => {
    const folder = devContainerFolder('c150-rebuild', {name: 'C150 Rebuild'});
    const window = await connectedWindow(folder);
    try {
      const [first = ''] = await devContainersOf(folder);
      await clearNotifications(window);
      await finishedWithPlain(window);
      await noticesWhen(window, 1);
      await answerNotification(window, CHANGED_START, 'Rebuild');
      await waitFor(
        'the rebuilt container',
        async () => {
          const [now] = await devContainersOf(folder);
          return now !== undefined && now !== first;
        },
        600_000,
      );
      await connectedToContainer(window, 600_000);
      deepStrictEqual(
        existsSync(
          path.join(folder, '.devcontainer', 'devcontainer-lock.json'),
        ),
        true,
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0807 AC-25, AC-26 (c150-local): in a window with no container no rebuild notification shows, and the Dev Containers log records the version check of the written configuration; a Finish that changes nothing logs none', async () => {
    const folder = path.join(variable('HARNESS_RUN_FOLDER'), 'c150-local');
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'devcontainer.json'),
      '{"image": "x"}\n',
    );
    const window = await openFolderWindow(folder);
    try {
      const mark = containersLog().length;
      await finishedWithPlain(window);
      await waitFor(
        'the version check in the log',
        () =>
          containersLog()
            .slice(mark)
            .some(line => line.includes('the version check of')),
        120_000,
      );
      const notices = await noticesAfter(window, 5);
      const lines = containersLog()
        .slice(mark)
        .filter(line => line.includes('the version check of'));
      const quiet = containersLog().length;
      inWindow(window, COMMAND).catch(() => undefined);
      await screenWith(window, FEATURES_PLACEHOLDER);
      await pressQuickPickTitleButton(window, 'Finish');
      await new Promise(resolve => setTimeout(resolve, 5000));
      deepStrictEqual(
        [
          notices,
          lines.length,
          containersLog()
            .slice(quiet)
            .filter(line => line.includes('the version check of')),
        ],
        [[], 1, []],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
    }
  });
});
