/**
 * @fileoverview The "Configuring..." terminal and the progress entry of the lifecycle commands: what C7 hands the
 * presenter becomes terminal text, which opens on the first output and waits for a key once the run has ended, and
 * the progress entry shows from the background's first output. Each run has its own terminal and state.
 */

import type {CliEvent} from '../cli/cli-lines.ts';
import type {LifecyclePresenter} from '../lifecycle/container-lifecycle.ts';
import {lifecycleTextOf} from '../lifecycle/lifecycle-text.ts';
import type {Translate} from './engine-dialogs.ts';

/** The English templates of the lifecycle commands' surfaces. */
const LIFECYCLE_TEMPLATES = {
  S086: 'Configuring...',
  S085: 'Configuring Dev Container (show log)',
  S153: 'Done. Press any key to close the terminal.',
} as const;

const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

/** A terminal the editor shows. */
interface OpenTerminal {
  write(text: string): void;
  close(): void;
}

/** What the presenter needs of the editor's terminals. */
export interface TerminalPort {
  /** Creates and shows the terminal named `name`, focused; `onInput` gets each key; `onClosed` fires when the user closes it. */
  open(
    name: string,
    onInput: (data: string) => void,
    onClosed: () => void,
  ): OpenTerminal;
}

/** What the presenter needs of the editor's window progress. */
export interface StatusProgressPort {
  /** Shows `title` as window progress until the returned function is called. */
  show(title: string): () => void;
}

/** One run's terminal, its waiting text, and what the run has reached. */
interface Run {
  open: OpenTerminal | undefined;
  waiting: string[];
  closedByUser: boolean;
  background: boolean;
  hideProgress: (() => void) | undefined;
  finished: boolean;
  /** The writer for the run's CLI stdin, when the run has one; a key typed in the run's terminal goes to it. */
  stdin: ((data: string) => void) | undefined;
  /** The line the run's terminal is typing; Enter ends it and hands it, with its CR, to the run's stdin. */
  line: string;
}

function newRun(): Run {
  return {
    open: undefined,
    waiting: [],
    closedByUser: false,
    background: false,
    hideProgress: undefined,
    finished: false,
    stdin: undefined,
    line: '',
  };
}

/** The presenter of the lifecycle commands over a terminal and window progress. */
export function lifecyclePresenterOf(
  terminal: TerminalPort,
  progress: StatusProgressPort,
  translate: Translate,
): LifecyclePresenter {
  let latest = newRun();

  /** The run now, or a new one once the last has ended. */
  function current(): Run {
    if (latest.finished) {
      latest = newRun();
    }
    return latest;
  }

  function opened(own: Run): OpenTerminal {
    own.open ??= terminal.open(
      translate(LIFECYCLE_TEMPLATES.S086),
      data => {
        if (own.finished) {
          own.open?.close();
          own.open = undefined;
          return;
        }
        // A key of the run. The CLI's child reads its input from a pipe that neither echoes nor edits, so the
        // terminal takes the TTY driver's line jobs: it echoes the printable keys, it edits the run's line on
        // backspace, and it hands the child the line as a whole when Enter ends it.
        let afterEscape = false;
        let inSequence = false;
        for (const character of data) {
          const code = character.codePointAt(0);
          if (code === undefined) {
            continue;
          }
          if (afterEscape) {
            // The byte after an ESC opens a key sequence: its bytes go to the sequence's final byte.
            afterEscape = false;
            inSequence = true;
            continue;
          }
          if (inSequence) {
            // The rest of a key sequence, to its final byte.
            if (code >= 0x40 && code <= 0x7e) {
              inSequence = false;
            }
            continue;
          }
          if (code === 0x1b) {
            // The start of a key sequence (the delete and the arrow keys): not the child's line input.
            afterEscape = true;
            continue;
          }
          if (code === 0x0d || code === 0x0a) {
            own.open?.write('\r\n');
            own.stdin?.(`${own.line}\r`);
            own.line = '';
            continue;
          }
          if (code === 0x7f || code === 0x08) {
            // Backspace: the last character of the line comes off it, and its echo goes with it.
            if (own.line.length > 0) {
              own.line = own.line.slice(0, -1);
              own.open?.write('\u0008 \u0008');
            }
            continue;
          }
          if (code >= 0x20) {
            own.open?.write(character);
            own.line += character;
            continue;
          }
          // A control key of its own (a Ctrl+C of the run) reaches the child raw, as a pipe has no line discipline.
          own.stdin?.(character);
        }
      },
      () => {
        own.open = undefined;
        own.closedByUser = true;
      },
    );
    return own.open;
  }

  function output(
    event: Extract<CliEvent, {kind: 'log'}>,
    runStart: number,
  ): void {
    const own = current();
    if (own.background && own.hideProgress === undefined) {
      own.hideProgress = progress.show(translate(LIFECYCLE_TEMPLATES.S085));
    }
    const text = lifecycleTextOf(event, runStart);
    if (own.closedByUser) {
      return;
    }
    if (
      own.open === undefined &&
      event.type !== 'raw' &&
      event.type !== 'start'
    ) {
      own.waiting.push(text);
      return;
    }
    opened(own).write(own.waiting.splice(0).join('') + text);
  }

  return {
    output,
    backgroundStarted: () => {
      current().background = true;
    },
    ended: () => {
      const own = current();
      own.finished = true;
      own.hideProgress?.();
      own.hideProgress = undefined;
      own.open?.write(
        `\r\n${BOLD}${translate(LIFECYCLE_TEMPLATES.S153)}${RESET}`,
      );
    },
    attachStdin: write => {
      current().stdin = write;
    },
  };
}
