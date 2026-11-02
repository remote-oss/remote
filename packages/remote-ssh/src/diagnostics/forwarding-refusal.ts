/**
 * @fileoverview What a refused forward leaves behind besides the notice: the line that names the server's setting, in
 * the log once per connect, and the hint kept for the session. Both come from ssh's bare lines, which the logger is
 * handed once each is logged.
 */

import type {Logger} from 'lib-log';
import {classify, type FailureHint} from 'lib-ssh';
import {ownText} from '../surfaces/own-strings.ts';
import type {SshLogger} from '../pipeline/ssh-log.ts';
import type {Translate} from '../surfaces/strings.ts';

/** What the connect hands over when it recognises the refusal. */
export interface RefusalPort {
  /** Starts the record of a connect. */
  begin(): void;
  /** Keeps `hint` for the connect that is running. */
  record(hint: FailureHint): void;
}

/** A logger that watches the lines of ssh it is given, and what starts a connect. */
export interface RefusalWatch {
  logger: Logger & Required<SshLogger>;
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
  function noticed(line: string): void {
    if (seen) {
      return;
    }
    const found = classify([line], undefined, 'tunnel', 'shared');
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
  const watching: RefusalWatch['logger'] = {
    scope: logger.scope,
    trace: message => {
      logger.trace(message);
    },
    debug: message => {
      logger.debug(message);
    },
    info: message => {
      logger.info(message);
    },
    warn: message => {
      logger.warn(message);
    },
    error: message => {
      logger.error(message);
    },
    child: scopeName => logger.child(scopeName),
    sshLines: lines => {
      lines.forEach(noticed);
    },
  };
  return {
    logger: watching,
    begin: () => {
      seen = false;
      port.begin();
    },
  };
}
