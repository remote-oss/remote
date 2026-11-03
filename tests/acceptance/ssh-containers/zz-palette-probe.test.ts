/**
 * @fileoverview A one-off measurement (never merged): what an SSH window's Command Palette and command registry hold of
 * the local extensions, beside a local window's, in a launch with Dev Containers installed.
 */

import {closeWindow, commandsOf, onHost, openWindow} from '../windows/harness.ts';
import {paletteRows} from '../windows/renderer.ts';

describe('palette probe (never merged)', function () {
  this.timeout(600_000);

  it('dumps the palette and the registered commands of a local and an SSH window', async () => {
    for (const window of ['local']) {
      console.log(`[probe] local palette Remote-SSH: ${JSON.stringify(await paletteRows(window, 'Remote-SSH:'))}`);
      console.log(`[probe] local palette Dev Containers: ${JSON.stringify(await paletteRows(window, 'Dev Containers:'))}`);
      console.log(`[probe] local registered opensshremotes.: ${(await commandsOf(window, 'opensshremotes.')).length}`);
    }
    await onHost('mkdir', '-p', '/home/harness/zz-probe');
    await openWindow('harness', 'zz-probe');
    try {
      await new Promise(resolve => setTimeout(resolve, 8000));
      for (const text of ['Remote-SSH:', 'Dev Containers:', 'Kill VS Code Server', 'Remote:']) {
        console.log(`[probe] ssh palette ${text} ${JSON.stringify(await paletteRows('zz-probe', text))}`);
      }
      for (const prefix of ['opensshremotes.', 'remote-ssh.', 'remote-containers.']) {
        const registered = await commandsOf('zz-probe', prefix);
        console.log(`[probe] ssh registered ${prefix} ${registered.length}: ${JSON.stringify(registered.slice(0, 8))}`);
      }
    } finally {
      await closeWindow('zz-probe').catch(() => undefined);
    }
  });
});
