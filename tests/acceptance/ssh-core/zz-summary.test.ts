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
      ['refused', 60],
      ['nowhere', 0],
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
        const found = lines.findIndex(
          (line, index) => index >= before && line === NO_HINTS,
        );
        const stamped = connectionLog({withTimes: true});
        const stampLine = found < 0 ? '' : (stamped[found] ?? '');
        const openReturnedAt = beganAt + openTook;
        const dayStart = new Date(openReturnedAt).setUTCHours(0, 0, 0, 0);
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
          inSliceFromBefore: lines.slice(before).includes(NO_HINTS),
          inSliceFromMark: lines.slice(mark).includes(NO_HINTS),
          ruleBeforeIt: found > 0 && lines[found - 1] === '-'.repeat(40),
          stampLine,
          dayStart,
          openReturnedAt,
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
