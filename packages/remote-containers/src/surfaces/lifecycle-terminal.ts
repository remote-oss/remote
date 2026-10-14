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
}

function newRun(): Run {
  return {
    open: undefined,
    waiting: [],
    closedByUser: false,
    background: false,
    hideProgress: undefined,
    finished: false,
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
      () => {
        if (own.finished) {
          own.open?.close();
          own.open = undefined;
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
  };
}
