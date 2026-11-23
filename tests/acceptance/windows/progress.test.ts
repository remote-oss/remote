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

describe('the progress of a connect that a refused forward ends (card coverage-29)', function () {
  this.timeout(180000);

  it('F-2304 AC-20 (ruling-1985-forwarding-fails): with the second ssh and a host that refuses TCP forwarding the platform is picked once, and the connect then fails with the forwarding dialog, with no reconnection and no second pick', async () => {
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
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: 'dismiss',
          window: 'pg1',
        },
        {
          surface: 'mitigationPick',
          match: 'Pick an action',
          answer: 'dismiss',
          window: 'pg1',
        },
      ]);
      await openWindow('noforward', 'pg1');
      await waitFor(
        'the failure dialog',
        () => linesOfPg1().some(line => line.surface === 'failureDialog'),
        120_000,
      );
      await new Promise(resolve => setTimeout(resolve, 10_000));
      const lines = linesOfPg1();
      deepStrictEqual(
        [
          lines.filter(line => line.surface === 'platformPick').length,
          lines.filter(line => line.surface === 'failureDialog').length,
          lines.filter(
            line => line.surface === 'progress' && line.question === SETTING_UP,
          ).length,
        ],
        [1, 1, 1],
      );
    } finally {
      await closeWindow('pg1');
      restoreUserSettings(saved);
    }
  });
  it('F-2304 AC-20 (reading-2716-reconnect-vacuous): in the setup of 6.9 the Given of core’s reconnection attempts never arises: a dismissed platform picker starts no attempt, brings no second picker and no second progress notification, and ends in the failure dialog of the cancelled connect', async () => {
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
          answer: 'dismiss',
          window: 'pg2',
        },
        {
          surface: 'failureDialog',
          match: 'Could not establish connection',
          answer: 'dismiss',
          window: 'pg2',
        },
        {
          surface: 'mitigationPick',
          match: 'Pick an action',
          answer: 'dismiss',
          window: 'pg2',
        },
      ]);
      await openWindow('noforward', 'pg2');
      await waitFor(
        'the failure dialog',
        () =>
          recordLines(undefined, 'pg2').some(
            line => line.surface === 'failureDialog',
          ),
        120_000,
      );
      // Core's immediate reconnection attempts would have come by now: they start at once after the first resolve.
      await new Promise(resolve => setTimeout(resolve, 15_000));
      const lines = recordLines(undefined, 'pg2');
      deepStrictEqual(
        [
          lines.filter(line => line.surface === 'platformPick').length,
          lines.filter(
            line => line.surface === 'progress' && line.question === SETTING_UP,
          ).length,
          lines
            .filter(line => line.surface === 'failureDialog')
            .map(line => line.question),
        ],
        [
          1,
          1,
          [
            'Could not establish connection to "noforward": Connecting was canceled.',
          ],
        ],
      );
    } finally {
      await closeWindow('pg2');
      restoreUserSettings(saved);
    }
  });
});
