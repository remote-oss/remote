/**
 * @fileoverview Configure Container Features in a dev container window and with two majors (card containers-150,
 * part E): the build's metadata of two majors of one Feature, and the command's places in the window's menus.
 */

import {execFile} from 'node:child_process';
import {deepStrictEqual} from 'node:assert';
import {promisify} from 'node:util';
import {
  closeWindow,
  devContainerFolder,
  devContainersOf,
  variable,
  waitFor,
} from '../windows/harness.ts';
import {removeContainers} from '../windows/folder-windows.ts';
import {connectedWindow} from '../windows/config-watch-support.ts';
import {
  allQuickPickRows,
  clickStatusItem,
  paletteRows,
  pressEscape,
  quickPickFacts,
} from '../windows/renderer.ts';

const execFileAsync = promisify(execFile);

describe('Configure Container Features: in a dev container window and with two majors (card containers-150, part E)', function () {
  this.timeout(900_000);

  it('F-0807 AC-28 (c150-majors): a configuration with two majors of the same Feature builds, and both are separate entries in the container’s metadata', async () => {
    const reference = `${variable('HARNESS_TEMPLATE_REGISTRY')}/remote-oss-run/features/lab-majors`;
    const folder = devContainerFolder('c150-majors', {
      name: 'C150 Majors',
      features: {[`${reference}:1`]: {}, [`${reference}:2`]: {}},
    });
    const window = await connectedWindow(folder);
    try {
      const [container = ''] = await devContainersOf(folder);
      const {stdout: label} = await execFileAsync('docker', [
        'inspect',
        '--format',
        '{{index .Config.Labels "devcontainer.metadata"}}',
        container,
      ]);
      const {stdout: files} = await execFileAsync('docker', [
        'exec',
        container,
        'sh',
        '-c',
        'cat /usr/local/share/remote-oss-run/lab-majors-*',
      ]);
      const entries = (JSON.parse(label) as Array<{id?: string}>).filter(
        entry => entry.id?.includes('lab-majors'),
      );
      deepStrictEqual(
        [entries.map(entry => entry.id), files.trim().split('\n').sort()],
        [
          [`${reference}:1`, `${reference}:2`],
          ['1.0.0', '2.0.0'],
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });

  it('F-0807 AC-2, AC-5 (reading-1971-indicator-order): in a window attached to a dev container the Command Palette offers the command and the remote indicator’s menu lists it first among the Dev Containers entries', async () => {
    const folder = devContainerFolder('c150-menus', {name: 'C150 Menus'});
    const window = await connectedWindow(folder);
    try {
      const palette = await paletteRows(window, 'Configure Container Features');
      await clickStatusItem(window, 'status.host');
      await waitFor(
        'the remote indicator’s menu',
        async () => (await quickPickFacts(window)) !== undefined,
        30_000,
      );
      const menu = (await allQuickPickRows(window)).map(each => each.label);
      await pressEscape(window);
      deepStrictEqual(
        [
          palette.includes('Dev Containers: Configure Container Features...'),
          menu.slice(0, 3),
        ],
        [
          true,
          [
            'Configure Container Features...',
            'Rebuild Container',
            'Reopen Folder Locally',
          ],
        ],
      );
    } finally {
      await closeWindow(window).catch(() => undefined);
      await removeContainers(folder).catch(() => undefined);
    }
  });
});
