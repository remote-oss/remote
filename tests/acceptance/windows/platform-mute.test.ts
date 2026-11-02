import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  connectedWithin,
  openWindow,
  recordLines,
} from './harness.ts';
import {
  closeAllButLocal,
  INSTALL_MILLISECONDS,
  setting,
} from './maintenance.ts';

describe('a host whose login shell does not answer, in non-local mode (card connect-111)', function () {
  this.timeout(600_000);

  before(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', false);
  });

  after(async () => {
    await closeAllButLocal();
    await setting('remote.SSH.remotePlatform', undefined);
    await setting('remote.SSH.useLocalServer', undefined);
  });

  it('F-2206 AC-28 (c111-mute): with Linux picked the host connects, slowly, and no failure dialog shows', async () => {
    appendScript([
      {
        surface: 'platformPick',
        match: 'platform',
        answer: 'linux',
        window: 'm28',
      },
    ]);
    await openWindow('mute', 'm28', 'harness-mute');
    await connectedWithin('m28', INSTALL_MILLISECONDS, 'harness-mute');
    deepStrictEqual(
      recordLines('failureDialog', 'm28').map(line => line.question),
      [],
    );
  });
});
