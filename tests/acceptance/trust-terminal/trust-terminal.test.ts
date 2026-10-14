import {deepStrictEqual} from 'node:assert';
import {isTrusted, openWindow, recordLines} from '../windows/harness.ts';
import {waitForDialog} from '../windows/renderer.ts';

/** The buttons of core's trust request, in the order the page holds them (measured on the run's build). */
const REQUEST_BUTTONS = ['Manage', 'Cancel', 'Trust Folder & Continue'];

describe('the trust launch with core’s defaults (card tooling-33)', function () {
  this.timeout(300000);

  it('tooling-33: with core’s defaults a folder opens untrusted, with no question until the terminal-mode connect asks for trust', async () => {
    await openWindow('harness', 's3');
    const shown = await waitForDialog('s3');
    const progress = recordLines('progress', 's3').map(line => line.question);
    deepStrictEqual(
      [
        await isTrusted('s3'),
        shown.message,
        shown.buttons,
        progress.includes('Setting up SSH Host harness'),
        progress.includes('Setting up SSH tunnel'),
      ],
      [
        false,
        'Do you trust the authors of the files in this folder?',
        REQUEST_BUTTONS,
        true,
        false,
      ],
    );
  });
});
