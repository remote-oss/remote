/**
 * @fileoverview What a refused forward leaves behind besides the notice: the line that names the server's setting, in
 * the log once per connect, and the hint kept for the session. Both come from ssh's own lines on their way to the log.
 */

import type {Logger} from 'lib-log';
import {classify, type FailureHint} from 'lib-ssh';
import {ownText} from '../surfaces/own-strings.ts';
import type {Translate} from '../surfaces/strings.ts';

/** The prefix the log puts on ssh's own lines. */
const SSH_PREFIX = '[ssh] ';

/** What the connect hands over when it recognises the refusal. */
export interface RefusalPort {
  /** Starts the record of a connect. */
  begin(): void;
  /** Keeps `hint` for the connect that is running. */
  record(hint: FailureHint): void;
}

/** A logger that watches the lines of ssh it is given, and what starts a connect. */
export interface RefusalWatch {
  logger: Logger;
  /** Starts a connect: the next refusal is logged and recorded again. */
  begin(): void;
}

/**
 * `logger` with the refusal of a forward noticed in ssh's lines: the first one of a connect logs the text of the
 * setting after it and is recorded as a hint, and the others change nothing.
 */
export function refusalWatchOf(
  logger: Logger,
  port: RefusalPort,
  translate: Translate,
): RefusalWatch {
  let seen = false;
  function noticed(message: string): void {
    if (seen || !message.startsWith(SSH_PREFIX)) {
      return;
    }
    const found = classify(
      [message.slice(SSH_PREFIX.length)],
      undefined,
      'tunnel',
      'shared',
    );
    if (found.kind !== 'forwardingDisabled') {
      return;
    }
    seen = true;
    for (const line of found.logLines) {
      logger.error(ownText({id: line, values: []}, translate));
    }
    for (const hint of found.hints) {
      port.record(hint);
    }
  }
  const watching: Logger = {
    scope: logger.scope,
    trace: message => {
      logger.trace(message);
    },
    debug: message => {
      logger.debug(message);
    },
    info: message => {
      logger.info(message);
      noticed(message);
    },
    warn: message => {
      logger.warn(message);
    },
    error: message => {
      logger.error(message);
    },
    child: scopeName => logger.child(scopeName),
  };
  return {
    logger: watching,
    begin: () => {
      seen = false;
      port.begin();
    },
  };
}
