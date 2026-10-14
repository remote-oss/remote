/**
 * @fileoverview What the "Configuring..." terminal writes for one event of the CLI's `postCreate` channel: the output
 * as it came, and our `Start` and `Stop` lines in the form of the CLI's own text log.
 */

import type {CliEvent} from '../cli/cli-lines.ts';

const GREY = '\u001b[90m';
const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

/** The text with each lone `\n` turned into `\r\n`, which a pseudoterminal needs; a `\r\n` is left as it is. */
export function terminalLines(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}

/** What the terminal writes for one `postCreate` event; `runStart` is in epoch milliseconds. */
export function lifecycleTextOf(
  event: Extract<CliEvent, {kind: 'log'}>,
  runStart: number,
): string {
  const {timestamp, startTimestamp} = event;
  const sinceRun = String(timestamp === undefined ? 0 : timestamp - runStart);
  const duration = String(
    timestamp === undefined || startTimestamp === undefined
      ? 0
      : timestamp - startTimestamp,
  );
  switch (event.type) {
    case 'start':
      return `${GREY}[${sinceRun} ms] ${RESET}${GREEN}Start${RESET}: ${event.text}\r\n`;
    case 'stop':
      return `${GREY}[${sinceRun} ms] Stop (${duration} ms)${RESET}: ${event.text}\r\n`;
    default:
      return terminalLines(event.text);
  }
}
