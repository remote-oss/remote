import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {SessionHint} from '../../src/diagnostics/hint-store.ts';
import {
  outputLogLinks,
  rowsOf,
  type TablePty,
  tablePtyOf,
  type TerminalSink,
  troubleshootingOf,
  type TroubleshootingPorts,
  type TroubleshootingTexts,
} from '../../src/diagnostics/troubleshooting.ts';
import {
  DISABLED_LINE,
  NO_HINTS_LINE,
  STEP_RULE,
  summaryLines,
} from '../../src/diagnostics/session-summary.ts';

const TEXTS: TroubleshootingTexts = {
  heading: 'The following issues were detected',
  leadIn: 'See verbose information in the',
  headers: {
    status: 'Status',
    message: 'Message',
    mitigations: 'Mitigations',
    resources: 'Resources',
  },
};

const OFFLINE: SessionHint = {
  kind: 'error',
  status: 'OfflineError',
  statusNumber: 3,
  message: 'Error: OfflineError',
  details: 'The connection timed out',
  mitigations: [],
  resources: [],
};

const ENVIRONMENT: SessionHint = {kind: 'environment', message: 'one'};

/** A check over fakes: the terminals made, what each was shown with, and the log lines. */
function scene(enabled = true) {
  const sink = new MemorySink();
  const terminals: Array<{
    driver: TablePty;
    written: string[];
    shown: boolean[];
    disposed: boolean;
  }> = [];
  const ports: TroubleshootingPorts = {
    enabled: () => enabled,
    createTerminal: make => {
      const made = {
        written: [] as string[],
        shown: [] as boolean[],
        disposed: false,
        driver: make({
          write: text => {
            made.written.push(text);
          },
        }),
      };
      terminals.push(made);
      return {
        show: preserveFocus => {
          made.shown.push(preserveFocus);
        },
        dispose: () => {
          made.disposed = true;
          made.driver.close();
        },
      };
    },
    texts: () => TEXTS,
    logger: createLogger(sink, {minimumLevel: () => 'debug'}),
  };
  const checking = troubleshootingOf(ports);
  return {
    check: (hints: readonly SessionHint[], modal: boolean): void => {
      checking.check(hints, modal);
    },
    terminals,
    logged: () => sink.lines.map(line => line.message),
  };
}

describe('the session troubleshooting terminal (card connect-136, F-2605)', () => {
  it('F-2605.AC-2: an attempt with an error hint opens a terminal, shown with the keyboard left where it is behind a dialog', () => {
    const {check, terminals} = scene();
    check([ENVIRONMENT, OFFLINE], true);
    deepStrictEqual([terminals.length, terminals[0]?.shown], [1, [true]]);
  });

  it('F-2605.AC-8: when no dialog takes the keyboard the terminal takes it', () => {
    const {check, terminals} = scene();
    check([OFFLINE], false);
    deepStrictEqual(terminals[0]?.shown, [false]);
  });

  it('F-2605.AC-26: the log gets the summary block, with each issue’s code and message, between a heading and a rule', () => {
    const {check, logged} = scene();
    check([OFFLINE], true);
    deepStrictEqual(logged(), [
      '---------- [Session Summary] ----------',
      '[OfflineError]: Error: OfflineError (The connection timed out)',
      STEP_RULE,
    ]);
  });

  it('F-2605.AC-26, F-2605.AC-12: no error hint gives the log a line that none was found, and opens no terminal (AC-10); an attempt that ends at the bound has none either', () => {
    const {check, logged, terminals} = scene();
    check([ENVIRONMENT], true);
    deepStrictEqual([logged(), terminals.length], [[NO_HINTS_LINE], 0]);
  });

  it('F-2605.AC-11, AC-26: with the setting off the log says so and no terminal opens', () => {
    const {check, logged, terminals} = scene(false);
    check([OFFLINE], true);
    deepStrictEqual([logged(), terminals.length], [[DISABLED_LINE], 0]);
  });

  it('F-2605.AC-9: a new failed attempt replaces the terminal: one terminal at a time', () => {
    const {check, terminals} = scene();
    check([OFFLINE], true);
    check([{...OFFLINE, status: 'PermissionDenied'}], true);
    deepStrictEqual(
      terminals.map(made => made.disposed),
      [true, false],
    );
  });

  it('F-2605.AC-15: closing the terminal logs one line and changes nothing else', () => {
    const {check, terminals, logged} = scene();
    check([OFFLINE], true);
    const before = logged().length;
    terminals[0]?.driver.close();
    deepStrictEqual(logged().slice(before), [
      'the troubleshooting terminal was closed',
    ]);
  });

  it('F-2605.BR-6: the rows are the error hints in the order recorded, and the details are in brackets', () => {
    deepStrictEqual(
      rowsOf([
        ENVIRONMENT,
        OFFLINE,
        {
          kind: 'error',
          status: 'Second',
          message: 'prose',
          mitigations: [],
          resources: [],
        },
      ]),
      [
        {
          status: 'OfflineError',
          message: 'Error: OfflineError (The connection timed out)',
          mitigations: [],
          resources: [],
        },
        {status: 'Second', message: 'prose', mitigations: [], resources: []},
      ],
    );
  });
});

describe('the rows of the table (card connect-136)', () => {
  it('an error hint without lists has none in its row', () => {
    deepStrictEqual(
      rowsOf([{kind: 'error', status: 'Bare', message: 'prose'}]),
      [{status: 'Bare', message: 'prose', mitigations: [], resources: []}],
    );
  });
});

describe('the pseudoterminal of the table (card connect-136)', () => {
  function makePty(rows = rowsOf([OFFLINE])): {
    made: TablePty;
    written: string[];
  } {
    const written: string[] = [];
    const sink: TerminalSink = {
      write: text => {
        written.push(text);
      },
    };
    return {made: tablePtyOf(rows, TEXTS, sink, () => undefined), written};
  }

  it('F-2605.AC-3: the terminal shows an empty line, the heading, the table and the last line, with the cursor hidden', () => {
    const {made, written} = makePty();
    made.open(60);
    const lines = (written[0] ?? '').split('\r\n');
    deepStrictEqual(
      [
        written[0]?.includes('\u001b[?25l'),
        lines[0]?.endsWith('\u001b[H\u001b[?25l'),
        lines[1],
        lines[2]?.startsWith('╔'),
        lines.at(-2),
      ],
      [
        true,
        true,
        TEXTS.heading,
        true,
        'See verbose information in the \u001b[1;4mOutput Log...\u001b[0m',
      ],
    );
  });

  it('F-2605.AC-7: input is ignored: nothing is written for typed characters or Enter', () => {
    const {made, written} = makePty();
    made.open(60);
    made.handleInput('abc');
    made.handleInput('\r');
    deepStrictEqual(written.length, 1);
  });

  it('F-2605 section 11: a new width draws the table again for it', () => {
    const {made, written} = makePty();
    made.open(60);
    made.setDimensions(100);
    const widths = written.map(
      text => text.split('\r\n').find(line => line.startsWith('╔'))?.length,
    );
    deepStrictEqual(widths, [60, 100]);
  });

  it('draws for the default width when the editor gives none', () => {
    const {made, written} = makePty();
    made.open(undefined);
    deepStrictEqual(
      written[0]?.split('\r\n').find(line => line.startsWith('╔'))?.length,
      80,
    );
  });

  it('F-2605.AC-24: the Status cell has no bold or underline: only the link is marked', () => {
    const {made, written} = makePty();
    made.open(60);
    deepStrictEqual((written[0]?.split('\u001b[1;4m').length ?? 0) - 1, 1);
  });
});

describe('the link at the end of the terminal (card connect-136, Q2)', () => {
  it('finds the Output Log... that ends the line, and nothing in another line', () => {
    deepStrictEqual(
      [
        outputLogLinks('See verbose information in the Output Log...'),
        outputLogLinks('║ OfflineError │ about the Output Log... of it ║'),
        outputLogLinks(''),
      ],
      [[{startIndex: 31, length: 13}], [], []],
    );
  });

  it('reads the link in a line that has trailing spaces', () => {
    deepStrictEqual(outputLogLinks('lead Output Log...   '), [
      {startIndex: 5, length: 13},
    ]);
  });
});

describe('the summary lines (card connect-136)', () => {
  it('has the heading, one line for each issue and the closing rule', () => {
    deepStrictEqual(
      summaryLines([
        {status: 'A', message: 'one'},
        {status: 'B', message: 'two'},
      ]),
      [
        '---------- [Session Summary] ----------',
        '[A]: one',
        '[B]: two',
        '-'.repeat(40),
      ],
    );
  });
});
