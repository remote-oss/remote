/**
 * @fileoverview What WSL does in the browser, where no distro can be reached: each command that would open a WSL
 * window rejects with the message the editor shows for it, every other command does nothing, and a WSL window's
 * resolution fails as not available.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {Logger} from 'lib-log';
import {type commands, runtimeCommands} from './identifiers.generated.ts';
import {PENDING_COMMANDS, pendingHandler} from './commands/pending-handlers.ts';
import {WEB_REJECTION} from './strings.ts';

/** The commands that would open a WSL window, which reject in the browser. */
export const REJECTED_IN_WEB = [
  'connect',
  'connectUsingDistro',
  'remoteWslConnectInNewWindow',
  'connectUsingDistroInNewWindow',
  'openFolder',
  'reopenInWSL',
  'reopenInWindows',
  'reopenFromRecommendation',
  'connectInCurrentWindow',
  'explorerConnectInNewWindow',
  'openDistroInCurrentWindow',
  'openDistroInNewWindow',
] as const satisfies ReadonlyArray<keyof typeof commands>;

/** The runtime command that would open a WSL window, which rejects in the browser too. */
const REJECTED_RUNTIME_IN_WEB = runtimeCommands.connectToWSLDefault;

/** A handler that rejects with `message`, translated for the user. */
function rejecting(message: string): CommandHandler {
  return {
    execute: () => {
      throw new Error(message);
    },
  };
}

/** The handler of every command in the browser. */
export function webHandlers(
  translate: (text: string) => string,
): Record<(typeof PENDING_COMMANDS)[number], CommandHandler> {
  const rejected = new Set<string>(REJECTED_IN_WEB);
  const quiet = pendingHandler(() => false);
  return Object.fromEntries(
    PENDING_COMMANDS.map(name => [
      name,
      rejected.has(name) ? rejecting(translate(WEB_REJECTION)) : quiet,
    ]),
  ) as Record<(typeof PENDING_COMMANDS)[number], CommandHandler>;
}

/** The handler of a runtime command in the browser, by its id. */
export function webRuntimeHandler(
  translate: (text: string) => string,
): (commandId: string) => CommandHandler {
  const quiet = pendingHandler(() => false);
  return commandId =>
    commandId === REJECTED_RUNTIME_IN_WEB
      ? rejecting(translate(WEB_REJECTION))
      : quiet;
}

/** The editor operations the browser's resolver needs. */
export interface WebResolverPorts {
  /** Registers `resolve` for the authority; throws when the editor has not granted the proposal. */
  register(authority: string, resolve: () => never): void;
  /** The editor's error for a resolution that is not available, with `message`. */
  notAvailable(message: string): Error;
}

/**
 * Registers the browser's resolver for `authority`: every resolution writes one log line and fails as not available.
 * A registration the editor refuses leaves nothing registered, written or shown.
 */
export function registerWebResolver(
  ports: WebResolverPorts,
  authority: string,
  message: string,
  logger: Logger,
): void {
  try {
    ports.register(authority, () => {
      logger.error(message);
      throw ports.notAvailable(message);
    });
  } catch {
    // Without the proposal the window has no resolver to fail, and nothing is said about it.
  }
}
