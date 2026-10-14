/**
 * @fileoverview The "Configuring..." terminal and the progress entry of the lifecycle commands: what C7 hands the
 * presenter becomes terminal text, which opens on the first output and waits for a key once the run has ended.
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

/** The presenter of the lifecycle commands over a terminal and window progress. */
export function lifecyclePresenterOf(
  terminal: TerminalPort,
  progress: StatusProgressPort,
  translate: Translate,
): LifecyclePresenter {
  let open: OpenTerminal | undefined;
  let closedByUser = false;
  let finished = false;
  let hideProgress: (() => void) | undefined;
  const waiting: string[] = [];

  function opened(): OpenTerminal {
    open ??= terminal.open(
      translate(LIFECYCLE_TEMPLATES.S086),
      () => {
        if (finished) {
          open?.close();
          open = undefined;
        }
      },
      () => {
        open = undefined;
        closedByUser = true;
      },
    );
    return open;
  }

  function output(
    event: Extract<CliEvent, {kind: 'log'}>,
    runStart: number,
  ): void {
    const text = lifecycleTextOf(event, runStart);
    if (closedByUser) {
      return;
    }
    if (open === undefined && event.type !== 'raw' && event.type !== 'start') {
      waiting.push(text);
      return;
    }
    const shown = opened();
    shown.write(waiting.splice(0).join('') + text);
  }

  return {
    output,
    backgroundStarted: () => {
      hideProgress = progress.show(translate(LIFECYCLE_TEMPLATES.S085));
    },
    ended: () => {
      finished = true;
      hideProgress?.();
      hideProgress = undefined;
      open?.write(`\r\n${BOLD}${translate(LIFECYCLE_TEMPLATES.S153)}${RESET}`);
    },
  };
}
