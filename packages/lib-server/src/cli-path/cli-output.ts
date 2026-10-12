/**
 * @fileoverview The failures the editor's command-line program reports when it serves: told apart loosely by the
 * fragments of its message that are stable, with the whole message kept when none is recognised.
 */

/** What went wrong, as far as the message tells. */
export type CliServeError =
  | {kind: 'download'; url: string; status: number}
  | {kind: 'template'; message: string}
  | {kind: 'commitMismatch'; message: string}
  | {kind: 'other'; message: string};

const URL_PATTERN = /url: "([^"]*)"/;
const STATUS_PATTERN = /status_code: (\d+)/;

/** Classifies a message of the command-line program; a download failure needs both its address and its status. */
export function parseCliServeError(message: string): CliServeError {
  const url = URL_PATTERN.exec(message)?.[1];
  const status = STATUS_PATTERN.exec(message)?.[1];
  if (url !== undefined && status !== undefined) {
    return {kind: 'download', url, status: Number(status)};
  }
  if (message.includes('cannot expand ')) {
    return {kind: 'template', message};
  }
  if (message.includes('the download is not commit')) {
    return {kind: 'commitMismatch', message};
  }
  return {kind: 'other', message};
}
