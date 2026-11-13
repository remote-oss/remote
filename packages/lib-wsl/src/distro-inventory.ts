/**
 * @fileoverview D2's process half: what WSL holds as far as the extension asks of a process: whether it is there, the
 * installed distros, the catalogue that can be installed, and the default distro. Nothing is cached across operations,
 * nothing is retried, and every wait is the caller's to bound through the cancellation it passes.
 */

import {validDistroName} from './distro-name.ts';
import {type DistroRow, parseList} from './list.ts';
import {filterDockerDesktop} from './match.ts';
import {type OnlineRow, parseOnline} from './online.ts';
import {sortOnlineCatalogue} from './install.ts';
import type {RunFailed, WslRunner} from './runner.ts';
import {parseStatus} from './status.ts';
import {multiDistroAllowed} from './windows-build.ts';

/**
 * The exit statuses of `wsl.exe --list --verbose` when no distro is registered: -1, as measured on Windows 2025, and
 * the same 32-bit value read as unsigned, as a child process reports it. A machine without WSL gives -1 as well, which
 * `--status` tells apart.
 */
const NO_DISTRO_STATUSES: readonly number[] = [-1, 0xffff_ffff];

/** Whether WSL is there, and what the extension knows of it. */
export type Presence =
  | {readonly kind: 'absent'}
  | {readonly kind: 'noDistro'}
  | {
      readonly kind: 'present';
      readonly wslVersion?: string;
      readonly windowsBuild: number | undefined;
    };

/** What the read of the distro list gave. */
export type DistrosResult =
  | {readonly kind: 'rows'; readonly rows: readonly DistroRow[]}
  | {readonly kind: 'noDistro'}
  | RunFailed
  | {
      readonly kind: 'listFailed';
      readonly status: number;
      readonly detail: string;
    };

/** What the read of the online catalogue gave. */
export type CatalogueResult =
  | {readonly kind: 'rows'; readonly rows: readonly OnlineRow[]}
  | {readonly kind: 'unavailable'; readonly detail: string};

/** What setting the default distro gave. */
export type SetDefaultResult =
  | {readonly kind: 'done'}
  | {readonly kind: 'invalidName'}
  | RunFailed
  | {
      readonly kind: 'refused';
      readonly status: number;
      readonly detail: string;
    };

/** The inventory of WSL. */
export interface DistroInventory {
  /**
   * Whether WSL is there and has a distro. A WSL that does not answer is `absent`; a list that cannot be read, once
   * `--status` answered, is `present`, because nothing says there is no distro.
   */
  presence(cancellation: AbortSignal): Promise<Presence>;
  /**
   * The installed distros. A call made while a read runs shares its result; a call after that reads again. No row after
   * the Docker Desktop filter is `noDistro`.
   */
  distros(
    options: {includeDockerDesktop: boolean},
    cancellation: AbortSignal,
  ): Promise<DistrosResult>;
  /** The distros that can be installed, sorted by their friendly names. */
  onlineCatalogue(cancellation: AbortSignal): Promise<CatalogueResult>;
  /** Makes the registered distro `registeredName` the default. */
  setDefault(
    registeredName: string,
    cancellation: AbortSignal,
  ): Promise<SetDefaultResult>;
  /** Calls `listener` after a `distros` read whose rows differ from those of the read before; the first read is not one. */
  onDidChange(listener: () => void): {dispose(): void};
}

/** What the inventory runs and knows. */
export interface DistroInventoryPorts {
  runner: WslRunner;
  windowsBuild: number | undefined;
}

type ListOutcome =
  | {readonly kind: 'rows'; readonly rows: readonly DistroRow[]}
  | RunFailed
  | {
      readonly kind: 'listFailed';
      readonly status: number;
      readonly detail: string;
    };

/** Whether two lists have the same rows: names, default marks, states and versions, in order. */
function sameRows(
  left: readonly DistroRow[],
  right: readonly DistroRow[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.name === right[index]?.name &&
        entry.isDefault === right[index].isDefault &&
        entry.state === right[index].state &&
        entry.version === right[index].version,
    )
  );
}

/** The inventory over `ports`. */
export function createDistroInventory(
  ports: DistroInventoryPorts,
): DistroInventory {
  const {runner, windowsBuild} = ports;
  const listeners = new Set<() => void>();
  let reading: Promise<ListOutcome> | undefined;
  let previous: readonly DistroRow[] | undefined;

  async function readList(cancellation: AbortSignal): Promise<ListOutcome> {
    const finished = await runner.manage({
      verb: 'list',
      operands: [],
      cancellation,
    });
    if (finished.kind === 'failed') {
      return finished;
    }
    if (NO_DISTRO_STATUSES.includes(finished.status)) {
      return {kind: 'rows', rows: []};
    }
    const listFailed = {
      kind: 'listFailed',
      status: finished.status,
      detail: finished.text.trim(),
    } as const;
    if (finished.status !== 0) {
      return listFailed;
    }
    const parsed = parseList(finished.text);
    return parsed.kind === 'rows'
      ? {kind: 'rows', rows: parsed.rows}
      : {...listFailed, detail: `the list is not readable: ${parsed.reason}`};
  }

  /** The list read that runs now, or a new one. */
  function sharedList(cancellation: AbortSignal): Promise<ListOutcome> {
    if (reading === undefined) {
      const started = readList(cancellation).finally(() => {
        reading = undefined;
      });
      reading = started;
    }
    return reading;
  }

  async function distros(
    options: {includeDockerDesktop: boolean},
    cancellation: AbortSignal,
  ): Promise<DistrosResult> {
    const outcome = await sharedList(cancellation);
    if (outcome.kind !== 'rows') {
      return outcome;
    }
    const changed = previous !== undefined && !sameRows(previous, outcome.rows);
    previous = outcome.rows;
    if (changed) {
      for (const listener of [...listeners]) {
        listener();
      }
    }
    const rows = filterDockerDesktop(
      outcome.rows,
      options.includeDockerDesktop,
    );
    return rows.length === 0 ? {kind: 'noDistro'} : {kind: 'rows', rows};
  }

  async function presence(cancellation: AbortSignal): Promise<Presence> {
    const status = await runner.manage({
      verb: 'status',
      operands: [],
      cancellation,
    });
    if (status.kind === 'failed' || status.status !== 0) {
      return {kind: 'absent'};
    }
    const outcome = await sharedList(cancellation);
    if (
      outcome.kind === 'rows' &&
      filterDockerDesktop(outcome.rows, false).length === 0
    ) {
      return {kind: 'noDistro'};
    }
    const {wslVersion} = parseStatus(status.text);
    return wslVersion === undefined
      ? {kind: 'present', windowsBuild}
      : {kind: 'present', wslVersion, windowsBuild};
  }

  async function onlineCatalogue(
    cancellation: AbortSignal,
  ): Promise<CatalogueResult> {
    const finished = await runner.manage({
      verb: 'listOnline',
      operands: [],
      cancellation,
    });
    if (finished.kind === 'failed') {
      return {kind: 'unavailable', detail: finished.failure.detail};
    }
    if (finished.status !== 0) {
      return {kind: 'unavailable', detail: finished.text.trim()};
    }
    const parsed = parseOnline(finished.text);
    return parsed.kind === 'rows'
      ? {kind: 'rows', rows: sortOnlineCatalogue(parsed.rows)}
      : {kind: 'unavailable', detail: finished.text.trim()};
  }

  async function setDefault(
    registeredName: string,
    cancellation: AbortSignal,
  ): Promise<SetDefaultResult> {
    if (!validDistroName(registeredName)) {
      return {kind: 'invalidName'};
    }
    const finished = multiDistroAllowed(windowsBuild)
      ? await runner.manage({
          verb: 'setDefault',
          operands: [registeredName],
          cancellation,
        })
      : await runner.setDefaultByWslconfig(registeredName, cancellation);
    if (finished.kind === 'failed') {
      return finished;
    }
    return finished.status === 0
      ? {kind: 'done'}
      : {
          kind: 'refused',
          status: finished.status,
          detail: finished.text.trim(),
        };
  }

  return {
    presence,
    distros,
    onlineCatalogue,
    setDefault,
    onDidChange(listener) {
      listeners.add(listener);
      return {
        dispose() {
          listeners.delete(listener);
        },
      };
    },
  };
}
