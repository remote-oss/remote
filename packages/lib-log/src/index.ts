/**
 * @fileoverview lib-log: the log lines, levels and redaction of the extensions and the libraries that
 * report. A package gets a logger by being handed one with its sink and its level; nothing here is global,
 * and a logger without a sink is valid and silent.
 */

export {type Level, LEVEL_ORDER} from './levels.ts';
export {
  type LogLine,
  type Logger,
  type LoggerOptions,
  createLogger,
  type Sink,
} from './logger.ts';
export {type Secret, redact, secret} from './redaction.ts';
export {logOncePerSession, resetOncePerSession} from './once.ts';
