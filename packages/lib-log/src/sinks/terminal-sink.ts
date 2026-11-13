import type {Sink} from '../logger.ts';
import type {EditorLogPort, TerminalWriter} from './editor-port.ts';
import {colouredLineOf} from './line-format.ts';

/** What a terminal sink is given besides its port and name. */
export interface TerminalSinkOptions {
  /** The named secrets redacted from every line. */
  secrets?: () => readonly string[];
}

/**
 * A sink that streams its lines, each followed by `\r\n`, to one editor terminal. Every line is kept from the sink's
 * creation until the first terminal opens, and replayed once into it. A terminal made after the user closed one starts
 * empty; a terminal the editor never opened does not count as the first, so its lines stay for the next. At most one
 * terminal exists, and `reveal` makes it when it is missing.
 */
export function createTerminalSink(
  port: EditorLogPort,
  terminalName: string,
  options: TerminalSinkOptions = {},
): Sink & {reveal(focus: boolean): void; dispose(): void} {
  const kept: string[] = [];
  let terminal: {writer: TerminalWriter; opened: boolean} | undefined;
  let everOpened = false;

  function created(): {writer: TerminalWriter; opened: boolean} {
    const made = {
      writer: port.createTerminalWriter(terminalName),
      opened: false,
    };
    made.writer.onDidOpen(() => {
      if (terminal !== made) {
        return;
      }
      made.opened = true;
      everOpened = true;
      for (const text of kept.splice(0)) {
        made.writer.write(text);
      }
    });
    made.writer.onDidClose(() => {
      if (terminal === made) {
        terminal = undefined;
      }
    });
    return made;
  }

  return {
    write(line): void {
      const text = `${colouredLineOf(line, options.secrets?.() ?? [])}\r\n`;
      if (terminal?.opened === true) {
        terminal.writer.write(text);
      } else if (!everOpened || terminal !== undefined) {
        kept.push(text);
      }
    },
    reveal(focus: boolean): void {
      terminal ??= created();
      terminal.writer.show(!focus);
    },
    dispose(): void {
      terminal?.writer.dispose();
      terminal = undefined;
    },
  };
}
