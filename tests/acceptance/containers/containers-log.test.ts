import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {
  closeWindow,
  containersLog,
  containersLogSince,
  devContainerFolder,
  reopenInContainer,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';

/** The display name and the version of Dev Containers, as its manifest gives them. */
const MANIFEST = JSON.parse(
  readFileSync(
    path.join(
      import.meta.dirname,
      '..',
      '..',
      '..',
      'packages',
      'remote-containers',
      'package.json',
    ),
    'utf8',
  ),
) as {displayName: string; version: string};

describe('the harness reads the Dev Containers log (card containers-37)', function () {
  this.timeout(600_000);

  it('card containers-37: after a Reopen, the log holds the activation’s banner line with the extension’s display name and version', async () => {
    const folder = devContainerFolder('c37-log');
    const name = await openFolderWindow(folder);
    try {
      const mark = containersLog().length;
      await reopenInContainer(name);
      const banners = containersLogSince(mark).filter(line =>
        line.startsWith(`${MANIFEST.displayName} ${MANIFEST.version} in `),
      );
      deepStrictEqual(banners.length > 0, true);
      await closeWindow(name);
    } finally {
      await removeContainers(folder);
    }
  });
});
