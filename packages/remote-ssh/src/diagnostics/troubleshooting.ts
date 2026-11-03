/**
 * @fileoverview The session troubleshooting terminal: when a resolve step ends, the check over the error hints of the
 * attempt either writes the summary block to the log and opens a terminal with the table, or says in the log why it
 * does not. The terminal is a pseudoterminal that draws the table for its width and ignores input; its last line
 * links to the extension's log.
 */

import {
  hintTable,
  type HintTableHeaders,
  type HintTableRow,
  messageCellOf,
} from 'lib-ssh';
import type {Logger} from 'lib-log';
import type {SessionHint} from './hint-store.ts';
import {DISABLED_LINE, NO_HINTS_LINE, summaryLines} from './session-summary.ts';

/** The name of the terminal. */
export const TERMINAL_NAME = 'Remote - SSH: Session Troubleshooting';

/** The text of the link at the end of the terminal, which is the same in every display language. */
const OUTPUT_LOG_LINK = 'Output Log...';

/** The width a terminal is drawn for until the editor says its own. */
const DEFAULT_COLUMNS = 80;

/** Hides the cursor. */
const HIDE_CURSOR = '\u001b[?25l';

/** Clears the screen and its scroll-back, and moves to the top. */
const CLEAR = '\u001b[2J\u001b[3J\u001b[H';

/** Starts bold and underlined text, and ends it. */
const LINK_ON = '\u001b[1;4m';
const LINK_OFF = '\u001b[0m';

/** What the terminal says in words, in the display language. */
export interface TroubleshootingTexts {
  heading: string;
  /** The words before the link, which the display language translates. */
  leadIn: string;
  headers: HintTableHeaders;
}

/** The pseudoterminal's side of the editor: it writes text to the terminal. */
export interface TerminalSink {
  write(text: string): void;
}

/** The editor's pseudoterminal for the table: the editor calls these. */
export interface TablePty {
  open(columns: number | undefined): void;
  close(): void;
  handleInput(data: string): void;
  setDimensions(columns: number): void;
}

/** The pseudoterminal that draws `rows` for the width it has, and ignores all input. */
export function tablePtyOf(
  rows: readonly HintTableRow[],
  texts: TroubleshootingTexts,
  sink: TerminalSink,
  onClose: () => void,
): TablePty {
  let columns = DEFAULT_COLUMNS;
  function draw(): void {
    const lines = [
      '',
      texts.heading,
      ...hintTable(rows, columns, texts.headers),
      `${texts.leadIn} ${LINK_ON}${OUTPUT_LOG_LINK}${LINK_OFF}`,
    ];
    sink.write(`${CLEAR}${HIDE_CURSOR}${lines.join('\r\n')}\r\n`);
  }
  return {
    open: initial => {
      columns = initial ?? DEFAULT_COLUMNS;
      draw();
    },
    close: onClose,
    handleInput: () => undefined,
    setDimensions: next => {
      columns = next;
      draw();
    },
  };
}

/** The links in `line` of the troubleshooting terminal: the "Output Log..." at its end. */
export function outputLogLinks(
  line: string,
): Array<{startIndex: number; length: number}> {
  const startIndex = line.lastIndexOf(OUTPUT_LOG_LINK);
  return startIndex === -1 || !line.trimEnd().endsWith(OUTPUT_LOG_LINK)
    ? []
    : [{startIndex, length: OUTPUT_LOG_LINK.length}];
}

/** A terminal the editor made. */
interface TroubleshootingTerminal {
  /** Shows the terminal in the panel; `preserveFocus` leaves the keyboard where it is. */
  show(preserveFocus: boolean): void;
  dispose(): void;
}

/** What the check needs from the editor and the extension. */
export interface TroubleshootingPorts {
  /** `remote.SSH.experimental.enhancedSessionLogs` as the settings say now. */
  enabled(): boolean;
  /** Makes a terminal named `TERMINAL_NAME` over the pseudoterminal that `make` builds on the terminal's sink. */
  createTerminal(
    make: (sink: TerminalSink) => TablePty,
  ): TroubleshootingTerminal;
  texts(): TroubleshootingTexts;
  logger: Logger;
}

/** The check over an attempt's error hints, and the one terminal it keeps. */
export interface Troubleshooting {
  /** Runs the check once for an attempt whose resolve step has ended. `modal` says a dialog will take the keyboard. */
  check(hints: readonly SessionHint[], modal: boolean): void;
}

/** The rows of the table for the error hints among `hints`, in the order they were recorded. */
export function rowsOf(hints: readonly SessionHint[]): HintTableRow[] {
  return hints.flatMap(hint =>
    hint.kind === 'error'
      ? [
          {
            status: hint.status,
            message: messageCellOf(hint.message, hint.details),
            mitigations: hint.mitigations ?? [],
            resources: hint.resources ?? [],
          },
        ]
      : [],
  );
}

/** The check over `ports`. */
export function troubleshootingOf(
  ports: TroubleshootingPorts,
): Troubleshooting {
  const {logger} = ports;
  let current: TroubleshootingTerminal | undefined;
  return {
    check: (hints, modal) => {
      const rows = rowsOf(hints);
      if (!ports.enabled()) {
        logger.info(DISABLED_LINE);
        return;
      }
      if (rows.length === 0) {
        logger.info(NO_HINTS_LINE);
        return;
      }
      summaryLines(rows).forEach(line => {
        logger.info(line);
      });
      current?.dispose();
      current = ports.createTerminal(sink =>
        tablePtyOf(rows, ports.texts(), sink, () => {
          logger.info('the troubleshooting terminal was closed');
        }),
      );
      current.show(modal);
    },
  };
}
