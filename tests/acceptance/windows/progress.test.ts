import {deepStrictEqual} from 'node:assert';
import {
  appendScript,
  closeWindow,
  openWindow,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
  waitFor,
} from './harness.ts';

const SETTING_UP = 'Setting up SSH Host noforward';

/** The lines of the window `pg1` that the record holds. */
function linesOfPg1() {
  return recordLines(undefined, 'pg1');
}

describe('the progress of a connect that core retries (card coverage-29)', function () {
  this.timeout(180000);

  it('F-2304 AC-20 (progress-reconnect): a platform pick dismissed during core’s reconnection attempts shows no failure dialog, the progress starts again and the next pick is held', async () => {
    const saved = readUserSettings();
    try {
      await userSettings({
        'remote.SSH.useLocalServer': false,
        'remote.SSH.enableDynamicForwarding': false,
        'remote.SSH.useExecServer': false,
      });
      appendScript([
        {
          surface: 'platformPick',
          match: 'noforward',
          answer: 'linux',
          window: 'pg1',
        },
        {
          surface: 'platformPick',
          match: 'noforward',
          answer: 'dismiss',
          window: 'pg1',
        },
        {
          surface: 'platformPick',
          match: 'noforward',
          answer: 'linux',
          window: 'pg1',
          after: 'never',
        },
      ]);
      await openWindow('noforward', 'pg1');
      await waitFor(
        'the dismissed platform pick',
        () =>
          linesOfPg1().some(
            line =>
              line.surface === 'platformPick' && line.answer === 'dismiss',
          ),
        120_000,
      );
      const dismissedAt = linesOfPg1().findIndex(
        line => line.surface === 'platformPick' && line.answer === 'dismiss',
      );
      const dismissedTime = linesOfPg1()[dismissedAt]?.time ?? 0;
      await waitFor(
        'a new progress and the held pick after the dismissed one',
        () => {
          const after = linesOfPg1().slice(dismissedAt + 1);
          const restart = after.findIndex(
            line => line.surface === 'progress' && line.question === SETTING_UP,
          );
          return (
            restart !== -1 &&
            after
              .slice(restart + 1)
              .some(line => line.surface === 'platformPick')
          );
        },
        5000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const lines = linesOfPg1();
      const restartLine = lines
        .slice(dismissedAt + 1)
        .find(
          line => line.surface === 'progress' && line.question === SETTING_UP,
        );
      deepStrictEqual(
        [
          lines.filter(
            line => line.surface === 'progress' && line.question === SETTING_UP,
          ).length >= 2,
          lines.some(line => line.surface === 'failureDialog'),
          (restartLine?.time ?? Infinity) - dismissedTime <= 5000,
        ],
        [true, false, true],
      );
    } finally {
      await closeWindow('pg1');
      restoreUserSettings(saved);
    }
  });
});
