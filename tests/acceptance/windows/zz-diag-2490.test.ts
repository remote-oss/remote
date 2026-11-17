import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectedWithin,
  cutHostNetwork,
  noHelperWithin,
  openWindow,
  restoreHostNetwork,
} from './harness.ts';

describe('measure: the own connect of a window that did not connect', function () {
  this.timeout(300000);

  it('prints the window own record and Remote - SSH log', async () => {
    await openWindow('harness', 'a1');
    await connectedWithin('a1', 90_000);
    cutHostNetwork();
    let message = '';
    try {
      await connectedWithin('a1', 3_000);
    } catch (caught) {
      message = String(caught instanceof Error ? caught.message : caught);
    }
    restoreHostNetwork();
    console.log(message);
    await closeWindow('a1');
    await noHelperWithin(60_000);
    const own = message.slice(message.indexOf("the last lines of a1's"));
    deepStrictEqual(
      [message.includes('what a1 recorded:'), own.includes('Resolved')],
      [true, true],
    );
  });
});
