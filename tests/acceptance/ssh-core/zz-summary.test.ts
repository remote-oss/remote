import {
  appendScript,
  closeWindow,
  connectionLog,
  openWindow,
  recordLines,
  waitFor,
} from '../windows/harness.ts';
import {
  closeAllButLocal,
  dismissals,
  INSTALL_MILLISECONDS,
} from '../windows/maintenance.ts';

const NO_HINTS = 'No hints found in the recent session.';

describe('where the summary line of a failure without issues falls against the row’s mark (card #2710, throwaway)', function () {
  this.timeout(2_400_000);

  beforeEach(closeAllButLocal);

  it('the rounds', async () => {
    const rounds: unknown[] = [];
    for (const [host, count] of [
      ['refused', 40],
      ['nowhere', 10],
    ] as const) {
      for (let round = 0; round < count; round += 1) {
        const folder = `zz-sum-${host}-${String(round)}`;
        appendScript(dismissals(folder));
        const before = connectionLog().length;
        const beganAt = Date.now();
        await openWindow(host, folder);
        const openTook = Date.now() - beganAt;
        const mark = connectionLog().length;
        await waitFor(
          `the failure dialog of ${folder}`,
          () => recordLines('failureDialog', folder).length > 0,
          INSTALL_MILLISECONDS,
        );
        const dialogAfter = Date.now() - beganAt;
        const lines = connectionLog();
        const found = lines.indexOf(NO_HINTS);
        rounds.push({
          host,
          round,
          openTook,
          dialogAfter,
          before,
          mark,
          noHintsAt: found,
          noHintsBeforeMark: found >= 0 && found < mark,
          noHintsMissing: found < 0,
        });
        process.stdout.write(`ROUND ${JSON.stringify(rounds.at(-1))}\n`);
        await closeWindow(folder).catch(() => undefined);
      }
    }
    process.stdout.write(
      `SUMMARY ${JSON.stringify({before: rounds.filter(r => (r as {noHintsBeforeMark: boolean}).noHintsBeforeMark).length, missing: rounds.filter(r => (r as {noHintsMissing: boolean}).noHintsMissing).length, rounds: rounds.length})}\n`,
    );
  });
});
