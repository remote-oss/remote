import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  devContainerFolder,
  environmentOf,
  relaunch,
} from '../windows/harness.ts';
import {openFolderWindow} from '../windows/folder-windows.ts';

describe('a row can relaunch its launch’s editor (card tooling-88)', function () {
  this.timeout(600_000);

  it('tooling-88 (relaunch-environment): a variable set through relaunch is in the restarted editor’s extension host, and the window is the same one', async () => {
    const name = await openFolderWindow(devContainerFolder('t88-relaunch'));
    try {
      const before = await environmentOf(name, 'T88_PROBE');
      await relaunch(name, {environment: {T88_PROBE: 'first'}});
      const first = await environmentOf(name, 'T88_PROBE');
      await relaunch(name, {environment: {T88_PROBE: 'second'}});
      const second = await environmentOf(name, 'T88_PROBE');
      deepStrictEqual([before, first, second], [null, 'first', 'second']);
    } finally {
      await closeWindow(name).catch(() => undefined);
    }
  });
});
