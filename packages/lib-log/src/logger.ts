import {LEVEL_ORDER, type Level} from './levels.ts';
import {redact} from './redaction.ts';

/** One line of a log, as it reaches a sink. */
export interface LogLine {
  level: Level;
  scope: readonly string[];
  message: string;
  time: number;
}

/** The end a log line is written to; the library passes lines on and decides nothing about output. */
export interface Sink {
  write(line: LogLine): void;
}

/**
 * A scoped view over one sink: five level methods that filter, redact and pass, and `child` for a
 * sub-scope. A logger created without a sink accepts every call and writes nothing.
 */
export interface Logger {
  readonly scope: readonly string[];
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  child(scopeName: string): Logger;
}

/** The knobs a package wires a logger to its settings: the minimum level, a clock, and named secrets. */
export interface LoggerOptions {
  /** The minimum level to write, read on every line. */
  minimumLevel: () => Level;
  /** The source of a line's time. */
  clock?: () => number;
  /** The named secrets of the session, redacted from every message. */
  secrets?: () => readonly string[];
}

/**
 * Create a logger over a sink. A sink of `undefined` is valid: every call is accepted and nothing is
 * written, so a package with no log channel stays silent by construction.
 */
export function createLogger(
  sink: Sink | undefined,
  options: LoggerOptions,
): Logger {
  function build(scope: readonly string[]): Logger {
    function write(level: Level, message: string): void {
      if (
        LEVEL_ORDER.indexOf(level) < LEVEL_ORDER.indexOf(options.minimumLevel())
      ) {
        return;
      }
      const line: LogLine = {
        level,
        scope,
        message: redact(message, options.secrets ? options.secrets() : []),
        time: options.clock ? options.clock() : 0,
      };
      if (sink !== undefined) {
        sink.write(line);
      }
    }
    return {
      scope,
      trace: (message: string) => {
        write('trace', message);
      },
      debug: (message: string) => {
        write('debug', message);
      },
      info: (message: string) => {
        write('info', message);
      },
      warn: (message: string) => {
        write('warn', message);
      },
      error: (message: string) => {
        write('error', message);
      },
      child: (scopeName: string) => build([...scope, scopeName]),
    };
  }
  return build([]);
}
