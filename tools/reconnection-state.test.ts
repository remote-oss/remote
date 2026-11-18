import {deepStrictEqual} from 'node:assert';
import {
  reconnectionState,
  type StateReads,
} from '../tests/acceptance/windows/reconnection-state.ts';

/** Reads that answer as a window that is stuck on its third wrong password does, each of which a test may replace. */
function reads(replaced: Partial<StateReads> = {}): StateReads {
  return {
    recorded: () => [
      {time: 500, surface: 'maskedInput', question: 'before', answer: 'x'},
      {
        time: 1500,
        surface: 'maskedInput',
        question: 'Enter password',
        answer: 'y',
      },
    ],
    indicator: () => Promise.resolve('Reconnecting to SSH: password-retry...'),
    dialog: () => Promise.resolve(undefined),
    notifications: () => Promise.resolve(['Setting up SSH Host']),
    logLines: () => ['skipped', 'Searched for ssh in: /usr/bin', 'kept'],
    ...replaced,
  };
}

describe('the state a window showed when its wait for core’s dialog timed out (card #2753)', () => {
  it('#2753: the lines recorded after the end with their times, the indicator, the dialog, the notifications and the log after the mark', async () => {
    deepStrictEqual(
      await reconnectionState(reads(), 'win', 1, 1000),
      [
        'what win recorded since the shared connection ended:',
        '[+0.5 s] maskedInput: Enter password (y)',
        'the indicator:',
        'Reconnecting to SSH: password-retry...',
        'the dialog now:',
        'none',
        'the notifications now:',
        '["Setting up SSH Host"]',
        'the last lines of the connection log since then:',
        'kept',
      ].join('\n'),
    );
  });

  it('#2753: a dialog that is shown is told with its message and details', async () => {
    const text = await reconnectionState(
      reads({
        dialog: () =>
          Promise.resolve({message: 'Cannot reconnect', details: 'Reload'}),
      }),
      'win',
      0,
      0,
    );
    deepStrictEqual(
      text.includes('the dialog now:\nCannot reconnect / Reload'),
      true,
    );
  });

  it('#2753: a read that throws is told as unreadable in its place, and the others are still read', async () => {
    const text = await reconnectionState(
      reads({
        recorded: () => {
          throw new Error('no record file');
        },
        indicator: () => Promise.reject(new Error('window closed')),
        dialog: () => Promise.reject(new Error('window closed')),
        notifications: () => Promise.reject(new Error('window closed')),
        logLines: () => {
          throw new Error('no log file');
        },
      }),
      'win',
      0,
      0,
    );
    deepStrictEqual(text.split('\n'), [
      'what win recorded since the shared connection ended:',
      '(unreadable: Error: no record file)',
      'the indicator:',
      '(unreadable: Error: window closed)',
      'the dialog now:',
      '(unreadable: Error: window closed)',
      'the notifications now:',
      '(unreadable: Error: window closed)',
      'the last lines of the connection log since then:',
      '(unreadable: Error: no log file)',
    ]);
  });
});
