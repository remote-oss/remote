/**
 * @fileoverview What a configuration asks of the Docker daemon (`hostRequirements`) and what the daemon has: reading the
 * requirements from a configuration's text, from the merged configuration the CLI gives and from a container's
 * `devcontainer.metadata` label, merging them, reading the daemon's figures from `docker info`, and the two lines of
 * the dialog that tells which requirements are not met. Pure: nothing here runs a process.
 */

import {parseConfiguration} from '../config/configuration-text.ts';

/** What a configuration asks of the daemon; a member that is absent or unreadable is absent. */
export interface HostRequirements {
  /** The CPUs, as written (a number, or a numeric text read as one). */
  cpus?: number;
  /** The memory, in bytes. */
  memory?: number;
  /** The disk, in bytes; listed in the dialog and never compared. */
  storage?: number;
  /** Whether the GPU is required: `true` or an object; `optional` and `false` are not. */
  needsGpu: boolean;
}

/** What the daemon has, from `docker info`. */
export interface DaemonFigures {
  cpus: number;
  /** The total memory, in bytes. */
  memory: number;
  /** Whether the daemon lists the NVIDIA runtime. */
  nvidia: boolean;
}

/** The two detail lines of the dialog. */
export interface UnmetRequirements {
  daemonLine: string;
  configurationLine: string;
}

/** The key the dev container format gives the GPU requirement; shorter than a name may be, so it is only read by this constant. */
export const GPU_KEY = 'gpu';

const BYTES_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ['kb', 1024],
  ['mb', 1024 ** 2],
  ['gb', 1024 ** 3],
  ['tb', 1024 ** 4],
]);
const SIZE_TEXT = /^(\d+)(kb|mb|gb|tb)?$/;
const NUMBER_TEXT = /^\d+(?:\.\d+)?$/;
const BYTES_PER_GIB = 1024 ** 3;

/** A count of CPUs: a number, or a text that is one. */
function cpusOf(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  return typeof value === 'string' && NUMBER_TEXT.test(value)
    ? Number(value)
    : undefined;
}

/** A size in bytes: a number of bytes, or digits with a lowercase `kb`, `mb`, `gb` or `tb`, or digits alone for bytes. */
function bytesOf(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  const match = typeof value === 'string' ? SIZE_TEXT.exec(value) : null;
  if (match === null) {
    return undefined;
  }
  const [, digits = '', unit] = match;
  return (
    Number(digits) * (unit === undefined ? 1 : (BYTES_PER_UNIT.get(unit) ?? 1))
  );
}

/** The requirements a `hostRequirements` value states; none when it is no object. */
export function requirementsOf(value: unknown): HostRequirements {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {needsGpu: false};
  }
  const record = value as Record<string, unknown>;
  const cpus = cpusOf(record.cpus);
  const memory = bytesOf(record.memory);
  const storage = bytesOf(record.storage);
  const required = record[GPU_KEY];
  return {
    ...(cpus === undefined ? {} : {cpus}),
    ...(memory === undefined ? {} : {memory}),
    ...(storage === undefined ? {} : {storage}),
    needsGpu:
      required === true || (typeof required === 'object' && required !== null),
  };
}

/** The requirements a configuration file's own text states. */
export function requirementsOfText(text: string): HostRequirements {
  return requirementsOf(parseConfiguration(text)?.hostRequirements);
}

/** Merges requirements as the CLI does: the larger `cpus`, `memory` and `storage` win, and the GPU is required if any requires it. */
export function mergedRequirements(
  list: readonly HostRequirements[],
): HostRequirements {
  function largest(
    pick: (requirements: HostRequirements) => number | undefined,
  ): number | undefined {
    const values = list
      .map(pick)
      .filter((value): value is number => value !== undefined);
    return values.length === 0 ? undefined : Math.max(...values);
  }
  const cpus = largest(requirements => requirements.cpus);
  const memory = largest(requirements => requirements.memory);
  const storage = largest(requirements => requirements.storage);
  return {
    ...(cpus === undefined ? {} : {cpus}),
    ...(memory === undefined ? {} : {memory}),
    ...(storage === undefined ? {} : {storage}),
    needsGpu: list.some(requirements => requirements.needsGpu),
  };
}

/** The requirements a container's `devcontainer.metadata` label records: its entries, merged. */
export function requirementsOfLabel(label: string): HostRequirements {
  let parsed: unknown;
  try {
    parsed = JSON.parse(label);
  } catch {
    return {needsGpu: false};
  }
  const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  return mergedRequirements(
    entries.map(entry =>
      typeof entry === 'object' && entry !== null
        ? requirementsOf((entry as Record<string, unknown>).hostRequirements)
        : {needsGpu: false},
    ),
  );
}

/** The daemon's figures from the output of `docker info --format '{{json .}}'`; none when it does not give a CPU count and a memory. */
export function daemonFiguresOf(info: string): DaemonFigures | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(info);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  const {NCPU: cpus, MemTotal: memory, Runtimes: runtimes} = record;
  if (typeof cpus !== 'number' || typeof memory !== 'number') {
    return undefined;
  }
  return {
    cpus,
    memory,
    nvidia:
      typeof runtimes === 'object' &&
      runtimes !== null &&
      Object.hasOwn(runtimes, 'nvidia'),
  };
}

/** A size in gibibytes with one decimal at most, and the `gb` suffix. */
function gigabytesOf(bytes: number): string {
  return `${String(Number((bytes / BYTES_PER_GIB).toFixed(1)))}gb`;
}

/**
 * The lines of the dialog when the requirements are not met: they are when the CPUs or the memory asked for are more
 * than the daemon has. The disk is listed and never compared, and the GPU is listed when required and never compared.
 * None when they are met.
 */
export function unmetRequirements(
  required: HostRequirements,
  daemon: DaemonFigures,
): UnmetRequirements | undefined {
  const unmet =
    (required.cpus !== undefined && required.cpus > daemon.cpus) ||
    (required.memory !== undefined && required.memory > daemon.memory);
  if (!unmet) {
    return undefined;
  }
  const asked = [
    ...(required.cpus === undefined ? [] : [`CPUs ${String(required.cpus)}`]),
    ...(required.memory === undefined
      ? []
      : [`RAM ${gigabytesOf(required.memory)}`]),
    ...(required.storage === undefined
      ? []
      : [`disk ${gigabytesOf(required.storage)}`]),
    ...(required.needsGpu ? ['GPU'] : []),
  ];
  return {
    daemonLine: `Docker daemon: CPUs ${String(daemon.cpus)}, RAM ${gigabytesOf(daemon.memory)}${daemon.nvidia ? ', GPU' : ''}`,
    configurationLine: `devcontainer.json: ${asked.join(', ')}`,
  };
}
