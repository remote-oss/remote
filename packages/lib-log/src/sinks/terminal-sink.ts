import type {LogLine, Sink} from '../logger.ts';
import type {EditorLogPort} from './editor-port.ts';
import {defaultFormat} from './channel-sink.ts';

/**
 * A sink that streams its formatted lines, each followed by `\r\n`, to one editor terminal.
 * Every line is buffered from construction; the terminal is created on `show`, which replays the
 * whole buffer and then streams; after the terminal closes, lines buffer again and the next
 * `show` creates a new terminal and replays the buffer, which is never truncated.
 */
export function createTerminalSink(
  port: EditorLogPort,
  terminalName: string,
  format?: (line: LogLine) => string,
): Sink & {show(): void; dispose(): void} {
  const render = format ?? defaultFormat;
  const buffer: string[] = [];
  let writer:
    | {
        write(text: string): void;
        onDidClose(listener: () => void): void;
        dispose(): void;
      }
    | undefined;

  function show(): void {
    if (writer === undefined) {
      writer = port.createTerminalWriter(terminalName);
      for (const text of buffer) {
        writer.write(`${text}\r\n`);
      }
      writer.onDidClose(() => {
        writer = undefined;
      });
    }
  }

  return {
    write(line: LogLine): void {
      const text = render(line);
      buffer.push(text);
      if (writer !== undefined) {
        writer.write(`${text}\r\n`);
      }
    },
    show,
    dispose(): void {
      if (writer !== undefined) {
        writer.dispose();
        writer = undefined;
      }
    },
  };
}
