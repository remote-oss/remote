import {deepStrictEqual} from 'node:assert';
import type {AgentEvent, RecordLine} from './harness.ts';
import {completeLines, reloadReadout, withLogTail} from './harness.ts';
import type {ShownDialog} from './renderer.ts';

describe('withLogTail', () => {
  it('tooling-90: a message with no log lines is the message', () => {
    deepStrictEqual(withLogTail('timed out', []), 'timed out');
  });

  it('tooling-90: a message with few lines carries them all after a line break', () => {
    deepStrictEqual(
      withLogTail('timed out', ['one', 'two']),
      'timed out\none\ntwo',
    );
  });

  it('tooling-90: a message with more than forty lines carries the last forty', () => {
    const lines = [...Array(45).keys()].map(
      position => `line ${String(position)}`,
    );
    const carried = withLogTail('timed out', lines).split('\n');
    deepStrictEqual(
      [carried.length, carried[1], carried.at(-1)],
      [41, 'line 5', 'line 44'],
    );
  });
  describe('a Feature that failed to install (card #2675)', () => {
    const failure =
      '#14 64.95 ERROR: Feature "Java (via SDKMAN!)" (ghcr.io/devcontainers/features/java) failed to install!';
    const later = [...Array(45).keys()].map(
      position => `later ${String(position)}`,
    );

    it('#2675: a failure older than the last forty lines goes before them with the three lines that said why', () => {
      const lines = [
        'earlier',
        '#14 64.76 Downloading: maven 3.10.0',
        '#14 64.95 Stop! The archive was corrupt and has been removed!',
        '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
        failure,
        ...later,
      ];
      const carried = withLogTail('timed out', lines).split('\n');
      deepStrictEqual(
        [carried.slice(0, 6), carried.length, carried.at(-1)],
        [
          [
            'timed out',
            'the Feature that failed to install:',
            '#14 64.76 Downloading: maven 3.10.0',
            '#14 64.95 Stop! The archive was corrupt and has been removed!',
            '#14 64.95 (!) Installing maven  via SDKMAN failed after 5 attempts.',
            failure,
          ],
          // the message, the heading and four lines, the heading of the tail and its forty lines
          1 + 1 + 4 + 1 + 40,
          'later 44',
        ],
      );
    });

    it('#2675: a failure near the start carries the lines there are before it', () => {
      const carried = withLogTail('timed out', [
        'first',
        failure,
        ...later,
      ]).split('\n');
      deepStrictEqual(carried.slice(1, 4), [
        'the Feature that failed to install:',
        'first',
        failure,
      ]);
    });

    it('#2675: a failure within the first lines of the last forty carries the lines before it that the tail lacks', () => {
      const lines = [
        'before 0',
        'before 1',
        'why one',
        'why two',
        'why three',
        failure,
        ...[...Array(38).keys()].map(position => `after ${String(position)}`),
      ];
      const carried = withLogTail('timed out', lines).split('\n');
      deepStrictEqual(carried.slice(0, 7), [
        'timed out',
        'the Feature that failed to install:',
        'why one',
        'why two',
        'why three',
        failure,
        'the last 40 lines:',
      ]);
    });

    it('#2675: a failure inside the last forty lines is not carried twice', () => {
      const lines = ['before', failure, 'after'];
      deepStrictEqual(
        withLogTail('timed out', lines),
        `timed out\nbefore\n${failure}\nafter`,
      );
    });
  });
});

describe('completeLines (card #2650)', () => {
  it('#2650: the lines a newline has ended are read, and a last line still being written is left out', () => {
    deepStrictEqual(
      [
        completeLines('{"event":"state"}\n{"event":"rep'),
        completeLines('{"event":"state"}\n{"event":"report"}\n'),
        completeLines('{"event":"sta'),
        completeLines(''),
      ],
      [[{event: 'state'}], [{event: 'state'}, {event: 'report'}], [], []],
    );
  });
});

describe('reloadReadout (card #2803)', () => {
  const windowName = 'volume-user';
  const message = `timed out waiting for window ${windowName} to activate again after remote-containers.reopenInContainer`;

  function questionLine(
    surface: string,
    question: string,
    buttons?: string[],
  ): RecordLine {
    return {
      surface,
      question,
      answer: '',
      matched: false,
      window: windowName,
      time: 0,
      ...(buttons === undefined ? {} : {buttons}),
    };
  }

  function displayLine(question: string): RecordLine {
    return {
      surface: 'progress',
      question,
      answer: '',
      matched: false,
      window: windowName,
      time: 0,
    };
  }

  function commandEvent(
    event: AgentEvent['event'],
    commandMessage?: string,
  ): AgentEvent {
    return {
      event,
      time: 0,
      id: 'cmd',
      ...(commandMessage === undefined ? {} : {message: commandMessage}),
    };
  }

  it('#2803: a readout whose window and reload show nothing carries the wait alone', () => {
    deepStrictEqual(
      reloadReadout(message, [], undefined, [], [], []),
      [
        message,
        "the window's dialog: none",
        "the window's toasts: none",
        "the window's question lines: none",
        "the command's state: never accepted",
      ].join('\n'),
    );
  });

  it('#2803: the last lines of the Dev Containers log go after the wait, as withLogTail carries them', () => {
    deepStrictEqual(
      reloadReadout(message, ['building', 'starting'], undefined, [], [], []),
      [
        message,
        'building',
        'starting',
        "the window's dialog: none",
        "the window's toasts: none",
        "the window's question lines: none",
        "the command's state: never accepted",
      ].join('\n'),
    );
  });

  it(`#2803: a dialog and toasts the page still shows are named, with the dialog's buttons`, () => {
    const dialog: ShownDialog = {
      message: 'The container failed to start',
      details: 'its detail text',
      buttons: ['Retry', 'Close'],
    };
    deepStrictEqual(
      reloadReadout(
        message,
        [],
        dialog,
        ['Could not reopen in container'],
        [],
        [],
      ),
      [
        message,
        "the window's dialog: The container failed to start (buttons: Retry, Close)",
        `the window's toasts: ["Could not reopen in container"]`,
        "the window's question lines: none",
        "the command's state: never accepted",
      ].join('\n'),
    );
  });

  it('#2803: a dialog without buttons carries no button line', () => {
    const dialog: ShownDialog = {message: 'Reloaded', details: '', buttons: []};
    deepStrictEqual(
      reloadReadout(message, [], dialog, [], [], [commandEvent('accepted')]),
      [
        message,
        "the window's dialog: Reloaded",
        "the window's toasts: none",
        "the window's question lines: none",
        "the command's state: accepted",
      ].join('\n'),
    );
  });

  it('#2803: the question lines the record holds are listed, its display lines not', () => {
    deepStrictEqual(
      reloadReadout(
        message,
        [],
        undefined,
        [],
        [
          questionLine('failureDialog', 'The container failed to start', [
            'Close',
          ]),
          questionLine('maskedInput', 'Password'),
          displayLine('building the container'),
        ],
        [],
      ),
      [
        message,
        "the window's dialog: none",
        "the window's toasts: none",
        "the window's question lines:",
        '  failureDialog: The container failed to start (buttons: Close)',
        '  maskedInput: Password',
        "the command's state: never accepted",
      ].join('\n'),
    );
  });

  it('#2803: the state of the command the window answered with, event by event', () => {
    deepStrictEqual(
      reloadReadout(
        message,
        [],
        undefined,
        [],
        [],
        [
          commandEvent('accepted'),
          commandEvent('failed', 'the container start failed'),
        ],
      ),
      [
        message,
        "the window's dialog: none",
        "the window's toasts: none",
        "the window's question lines: none",
        "the command's state: accepted; failed: the container start failed",
      ].join('\n'),
    );
  });

  it('#2803: a page it cannot read reads as unreadable, in both parts', () => {
    deepStrictEqual(
      reloadReadout(message, [], 'unreadable', 'unreadable', [], []),
      [
        message,
        "the window's dialog: unreadable",
        "the window's toasts: unreadable",
        "the window's question lines: none",
        "the command's state: never accepted",
      ].join('\n'),
    );
  });
});
