import {strictEqual} from 'node:assert';
import {inWindow} from '../windows/harness.ts';

/** What running a command in the local window gave: it finished, or it failed with this message. */
async function outcomeOf(
  command: string,
  ...parameters: unknown[]
): Promise<string> {
  try {
    await inWindow('local', command, ...parameters);
    return 'done';
  } catch (caught) {
    return caught instanceof Error ? caught.message : String(caught);
  }
}

describe('the commands of an editor that does not enable the proposed API (card connect-30)', function () {
  this.timeout(180000);

  it('contracts §3.2: F-3903 §5 rule 4, without the proposal Connect to Host is a command, not "not found"', async () => {
    strictEqual(
      (
        await outcomeOf('opensshremotes.openEmptyWindow', {host: 'harness'})
      ).includes('not found'),
      false,
    );
  });
});
