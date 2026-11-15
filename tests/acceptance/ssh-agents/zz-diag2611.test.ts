import {readUserSettings, restoreUserSettings} from '../windows/harness.ts';
import {readBackOfSetting} from '../windows/harness.ts';

describe('the facts of a timed-out read-back (card #2611, throwaway)', function () {
  this.timeout(300_000);

  it('a read-back of a value the file never held fails with its facts', async () => {
    const saved = readUserSettings();
    try {
      let message = 'it did not fail';
      await readBackOfSetting(
        'remote.SSH.remoteServerListenOnSocket',
        true,
        'window',
      ).catch((failure: unknown) => {
        message = String(failure);
      });
      process.stdout.write(`FACTS2611 ${message}\n`);
    } finally {
      restoreUserSettings(saved);
    }
  });
});
