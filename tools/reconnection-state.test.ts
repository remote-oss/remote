import {deepStrictEqual} from 'node:assert';
import {
  earlierFailureLines,
  logLinesBetween,
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
    timeline: () => [
      '[+0.00 s] dialog none; notifications []',
      '[+4.25 s] dialog "Cannot reconnect"; notifications []',
    ],
    probeDialog: () =>
      Promise.resolve(
        'showed at once: "Do you want to clear the recent list?"',
      ),
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
        'the dialog and notifications of the window, every change between reads taken every 250 ms:',
        '[+0.00 s] dialog none; notifications []',
        '[+4.25 s] dialog "Cannot reconnect"; notifications []',
        'the window’s renderer log from the end to 30 s after it, every line:',
        '',
        'the last lines of the connection log since then:',
        'kept',
        'the window’s renderer log before the end: every line about a reconnection given up, with its time from the end:',
        'none (the log holds no stamped line before the end)',
        'a second dialog asked of the window by its palette, File: Clear Recently Opened (it shows when the dialog queue is free):',
        'showed at once: "Do you want to clear the recent list?"',
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
        timeline: () => {
          throw new Error('no timeline');
        },
        probeDialog: () => Promise.reject(new Error('no palette')),
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
      'the dialog and notifications of the window, every change between reads taken every 250 ms:',
      '(unreadable: Error: no timeline)',
      'the window’s renderer log from the end to 30 s after it, every line:',
      '(unreadable: Error: no renderer log)',
      'the last lines of the connection log since then:',
      '(unreadable: Error: no log file)',
      'the window’s renderer log before the end: every line about a reconnection given up, with its time from the end:',
      '(unreadable: Error: no renderer log)',
      'a second dialog asked of the window by its palette, File: Clear Recently Opened (it shows when the dialog queue is free):',
      '(unreadable: Error: no palette)',
    ]);
  });

  it('#2753: a probe of the second dialog that does not answer is told after its bound, and the explanation still ends', async () => {
    const text = await reconnectionState(
      reads({probeDialog: () => new Promise<string>(() => undefined)}),
      'win',
      1,
      1000,
      50,
    );
    deepStrictEqual(text.split('\n').slice(-2), [
      'a second dialog asked of the window by its palette, File: Clear Recently Opened (it shows when the dialog queue is free):',
      '(no answer in 0.05 s)',
    ]);
  });

  it('#2753: the lines about a reconnection given up before the end are told with their time from it, and a failure after the end is not among them', () => {
    const ended = Date.parse('2026-11-19T07:00:10Z');
    deepStrictEqual(
      earlierFailureLines(
        [
          '2026-11-19 07:00:00.500 [info] a line about nothing',
          '2026-11-19 07:00:04.000 [error] [remote-connection][Management][x][reconnect] A RemoteAuthorityResolverError occurred while trying to reconnect. Will give up now! Error:',
          '    at stack frame without a stamp',
          '2026-11-19 07:00:06.250 [info] Error handled: Not showing a notification for the error.',
          '2026-11-19 07:00:11.000 [error] [ExtensionHost][y][reconnect] permanent failure occurred while running the reconnecting loop.',
        ],
        ended,
        60,
      ),
      [
        '[-6.0 s] 2026-11-19 07:00:04.000 [error] [remote-connection][Manageme',
        '[-3.8 s] 2026-11-19 07:00:06.250 [info] Error handled: Not showing a ',
      ],
    );
  });

  it('#2753: a log with stamped lines before the end and none about a failure says how many it held and from when, and a log with none says so', () => {
    const ended = Date.parse('2026-11-19T07:00:10Z');
    deepStrictEqual(
      [
        earlierFailureLines(
          [
            '2026-11-19 07:00:00.500 [info] a line about nothing',
            '2026-11-19 07:00:02.000 [info] another',
            '2026-11-19 07:00:11.000 [error] permanent failure occurred',
          ],
          ended,
          60,
        ),
        earlierFailureLines(['    at a frame', 'no stamp here'], ended, 60),
      ],
      [
        [
          'none (the log holds 2 stamped lines before the end, the first -9.5 s from it)',
        ],
        ['none (the log holds no stamped line before the end)'],
      ],
    );
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

describe('the renderer log of the 30 s after the end, unfiltered (card #2753)', () => {
  const LINES = [
    '2026-11-19 07:00:00.000 [info] before the end',
    '2026-11-19 07:00:01.500 [info] after the end',
    'continued: an unstamped line after a kept one',
    '2026-11-19 07:00:31.500 [info] past 30 s',
    'continued: an unstamped line after a dropped one',
    'no stamp at all, after a dropped one',
  ];
  const ENDED_AT = Date.parse('2026-11-19T07:00:01Z');

  it('#2753: the stamped lines between the end and 30 s after it, with the unstamped lines of a stack left out', () => {
    deepStrictEqual(
      logLinesBetween(LINES, ENDED_AT, ENDED_AT + 30_000, 80, 240),
      ['2026-11-19 07:00:01.500 [info] after the end'],
    );
  });

  it('#2753: the first lines of the cap, each cut at the width', () => {
    deepStrictEqual(
      logLinesBetween(
        ['2026-11-19 07:00:01.100 [info] first', ...LINES],
        ENDED_AT,
        ENDED_AT + 30_000,
        1,
        23,
      ),
      ['2026-11-19 07:00:01.100'],
    );
  });
});

describe('what a pass prints and what only a failure explains (card #2753)', () => {
  const TIMELINE_TITLE = 'the dialog and notifications of the window';
  const UNFILTERED_TITLE =
    'the window’s renderer log from the end to 30 s after it';

  it('#2753: the glance that a passing row prints has neither the timeline nor the unfiltered renderer log, and the failure’s explanation has both', async () => {
    const sample = reads();
    const glance = await reconnectionGlance(sample, 1000);
    const explanation = await reconnectionState(sample, 'win', 0, 1000);
    deepStrictEqual(
      [
        glance.includes(TIMELINE_TITLE),
        glance.includes(UNFILTERED_TITLE),
        explanation.includes(TIMELINE_TITLE),
        explanation.includes(UNFILTERED_TITLE),
      ],
      [false, false, true, true],
    );
  });

  it('#2753: the unfiltered renderer log of the explanation is bounded to 80 lines of 240 characters, whatever the log holds', async () => {
    const text = await reconnectionState(
      reads({
        rendererLines: () =>
          Array.from(
            {length: 120},
            (value, index) =>
              `2026-11-19 07:00:${String(1 + (index % 25)).padStart(2, '0')}.000 [info] ${'x'.repeat(400)}`,
          ),
      }),
      'win',
      0,
      Date.parse('2026-11-19T07:00:00Z'),
    );
    const section = text
      .split(
        'the window’s renderer log from the end to 30 s after it, every line:\n',
      )[1]
      ?.split('\nthe last lines of the connection log')[0]
      ?.split('\n');
    deepStrictEqual(
      [section?.length, section?.every(line => line.length <= 240)],
      [80, true],
    );
  });
});
