/**
 * @fileoverview The commands whose behaviour is not built yet: each gets one shared handler that does nothing, behind
 * the window's availability. A command leaves this list when its own handler is registered.
 */

import type {CommandHandler} from 'lib-identifiers';
import type {commands} from '../identifiers.generated.ts';

/** The commands still on the shared handler. */
export const PENDING_COMMANDS = [
  'connect',
  'connectUsingDistro',
  'remoteWslConnectInNewWindow',
  'connectUsingDistroInNewWindow',
  'openFolder',
  'reopenFromRecommendation',
  'reopenInWSL',
  'reopenInWindows',
  'showLog',
  'getHelp',
  'getStarted',
  'provideFeedback',
  'reportIssue',
  'revealInExplorer',
  'connectInCurrentWindow',
  'explorerConnectInNewWindow',
  'removeFolder',
  'openDistroInCurrentWindow',
  'openDistroInNewWindow',
  'setDefaultDistro',
  'deleteDistro',
  'refresh',
  'addDistro',
] as const satisfies ReadonlyArray<keyof typeof commands>;

/** A handler that does nothing, available when `available` says so. */
export function pendingHandler(available: () => boolean): CommandHandler {
  return {isAvailable: available, execute: () => undefined};
}

/** The shared handler for every pending command. */
export function pendingHandlers(
  available: () => boolean,
): Record<(typeof PENDING_COMMANDS)[number], CommandHandler> {
  const handler = pendingHandler(available);
  return Object.fromEntries(
    PENDING_COMMANDS.map(name => [name, handler]),
  ) as Record<(typeof PENDING_COMMANDS)[number], CommandHandler>;
}
