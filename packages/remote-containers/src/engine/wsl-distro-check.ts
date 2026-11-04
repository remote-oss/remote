/**
 * @fileoverview The distro a name stands for, asked of WSL's own list before anything runs in it: a name from a
 * setting, a payload, a recent entry or a link is only a candidate until the list holds it, and an unknown one stops
 * there, so no program is started for it.
 */

import {matchDistro, parseList, type WslRunner} from 'lib-wsl';

declare const REGISTERED: unique symbol;

/**
 * The name of a distro that WSL's list holds, in its registered spelling. Only {@link checkedDistroOf} makes one, so
 * what starts a program in a distro cannot be given a name that was not checked.
 */
export type RegisteredDistro = string & {readonly [REGISTERED]: true};

/** What the list says of a typed name. */
export type DistroCheck =
  /** The distro is registered, under this spelling. */
  | {kind: 'registered'; name: RegisteredDistro}
  /** No registered distro has this name. */
  | {kind: 'unknown'; typed: string}
  /** The name is empty and WSL has no default distro. */
  | {kind: 'noDistro'}
  /** The list could not be had or read. */
  | {kind: 'unavailable'; detail: string};

/** The registered distro that `typed` names, an empty name meaning WSL's default one; nothing is asked of the user. */
export async function checkedDistroOf(
  runner: Pick<WslRunner, 'manage'>,
  typed: string,
  cancellation: AbortSignal,
): Promise<DistroCheck> {
  const listed = await runner.manage({
    verb: 'list',
    operands: [],
    cancellation,
  });
  if (listed.kind === 'failed') {
    return {
      kind: 'unavailable',
      detail: `${listed.failure.kind}: ${listed.failure.detail}`,
    };
  }
  const rows = parseList(listed.text);
  if (listed.status !== 0 || rows.kind === 'unparseable') {
    return {
      kind: 'unavailable',
      detail:
        rows.kind === 'unparseable'
          ? rows.reason
          : `wsl.exe --list ended with status ${String(listed.status)}`,
    };
  }
  const matched = matchDistro(rows.rows, typed);
  if (matched.kind === 'match') {
    return {
      kind: 'registered',
      name: matched.registeredName as RegisteredDistro,
    };
  }
  return matched.kind === 'noDistro'
    ? {kind: 'noDistro'}
    : {kind: 'unknown', typed: matched.asTyped};
}
