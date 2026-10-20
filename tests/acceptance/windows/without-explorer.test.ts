import {deepStrictEqual} from 'node:assert';
import {
  closeWindow,
  connectionLog,
  extensionPresent,
  openWindow,
  recordLines,
  waitFor,
  windowState,
} from './harness.ts';

describe('Remote - SSH without the Remote Explorer (card coverage-25c, part b)', function () {
  this.timeout(180_000);

  it('F-5902 AC-4 (no-explorer): in a launch without the Remote Explorer, an SSH window connects with no notice, no failure dialog and no companion line in the log', async () => {
    const name = 'no-explorer';
    const before = connectionLog().length;
    await openWindow('harness', name);
    try {
      await waitFor(
        `window ${name} to connect to harness`,
        async () =>
          (await windowState(name)).remoteAuthority === 'ssh-remote+harness',
        120_000,
      );
      deepStrictEqual(
        [
          await extensionPresent(name, 'remote-oss.remote-explorer'),
          recordLines('notice', name),
          recordLines('failureDialog', name),
          connectionLog()
            .slice(before)
            .filter(line => /companion|remote-internal/i.test(line)),
        ],
        [false, [], [], []],
      );
    } finally {
      await closeWindow(name);
    }
  });
});
