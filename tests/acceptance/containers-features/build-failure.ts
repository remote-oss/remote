/** A dialog of core's, as a window shows it: the parts of it a red's message quotes. */
export interface BuildFailedDialog {
  message: string;
  details: string;
  buttons: readonly string[];
}

/** How many of a build's last error lines a red names. */
const ERROR_LINES = 4;

/** The lines of a containers log that say what failed: a build step's error, a git or curl failure, a Feature that did not install. */
const ERROR_LINE = /\bERROR\b|\bfatal:|failed to install/;

/**
 * The last error lines of a build's log, trimmed, in order: the cause a reader of the red looks for, that the log's own
 * tail buries under the lines that follow it.
 */
export function buildErrorLines(lines: readonly string[]): string[] {
  return lines
    .filter(line => ERROR_LINE.test(line))
    .slice(-ERROR_LINES)
    .map(line => line.trim());
}

/**
 * What a red says when a window's build ended in a dialog before the window connected: the dialog's text and buttons
 * and the build's last error lines, so that the red names its cause where it was waiting out the connect's timeout.
 */
export function buildFailedText(
  window: string,
  dialog: BuildFailedDialog,
  lines: readonly string[],
): string {
  const errors = buildErrorLines(lines);
  const saying = [dialog.message, dialog.details]
    .filter(text => text !== '')
    .join(' / ');
  return [
    `window ${window}'s build ended in a dialog before it connected: ${saying === '' ? '(no text)' : saying} [${dialog.buttons.join(' | ')}]`,
    errors.length === 0
      ? 'the containers log holds no error line'
      : `the build's last error lines:\n${errors.join('\n')}`,
  ].join('\n');
}
