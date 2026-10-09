/**
 * @fileoverview The window the connect command opens and the argument it takes: which window, whether the picker
 * or a direct host, and the host the on-active-host command rebuilds.
 */

import type {SshTarget} from 'lib-ssh';

/** The command that starts a connect, and where it starts it. */
export type ConnectSource =
  | 'opensshremotes.openEmptyWindow'
  | 'opensshremotes.openEmptyWindowInCurrentWindow'
  | 'opensshremotes.openEmptyWindowOnCurrentHost'
  | 'hostAddedConnect';

/** The window a connect command opens. */
export type WindowTarget = 'new' | 'current';

/** The window a connect command opens: the current-window command opens here, every other command opens new. */
export function windowTargetOf(source: ConnectSource): WindowTarget {
  if (source === 'opensshremotes.openEmptyWindowInCurrentWindow') {
    return 'current';
  }
  return 'new';
}

/** The argument of the two picker commands: a picker, or the host named by the argument. */
export type ArgumentChoice = {picker: true} | {host: string};

/**
 * The argument of a picker command: an object that names a host by a string is that host, unchanged, and every
 * other argument opens the picker.
 */
export function argumentChoice(argument: unknown): ArgumentChoice {
  if (
    typeof argument !== 'object' ||
    argument === null ||
    Array.isArray(argument) ||
    !Object.hasOwn(argument, 'host')
  ) {
    return {picker: true};
  }
  const host = (argument as Record<string, unknown>).host;
  return typeof host === 'string' ? {host} : {picker: true};
}

/** The host the on-active-host command rebuilds: the active target without its port of 22. */
export function activeHostTarget(current: SshTarget): SshTarget {
  if (current.port !== 22) {
    return current;
  }
  const target: SshTarget = {host: current.host};
  if (current.user !== undefined) {
    target.user = current.user;
  }
  return target;
}

/** Whether the on-active-host command can act: only a connected SSH remote. */
export function isActiveHostAvailable(
  remoteName: string | undefined,
  connectionState: string | undefined,
): boolean {
  return remoteName === 'ssh-remote' && connectionState === 'connected';
}
