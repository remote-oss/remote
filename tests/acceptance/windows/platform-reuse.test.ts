import {deepStrictEqual} from 'node:assert';
import {appendScript, openWindow, recordLines, waitFor} from './harness.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
  openConnected,
  pickHost,
  runWith,
  setting,
} from './maintenance.ts';

describe('a running local connection server is reused before the platform is decided (card connect-110)', function () {
  this.timeout(600_000);

  before(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', undefined);
  });

  after(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
  });

  it('F-2206 AC-29 (c110-local-server): with a windows entry added while the shared local server runs, a new window reuses it and connects, and after Kill Local Connection Server For Host... the entry takes effect', async () => {
    await openConnected('l29a', INSTALL_MILLISECONDS);
    await setting('remote.SSH.remotePlatform', {harness: 'windows'});
    await openConnected('l29b', INSTALL_MILLISECONDS);
    await runWith('local', 'opensshremotes.cleanLocalServer', [
      pickHost('harness'),
    ]);
    await closeAllButLocal();
    appendScript([...dismissals('l29c')]);
    await openWindow('harness', 'l29c');
    await waitFor(
      'the failure dialog',
      () => recordLines('failureDialog', 'l29c').length > 0,
      120_000,
    );
    deepStrictEqual(
      recordLines('failureDialog', 'l29c').map(line => line.question),
      ['Could not establish connection to "harness".'],
    );
  });
});
