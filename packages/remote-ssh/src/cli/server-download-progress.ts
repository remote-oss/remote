/**
 * @fileoverview The notification of the server download the CLI makes after the window resolved: shown at the first
 * line of the download, with the percentage the CLI reports, held at 100 while the server is unpacked and started, and
 * closed when the `serve` that made it ends.
 */

import {s045EventOf} from 'lib-server';

/** One notification with a percentage, as the editor shows it. */
interface DownloadNotification {
  /** Sets the percentage shown, 0 to 100. */
  report(percent: number): void;
  close(): void;
}

/** The editor's notifications with a percentage. */
export interface DownloadProgressPort {
  show(title: string): DownloadNotification;
}

/** The driver of one `serve`'s notification. */
export interface ServerDownloadProgress {
  /** Reads one line the CLI logged. */
  onLine(line: {text: string; level: number}): void;
  /** The `serve` ended, however it ended. */
  end(): void;
}

/** A driver that shows `title` through `port` when the CLI starts a download, and only then. */
export function serverDownloadProgress(
  port: DownloadProgressPort,
  title: string,
): ServerDownloadProgress {
  let shown: DownloadNotification | undefined;
  let ended = false;
  return {
    onLine: line => {
      if (ended) {
        return;
      }
      const event = s045EventOf(line);
      if (event?.kind === 'show') {
        shown ??= port.show(title);
      } else if (event?.kind === 'percent') {
        shown?.report(event.value);
      }
    },
    end: () => {
      ended = true;
      shown?.close();
      shown = undefined;
    },
  };
}
