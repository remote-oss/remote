/**
 * @fileoverview The smoke row of the explorer-stand-in launch (card tooling-121): the stand-in carries the companion's
 * id, the explorer calls it, and a call whose mode is a rejection leaves the view as it was. It names no criterion; it
 * proves the harness.
 */

import {deepStrictEqual} from 'node:assert';
import {inWindow, setStandInModes, waitFor} from '../windows/harness.ts';
import {viewRows} from '../windows/renderer.ts';

/** The launch's first window and the view it shows. */
const LOCAL = 'local';
const VIEW = 'Remotes (Tunnels/SSH)';

/** The interface version the explorer speaks, which the stand-in's answers carry. */
const VERSION = {major: 1, minor: 0};

/** The labels of the rows the view shows now. */
async function labels(): Promise<string[]> {
  return ((await viewRows(LOCAL, VIEW)) ?? []).map(entry => entry.label);
}

describe('the stand-in companion (card tooling-121)', function () {
  this.timeout(180_000);

  it('the explorer lists the host the stand-in answers with, and still lists it when the history call is set to reject', async () => {
    setStandInModes({
      'remote-internal.getConfiguredHostnames': {
        answer: {interfaceVersion: VERSION, hostnames: ['stand-in-host']},
      },
    });
    await inWindow(LOCAL, 'remoteTargets.focus');
    await inWindow(LOCAL, 'remote-explorer.refresh');
    await waitFor(
      'the stand-in host in the SSH group',
      async () => (await labels()).includes('stand-in-host'),
      60_000,
    );
    const answered = (await labels()).includes('stand-in-host');
    setStandInModes({
      'remote-internal.getConfiguredHostnames': {
        answer: {interfaceVersion: VERSION, hostnames: ['stand-in-host']},
      },
      'remote-internal.getSshFoldersHistory': {reject: 'stand-in'},
    });
    await inWindow(LOCAL, 'remote-explorer.refresh');
    await new Promise(resolve => setTimeout(resolve, 3000));
    deepStrictEqual(
      [answered, (await labels()).includes('stand-in-host')],
      [true, true],
    );
  });
});
