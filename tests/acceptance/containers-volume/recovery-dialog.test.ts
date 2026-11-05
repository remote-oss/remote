/**
 * @fileoverview The recovery container's failure dialog (card containers-162): the four buttons and More Actions,
 * Close Remote's empty window, and two windows recovering two volumes at once.
 */

import {deepStrictEqual} from 'node:assert';
import {
  type BrokenRepository,
  startBrokenRepository,
} from '../windows/broken-repository.ts';
import {
  closeWindow,
  openEmptyWindows,
  readUserSettings,
  restoreUserSettings,
  waitFor,
  windowState,
} from '../windows/harness.ts';
import {
  answerDialog,
  quickPickOf,
  quickPickRows,
  waitForDialog,
} from '../windows/renderer.ts';
import {removeClone} from '../windows/volume-clones.ts';
import {
  FIRST,
  FOUR_BUTTONS,
  RECOVERY,
  SECOND,
  inspected,
  reachRecovery,
  recoveryContainers,
  startClone,
  volumeOf,
} from './recovery-support.ts';

describe('The recovery container (card containers-160)', function () {
  this.timeout(2_400_000);
  let repository: BrokenRepository;
  let settingsBefore: string | undefined;

  before(async () => {
    repository = await startBrokenRepository();
    settingsBefore = readUserSettings();
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
  });

  after(async () => {
    restoreUserSettings(settingsBefore);
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
    await repository.stop();
  });

  it('F-0410 AC-14, AC-16c: a clone whose build fails offers four buttons, and More Actions picks five items with no container, the recovery one second', async () => {
    await startClone(repository.url);
    const dialog = await waitForDialog(FIRST, 900_000);
    await answerDialog(FIRST, 'More Actions...');
    await waitFor(
      'the More Actions pick',
      async () => (await quickPickOf(FIRST)) !== undefined,
      30_000,
    );
    const labels = (await quickPickRows(FIRST)).map(entry => entry.label);
    deepStrictEqual(
      {buttons: dialog.buttons, items: labels},
      {
        buttons: FOUR_BUTTONS,
        items: [
          'Reload Window',
          RECOVERY,
          'Open Repository',
          'Open Recent...',
          'Open Documentation',
        ],
      },
    );
    await closeWindow(FIRST);
  });

  it('F-0410 AC-15: Close Remote leaves a plain empty local window', async () => {
    const known = openEmptyWindows();
    await startClone(repository.url);
    await waitForDialog(FIRST, 900_000);
    await answerDialog(FIRST, 'Close Remote');
    let left = '';
    await waitFor(
      'an empty local window',
      () => {
        left = openEmptyWindows().find(each => !known.includes(each)) ?? '';
        return left !== '';
      },
      60_000,
    );
    deepStrictEqual((await windowState(left)).remoteName, null);
    await closeWindow(left);
  });

  it('F-0410 AC-16 (concurrency): two windows recovering two volumes at once each get a container that mounts only its own volume', async () => {
    await removeClone(repository.url);
    await removeClone(repository.otherUrl);
    await Promise.all([
      reachRecovery(repository.url, FIRST),
      reachRecovery(repository.otherUrl, SECOND),
    ]);
    const mounts = await Promise.all(
      [repository.url, repository.otherUrl].map(async source => {
        const volume = await volumeOf(source);
        const containers = await recoveryContainers(volume);
        return {
          containers: containers.length,
          mounted: (
            await inspected(
              String(containers[0]),
              '{{range .Mounts}}{{.Name}} {{end}}',
            )
          ).trim(),
          volume,
        };
      }),
    );
    deepStrictEqual(
      mounts.map(each => [each.containers, each.mounted === each.volume]),
      [
        [1, true],
        [1, true],
      ],
    );
    await closeWindow(FIRST);
    await closeWindow(SECOND);
  });
});
