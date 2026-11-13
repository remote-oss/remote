import type {EditorLogPort, TerminalWriter} from '../sinks/editor-port.ts';

/** One output channel the fake created, with everything it received. */
export interface RecordedChannel {
  /** The name the channel was created with. */
  name: string;
  /** The lines appended, in order. */
  appendedLines: string[];
  /** How often dispose was called. */
  disposeCalls: number;
}

/** One terminal writer the fake created, with everything it received. */
export interface RecordedTerminal {
  /** The name the terminal was created with. */
  name: string;
  /** The text written, in order. */
  writtenText: string[];
  /** The open listeners registered. */
  openListeners: Array<() => void>;
  /** The close listeners registered. */
  closeListeners: Array<() => void>;
  /** The `preserveFocus` of each reveal, in order. */
  shows: boolean[];
  /** How often dispose was called. */
  disposeCalls: number;
}

/**
 * A recording implementation of the editor port, for tests: it keeps every channel and terminal
 * it created with the text each received, and lets a test fire `onDidClose` for the latest
 * terminal.
 */
export class FakeEditorPort implements EditorLogPort {
  /** The output channels created, in order. */
  readonly channels: RecordedChannel[] = [];

  /** The terminal writers created, in order. */
  readonly terminals: RecordedTerminal[] = [];

  /** Create and record an output channel under `name`. */
  createOutputChannel(name: string): {
    appendLine(text: string): void;
    dispose(): void;
  } {
    const channel: RecordedChannel = {
      name,
      appendedLines: [],
      disposeCalls: 0,
    };
    this.channels.push(channel);
    return {
      appendLine: (text: string) => {
        channel.appendedLines.push(text);
      },
      dispose: () => {
        channel.disposeCalls += 1;
      },
    };
  }

  /** Create and record a terminal writer under `name`. */
  createTerminalWriter(name: string): TerminalWriter {
    const terminal: RecordedTerminal = {
      name,
      writtenText: [],
      openListeners: [],
      closeListeners: [],
      shows: [],
      disposeCalls: 0,
    };
    this.terminals.push(terminal);
    return {
      write: (text: string) => {
        terminal.writtenText.push(text);
      },
      show: (preserveFocus: boolean) => {
        terminal.shows.push(preserveFocus);
      },
      onDidOpen: (listener: () => void) => {
        terminal.openListeners.push(listener);
      },
      onDidClose: (listener: () => void) => {
        terminal.closeListeners.push(listener);
      },
      dispose: () => {
        terminal.disposeCalls += 1;
      },
    };
  }

  /** Fire `onDidOpen` for the latest terminal, as the editor does when it opens it: the listeners run once. */
  openLatestTerminal(): void {
    const latest = this.terminals.at(-1);
    if (latest !== undefined) {
      const listeners = latest.openListeners;
      latest.openListeners = [];
      for (const listener of listeners) {
        listener();
      }
    }
  }

  /**
   * Fire `onDidClose` for the latest terminal: its listeners run once, and are forgotten, so a
   * second call closes nothing.
   */
  closeLatestTerminal(): void {
    const latest = this.terminals.at(-1);
    if (latest !== undefined) {
      const listeners = latest.closeListeners;
      latest.closeListeners = [];
      for (const listener of listeners) {
        listener();
      }
    }
  }
}
