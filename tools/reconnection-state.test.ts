import {deepStrictEqual} from 'node:assert';
import {
  reconnectionGlance,
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
    pageFacts: () => Promise.resolve(['[win]: {"visibility":"visible"}']),
    pageRead: () => 'the read began 10 ms after the end was noted, took 5 ms',
    agentLife: () => [
      {event: 'activated', time: 200},
      {event: 'activated', time: 4000},
    ],
    rendererLines: () => [
      '2026-11-19 07:00:00.000 [info] a line about nothing',
      '2026-11-19 07:00:01.000 [info] Error handled: Not showing a notification for the error.',
    ],
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
        'the read of the window’s page before the outage:',
        'the read began 10 ms after the end was noted, took 5 ms',
        'the pages now (focus, visibility, quick input):',
        '[win]: {"visibility":"visible"}',
        'the window’s agent, activated or deactivated (time from the end):',
        '[-0.8 s] activated',
        '[+3.0 s] activated',
        'the lines of the window’s renderer log about the reconnection:',
        '2026-11-19 07:00:01.000 [info] Error handled: Not showing a notification for the error.',
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
        pageFacts: () => Promise.reject(new Error('page gone')),
        pageRead: () => {
          throw new Error('no read');
        },
        agentLife: () => {
          throw new Error('no events');
        },
        rendererLines: () => {
          throw new Error('no renderer log');
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
      'the read of the window’s page before the outage:',
      '(unreadable: Error: no read)',
      'the pages now (focus, visibility, quick input):',
      '(unreadable: Error: page gone)',
      'the window’s agent, activated or deactivated (time from the end):',
      '(unreadable: Error: no events)',
      'the lines of the window’s renderer log about the reconnection:',
      '(unreadable: Error: no renderer log)',
      'the last lines of the connection log since then:',
      '(unreadable: Error: no log file)',
    ]);
  });

  it('#2753: the glance keeps the last six activations and the last ten matching renderer lines, each cut at 240 characters', async () => {
    const text = await reconnectionGlance(
      reads({
        agentLife: () =>
          Array.from({length: 8}, (value, index) => ({
            event: index % 2 === 0 ? 'activated' : 'deactivated',
            time: index * 1000,
          })),
        rendererLines: () => [
          ...Array.from(
            {length: 12},
            (value, index) => `reconnect ${String(index)}`,
          ),
          `reconnect ${'x'.repeat(300)}`,
        ],
      }),
      0,
    );
    const lines = text.split('\n');
    deepStrictEqual(
      [
        lines.slice(5, 11),
        lines.slice(12).length,
        lines.at(-1)?.length,
        lines.includes('reconnect 2'),
        lines.includes('reconnect 3'),
      ],
      [
        [
          '[+2.0 s] activated',
          '[+3.0 s] deactivated',
          '[+4.0 s] activated',
          '[+5.0 s] deactivated',
          '[+6.0 s] activated',
          '[+7.0 s] deactivated',
        ],
        10,
        240,
        false,
        true,
      ],
    );
  });

  it('#2753: a page that never answers is told after the limit as no answer, and the other sections are still read', async () => {
    const text = await reconnectionGlance(
      reads({pageFacts: () => new Promise<string[]>(() => undefined)}),
      0,
      20,
    );
    deepStrictEqual(
      [
        text.includes(
          'the pages now (focus, visibility, quick input):\n(no answer in 0.02 s)\n',
        ),
        text.includes('[+0.2 s] activated'),
      ],
      [true, true],
    );
  });

  it('#2753: a page that fails after the limit is no failure of the glance', async () => {
    const text = await reconnectionGlance(
      reads({
        pageFacts: () =>
          new Promise<string[]>((resolve, reject) => {
            setTimeout(() => {
              reject(new Error('page gone'));
            }, 40);
          }),
      }),
      0,
      10,
    );
    await new Promise(resolve => setTimeout(resolve, 60));
    deepStrictEqual(text.includes('(no answer in 0.01 s)'), true);
  });
});
