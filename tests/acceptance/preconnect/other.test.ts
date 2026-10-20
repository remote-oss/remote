import {deepStrictEqual} from 'node:assert';
import {rmSync} from 'node:fs';
import {
  appendScript,
  connectedWithin,
  connectionLog,
  cutHostNetwork,
  restoreHostNetwork,
  waitFor,
} from '../windows/harness.ts';
import {closeAllButLocal, pickHost, runWith} from '../windows/maintenance.ts';
import {
  answerEntry,
  dialogLines,
  dismissals,
  failureOf,
  markerOf,
  openConnected,
  withSetting,
  writeScript,
} from './support.ts';

/** The dialog lines that were shown, not the ones that wait. */
function shown(window: string): number {
  return dialogLines(window).filter(line => line.held !== true).length;
}

describe('the pre-connection script and what else a window does (card connect-87)', function () {
  this.timeout(600_000);

  afterEach(closeAllButLocal);

  it('F-2108 AC-30 (once): a reconnection and a kill of the server run no script and ask nothing', async () => {
    const script = writeScript('once.sh', 'echo ran >> "$MARKER"');
    appendScript([answerEntry('po30', 'Allow')]);
    await withSetting(script, async () => {
      await openConnected('po30');
      const attempts = connectionLog().length;
      cutHostNetwork();
      try {
        await waitFor(
          'po30 to try again',
          () =>
            Promise.resolve(
              connectionLog()
                .slice(attempts)
                .some(line => line.includes('reconnection')),
            ),
          180_000,
        );
      } finally {
        restoreHostNetwork();
      }
      await connectedWithin('po30', 120_000);
      await runWith('po30', 'opensshremotes.cleanRemoteServer', [
        pickHost('harness'),
        {surface: 'notice', match: 'VS Code Server on', answer: 'dismiss'},
      ]);
    });
    deepStrictEqual([shown('po30'), markerOf(script)], [1, 'ran\n']);
  });

  it("F-2108 AC-35 (deleted): a confirmed script that was deleted fails with the read's detail and no dialog, and its entry stays", async () => {
    const script = writeScript('deleted.sh', 'echo ran >> "$MARKER"');
    appendScript([
      answerEntry('po35a', "Allow and Don't Ask Again"),
      ...dismissals('po35b'),
    ]);
    const question = await withSetting(script, async () => {
      await openConnected('po35a');
      rmSync(script);
      return (await failureOf('po35b')).question;
    });
    writeScript('deleted.sh', 'echo ran >> "$MARKER"');
    await withSetting(script, () => openConnected('po35c'));
    deepStrictEqual(
      [question, shown('po35b'), shown('po35c')],
      [
        `Could not establish connection to "harness": ENOENT: no such file or directory, open '${script}'.`,
        0,
        0,
      ],
    );
  });
});
