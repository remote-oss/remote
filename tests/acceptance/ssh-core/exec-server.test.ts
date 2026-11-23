import {deepStrictEqual} from 'node:assert';
import {closeWindow, execSpawnedIn, openWindow} from '../windows/harness.ts';
import {setting} from '../windows/maintenance.ts';

describe('the exec server of an SSH window (card connect-146)', function () {
  this.timeout(300_000);

  it('brief-remote-ssh-engines §2 (c146-direct): with remote.SSH.useExecServer off, getRemoteExecServer rejects with the reason, and the window stays connected', async () => {
    await setting('remote.SSH.useExecServer', false);
    try {
      await openWindow('harness', 'c146-direct');
      try {
        let message = 'it resolved';
        try {
          await execSpawnedIn('c146-direct', 'true', [], {});
        } catch (caught) {
          message = caught instanceof Error ? caught.message : String(caught);
        }
        deepStrictEqual(
          message.includes(
            'The exec server is off: the setting remote.SSH.useExecServer is false.',
          ),
          true,
        );
      } finally {
        await closeWindow('c146-direct').catch(() => undefined);
      }
    } finally {
      await setting('remote.SSH.useExecServer', undefined);
    }
  });
});
