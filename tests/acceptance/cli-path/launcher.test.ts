/**
 * @fileoverview The commit-keyed launcher on the exec-server path (F-2008 AC-15): the launcher the install put in the
 * server folder is deleted and the server killed, and the next connection installs it again and succeeds.
 */

import {deepStrictEqual} from 'node:assert';
import {
  closeContained,
  closeWindow,
  connectedWithin,
  onHostAs,
  openWindow,
} from '../windows/harness.ts';
import {runFromPalette} from '../windows/palette.ts';
import {dialogOf, pressEscape} from '../windows/renderer.ts';

/** The server folder of the editor under test on the host. */
const SERVER_FOLDER = '/home/harness/.vscodium-server-insiders';

/** The top-level names of the server folder. */
async function namesInServerFolder(): Promise<string[]> {
  return (await onHostAs('harness', 'ls', '-1A', SERVER_FOLDER))
    .split('\n')
    .filter(name => name !== '');
}

/** The launcher among `names`: the top-level file whose name ends in a dash and a commit of 40 hex digits. */
function launcherAmong(names: readonly string[]): string {
  const found = names.find(name => /-[0-9a-f]{40}$/.test(name));
  if (found === undefined) {
    throw new Error(
      `no launcher among the names of ${SERVER_FOLDER}: ${JSON.stringify(names)}`,
    );
  }
  return found;
}

describe('the launcher of the exec-server path (card #2500, F-2008)', function () {
  this.timeout(300_000);

  it('F-2008 AC-15 (c2500-launcher): after the launcher is deleted and the server killed, the next connection installs the same launcher again and shows no error dialog', async () => {
    await openWindow('harness', 'f2008-launcher');
    let launcher: string;
    try {
      await connectedWithin('f2008-launcher', 120_000);
      launcher = launcherAmong(await namesInServerFolder());
      await onHostAs('harness', 'rm', '-f', `${SERVER_FOLDER}/${launcher}`);
      await runFromPalette(
        'f2008-launcher',
        'Remote-SSH: Kill Current VS Code Server',
      );
    } finally {
      await closeContained('f2008-launcher', pressEscape);
    }
    await openWindow('harness', 'f2008-launcher-again');
    try {
      await connectedWithin('f2008-launcher-again', 120_000);
      deepStrictEqual(
        {
          back: (await namesInServerFolder()).includes(launcher),
          dialog: await dialogOf('f2008-launcher-again'),
        },
        {back: true, dialog: undefined},
      );
    } finally {
      await closeWindow('f2008-launcher-again');
    }
  });
});
