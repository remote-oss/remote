/**
 * @fileoverview The "Dev Containers" log terminal: it replays the activation's log file from its start, each line with
 * the time since the activation began in front of it, and then streams the lines written after.
 */

/** What the terminal needs of the activation's log file. */
export interface LogTerminalSource {
  /** How many bytes the file holds once everything written so far has been appended. */
  bytes(): number;
  /** Resolves when everything written so far has been appended. */
  flushed(): Promise<void>;
  /** Calls `listener` for every line written after this; the result stops it. */
  subscribe(listener: (text: string) => void): () => void;
  /** The file's bytes. */
  read(): Promise<Uint8Array>;
}

/** The terminal's end: `open` starts the replay and the stream, `close` stops them. */
export interface LogTerminal {
  open(): void;
  close(): void;
}

/** A line of the file that begins with its ISO-8601 time. */
const TIMED_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z) (.*)$/s;

/** The seconds between two times as `1234.567s`, never less than 0. */
function secondsBetween(start: number, time: number): string {
  return `${(Math.max(0, time - start) / 1000).toFixed(3)}s`;
}

/** The line with the time since `start` (milliseconds) in place of its ISO time; a line with no time is left as it is. */
export function elapsedLineOf(line: string, start: number): string {
  const match = TIMED_LINE.exec(line);
  const time = match?.[1] === undefined ? Number.NaN : Date.parse(match[1]);
  return match?.[2] === undefined || Number.isNaN(time)
    ? line
    : `[+${secondsBetween(start, time)}] ${match[2]}`;
}

/** The terminal over `source` that writes its text through `write`; `start` is the activation's start in milliseconds. */
export function logTerminalOf(
  source: LogTerminalSource,
  write: (text: string) => void,
  start: number,
): LogTerminal {
  let stop: (() => void) | undefined;
  function show(line: string): void {
    write(`${elapsedLineOf(line, start)}\r\n`);
  }
  return {
    open: () => {
      const size = source.bytes();
      let replayed = false;
      const pending: string[] = [];
      stop = source.subscribe(text => {
        if (replayed) {
          show(text);
        } else {
          pending.push(text);
        }
      });
      const listening = stop;
      /** Writes the replay and then the lines that came meanwhile, unless the terminal was closed first. */
      function finish(replay: string[]): void {
        if (stop !== listening) {
          return;
        }
        replay.forEach(show);
        pending.splice(0).forEach(show);
        replayed = true;
      }
      void source
        .flushed()
        .then(() => source.read())
        .then(
          bytes => {
            finish(
              new TextDecoder()
                .decode(bytes.subarray(0, size))
                .split('\n')
                .slice(0, -1),
            );
          },
          () => {
            finish([]);
          },
        );
    },
    close: () => {
      stop?.();
      stop = undefined;
    },
  };
}
