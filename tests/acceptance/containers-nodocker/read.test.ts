/**
 * @fileoverview F-0201 AC-55 with no `docker` on the editor's PATH (card containers-147): a relative `dockerPath` is a
 * file of the folder, which nothing runs before the folder is trusted, and a window whose read of the configuration
 * comes before that still connects once the folder is trusted.
 */

import {execFileSync} from 'node:child_process';
import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  closeWindow,
  devContainerFolder,
  reopenInContainer,
  variable,
  windowState,
} from '../windows/harness.ts';
import {
  openFolderWindow,
  removeContainers,
  setUserSetting,
} from '../windows/folder-windows.ts';
import {answerDialog, waitForDialog} from '../windows/renderer.ts';
import {folderWrapper, recordedCalls} from '../windows/folder-wrapper.ts';

/** What a window on a folder whose `dockerPath` is `setting` (the folder's wrapper, relative or absolute) shows. */
async function connectedWith(
  label: string,
  setting: 'relative' | 'absolute',
): Promise<{
  whileAsking: string[];
  remoteName: string | null;
  wrapped: boolean;
}> {
  // The editor was started with an empty PATH; this process needs docker for its own clean-up and to find the program.
  process.env.PATH = '/usr/bin:/bin';
  const calls = path.join(variable('HARNESS_RUN_FOLDER'), `${label}-calls`);
  const folder = devContainerFolder(label, {name: label});
  folderWrapper(
    folder,
    calls,
    execFileSync('/usr/bin/which', ['docker']).toString().trim(),
  );
  await setUserSetting(
    'dev.containers.dockerPath',
    setting === 'relative' ? 'tools/dk' : path.join(folder, 'tools', 'dk'),
  );
  const name = await openFolderWindow(folder);
  try {
    const reopened = reopenInContainer(name);
    await waitForDialog(name);
    const whileAsking = recordedCalls(calls);
    await answerDialog(name, 'Trust Folder & Continue');
    await reopened;
    return {
      whileAsking,
      remoteName: (await windowState(name)).remoteName,
      wrapped: recordedCalls(calls).some(call => call.startsWith('version')),
    };
  } finally {
    await closeWindow(name).catch(() => undefined);
    await removeContainers(folder).catch(() => undefined);
  }
}

describe('a window with no docker on its PATH (card containers-147, F-0201 AC-55)', function () {
  this.timeout(600_000);

  it('F-0201 AC-55 (c147-nodocker): with no docker on the PATH, a relative dockerPath runs nothing before the folder is trusted, and after Trust Folder & Continue the window connects', async () => {
    deepStrictEqual(await connectedWith('c147-relative', 'relative'), {
      whileAsking: [],
      remoteName: 'dev-container',
      wrapped: true,
    });
  });

  it('F-0201 AC-55 (c147-nodocker-absolute): the same with the absolute path of the program connects too, which is what the relative case is measured against', async () => {
    const seen = await connectedWith('c147-absolute', 'absolute');
    deepStrictEqual([seen.remoteName, seen.wrapped], ['dev-container', true]);
  });
});
