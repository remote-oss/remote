/**
 * @fileoverview From the engine host a command chose to the host it runs on: a distro's name, from a setting, a
 * payload, a recent entry or a link, is checked against WSL's own list first, and only the registered name starts a
 * program. A name the list does not hold ends there.
 */

import type {WslRunner} from 'lib-wsl';
import type {EngineHost} from './engine-host.ts';
import type {DistroChoice, EngineHostChoice} from './engine-host-of.ts';
import {checkedDistroOf, type RegisteredDistro} from './wsl-distro-check.ts';
import {wslEngineHost} from './wsl-engine-host.ts';

/** Why a distro's host could not be had. */
export type DistroRefusal =
  /** The list holds no such distro. */
  | {reason: 'unknown'; typed: string}
  /** The name is empty and WSL has no default distro. */
  | {reason: 'noDistro'}
  /** The list could not be had or read. */
  | {reason: 'unavailable'; detail: string};

/** The engine host a choice comes to. */
export type ResolvedEngineHost =
  | {kind: 'local'; folder: string}
  | {
      kind: 'distro';
      engine: EngineHost;
      distro: RegisteredDistro;
      choice: DistroChoice;
    }
  | ({kind: 'refused'; choice: DistroChoice} & DistroRefusal);

/** The host for `choice`: the local one as it is, a distro's only once the list holds its name. */
export async function resolvedHostOf(
  choice: EngineHostChoice,
  runner: WslRunner,
  cancellation: AbortSignal,
): Promise<ResolvedEngineHost> {
  if (choice.kind === 'local') {
    return choice;
  }
  const checked = await checkedDistroOf(
    runner,
    choice.distro ?? '',
    cancellation,
  );
  if (checked.kind === 'registered') {
    return {
      kind: 'distro',
      engine: wslEngineHost(runner, checked.name),
      distro: checked.name,
      choice,
    };
  }
  if (checked.kind === 'unknown') {
    return {kind: 'refused', choice, reason: 'unknown', typed: checked.typed};
  }
  if (checked.kind === 'noDistro') {
    return {kind: 'refused', choice, reason: 'noDistro'};
  }
  return {
    kind: 'refused',
    choice,
    reason: 'unavailable',
    detail: checked.detail,
  };
}
