import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  containersLog,
  devContainerFolder,
  reopenStarted,
} from '../windows/harness.ts';
import {openFolderWindow, removeContainers} from '../windows/folder-windows.ts';
import {dialogText, notifications, waitForDialog} from '../windows/renderer.ts';

/** The text of STR:S121, which only the Problems panel shows. */
const S121 = 'Direct tarball references must be served over HTTPS.';

/** The detail of the dialog a Feature key that cannot be resolved gives. */
const FEATURE_NOT_FOUND =
  'The feature was not found either because it is no longer available or because of insufficient permissions to access it.';

describe('half-done rows of the container flows (card coverage-78)', function () {
  this.timeout(600_000);

  it('F-0414 AC-9 (c78-http-build): a build attempt with an http:// Feature key never shows STR:S121, in the dialog, a notification or the log', async () => {
    const folder = devContainerFolder('c78-http-key', {
      name: 'Http Key',
      features: {'http://example.com/x.tgz': {}},
    });
    const mark = containersLog().length;
    const name = await openFolderWindow(folder);
    try {
      await reopenStarted(name);
      const dialog = await waitForDialog(name, 240_000);
      const shown = [
        dialog.message,
        dialog.details,
        (await dialogText(name)) ?? '',
        ...(await notifications(name)),
        ...containersLog().slice(mark),
      ];
      deepStrictEqual(
        [dialog.details, shown.filter(text => text.includes(S121))],
        [FEATURE_NOT_FOUND, []],
      );
    } finally {
      await closeWindow(name).catch(() => undefined);
      await removeContainers(folder);
    }
  });
});
