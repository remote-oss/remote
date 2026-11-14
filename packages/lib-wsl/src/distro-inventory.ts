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
import {exitStatusIs, type RunFailed, type WslRunner} from './runner.ts';
import {parseStatus} from './status.ts';
import {multiDistroAllowed} from './windows-build.ts';

/**
 * The exit status of `wsl.exe --list --verbose` when no distro is registered, as measured on Windows 2025. A machine
 * without WSL gives it as well, which `--status` tells apart.
 */
const NO_DISTRO_STATUS = -1;

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

/** A list read that callers share: its outcome, the cancellation of the process, and how many callers still wait for it. */
interface SharedRead {
  readonly outcome: Promise<ListOutcome>;
  readonly controller: AbortController;
  waiting: number;
}

/** What a caller gets when it stops waiting for the list. */
const CANCELLED_WAIT: RunFailed = {
  kind: 'failed',
  failure: {kind: 'cancelled', detail: 'cancelled while the list was read'},
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
  let reading: SharedRead | undefined;
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
    if (exitStatusIs(finished.status, NO_DISTRO_STATUS)) {
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

  /**
   * The list read that runs now, or a new one. Each caller waits under its own cancellation: a caller that aborts leaves
   * with `cancelled` at once, and the read itself is cancelled only when every caller that joined it has left.
   */
  function sharedList(cancellation: AbortSignal): Promise<ListOutcome> {
    if (cancellation.aborted) {
      return Promise.resolve(CANCELLED_WAIT);
    }
    let read = reading;
    if (read === undefined || read.controller.signal.aborted) {
      const controller = new AbortController();
      const started: SharedRead = {
        outcome: readList(controller.signal).finally(() => {
          if (reading === started) {
            reading = undefined;
          }
        }),
        controller,
        waiting: 0,
      };
      read = started;
      reading = started;
    }
    const joined = read;
    joined.waiting += 1;
    return new Promise(resolve => {
      let waiting = true;
      function leave(): void {
        waiting = false;
        joined.waiting -= 1;
        cancellation.removeEventListener('abort', abandon);
      }
      function abandon(): void {
        leave();
        resolve(CANCELLED_WAIT);
        if (joined.waiting === 0) {
          joined.controller.abort();
        }
      }
      cancellation.addEventListener('abort', abandon, {once: true});
      void joined.outcome.then(outcome => {
        if (waiting) {
          leave();
          resolve(outcome);
        }
      });
    });
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
