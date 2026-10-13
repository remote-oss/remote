import {ok} from 'node:assert';
import {setTimeout as delay} from 'node:timers/promises';
import {onHost} from '../suite/harness.ts';

/** The modification time of a file on the host, in seconds. */
async function modifiedAt(file: string): Promise<number> {
  return Number((await onHost('stat', '-c', '%Y', file)).trim());
}

/** Waits up to a minute for the slow extension to finish activating on the host. */
async function waitForDone(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await modifiedAt('/tmp/acceptance-slow-done');
      return;
    } catch {
      await delay(500);
    }
  }
}

describe('a slow extension in the remote extension host', () => {
  before(waitForDone);

  it('D-85: the remote extension host waited 15 s for the slow extension', async () => {
    const started = await modifiedAt('/tmp/acceptance-slow-started');
    const done = await modifiedAt('/tmp/acceptance-slow-done');
    ok(done - started >= 15, `${String(done - started)} s`);
  });
});
