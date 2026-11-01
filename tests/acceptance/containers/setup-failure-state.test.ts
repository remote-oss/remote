import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  devContainersOf,
  inWindow,
  reopenStarted,
  variable,
} from '../windows/harness.ts';
import {
  answerDialog,
  dialogKindOf,
  pressEscape,
  quickPickOf,
  quickPickRows,
  statusItem,
  statusItemIcons,
  waitForDialog,
  waitForQuickPick,
  windowTitle,
} from '../windows/renderer.ts';
import {paletteItems} from '../windows/palette.ts';
import {mkdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

/** The string of the editor's table the failed-setup dialog shows. */
const S034 = 'An error occurred setting up the container.';

/** How long a connect that ends in a dialog takes. */
const DIALOG_MILLISECONDS = 180_000;

describe('A setup that fails leaves a disconnected dev container window (card coverage-74)', function () {
  this.timeout(900_000);

  it('F-0401 AC-12 (c74-dockerfile-fails): a Dockerfile build that fails shows the error dialog with its three buttons and its four More Actions, then a disconnected window titled with the folder alone, an alert on the indicator, the failure in the Dev Containers log, and no Reopen in Container in the palette or the indicator menu', async () => {
    const folder = devContainerFolder('c74-build-fails', {
      name: 'Build Fails',
      image: undefined,
      build: {dockerfile: 'Dockerfile'},
    });
    mkdirSync(path.join(folder, '.devcontainer'), {recursive: true});
    writeFileSync(
      path.join(folder, '.devcontainer', 'Dockerfile'),
      `FROM ${variable('HARNESS_DEVCONTAINER_IMAGE')}\nRUN echo c74-broken && false\n`,
    );
    try {
      const mark = containersLog().length;
      const name = await openFolderWindow(folder);
      await reopenStarted(name);
      const shown = await waitForDialog(name, DIALOG_MILLISECONDS);
      const kind = await dialogKindOf(name);
      await answerDialog(name, 'More Actions...');
      const pick = await waitForQuickPick(name, 30_000);
      const rows = await quickPickRows(name);
      await pressEscape(name);
      await new Promise(resolve => setTimeout(resolve, 3000));
      const palette = await paletteItems(name, 'Reopen in Container');
      await inWindow(name, 'workbench.action.remote.showMenu');
      await new Promise(resolve => setTimeout(resolve, 1500));
      const menu = (await quickPickOf(name))?.items ?? [];
      await pressEscape(name);
      const state = {
        dialog: [shown.message, shown.details, [...shown.buttons], kind],
        pick: [
          pick.placeholder,
          rows.map(entry => [entry.label, entry.focused]),
        ],
        title: await windowTitle(name),
        indicator: (await statusItem(name, 'status.host')).text,
        icons: await statusItemIcons(name, 'status.host'),
        logged: containersLogSince(mark).some(line =>
          line.includes('c74-broken'),
        ),
        palette: palette.filter(each => each.includes('Reopen in Container')),
        menu: menu.filter(each => each.includes('Reopen in Container')),
        containers: await devContainersOf(folder),
      };
      await closeWindow(name);
      deepStrictEqual(state, {
        dialog: [
          '',
          S034,
          ['Edit devcontainer.json Locally', 'More Actions...', 'Retry'],
          'error',
        ],
        pick: [
          'Pick an action to help resolve the problem.',
          [
            ['Reload Window', true],
            ['Edit devcontainer.json Locally', false],
            ['Open Recent...', false],
            ['Open Documentation', false],
          ],
        ],
        title: '[c74-build-fails [Dev Container]]',
        indicator: 'Disconnected from Dev Container',
        icons: ['alert'],
        logged: true,
        palette: [],
        menu: [],
        containers: [],
      });
    } finally {
      await removeContainers(folder);
    }
  });
});
