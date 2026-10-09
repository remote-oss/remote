/**
 * @fileoverview Finds a free local port: the first probed port that refuses a connection, in a range or by
 * random candidates, within a time budget. Probing goes through a prober; this module never binds.
 */
import type {PortRange} from './range.ts';

/** The answer of one probe: nobody listens (free), something listens, or the attempt failed. */
export type ProbeAnswer = 'refused' | 'open' | 'error';

/** Probes one port. 'refused' means nobody listens, so the port is free. */
export interface PortProber {
  probe(port: number): Promise<ProbeAnswer>;
}

/** The options a port search runs under; all three have defaults. */
export interface FindOptions {
  timeBudgetMilliseconds?: number;
  now?: () => number;
  randomPort?: () => number;
}

/** The options with every default filled in, as the search functions run. */
interface FilledOptions {
  timeBudgetMilliseconds: number;
  now: () => number;
  randomPort: () => number;
}

/** The outcome of a port search: the free port, or that none was found. */
export type FindOutcome = {port: number} | {failure: 'noFreePort'};

const DEFAULT_BUDGET_MILLISECONDS = 3000;
const RANDOM_CANDIDATES = 10;
const RANDOM_MIN_PORT = 49152;
const RANDOM_MAX_PORT = 65535;

/** A random port in the ephemeral range, for the no-range search. */
function randomPort(): number {
  return (
    RANDOM_MIN_PORT +
    Math.floor(Math.random() * (RANDOM_MAX_PORT - RANDOM_MIN_PORT + 1))
  );
}

/** The options with their defaults filled in: 3000 ms, Date.now, and a random ephemeral port. */
function withDefaults(options: FindOptions | undefined): FilledOptions {
  return {
    timeBudgetMilliseconds:
      options?.timeBudgetMilliseconds ?? DEFAULT_BUDGET_MILLISECONDS,
    now: options?.now ?? Date.now,
    randomPort: options?.randomPort ?? randomPort,
  };
}

/** Probes the ports of a range in order; the first refusal wins, open and error continue. */
async function searchRange(
  prober: PortProber,
  range: PortRange,
  options: FilledOptions,
): Promise<FindOutcome> {
  const start = options.now();
  for (let port = range.first; port <= range.last; port += 1) {
    if (options.now() - start >= options.timeBudgetMilliseconds) {
      return {failure: 'noFreePort'};
    }
    const answer = await prober.probe(port);
    if (answer === 'refused') {
      return {port};
    }
  }
  return {failure: 'noFreePort'};
}

/** Probes up to ten random candidates; the first refusal wins, open and error continue. */
async function searchRandom(
  prober: PortProber,
  options: FilledOptions,
): Promise<FindOutcome> {
  const start = options.now();
  for (let index = 0; index < RANDOM_CANDIDATES; index += 1) {
    if (options.now() - start >= options.timeBudgetMilliseconds) {
      return {failure: 'noFreePort'};
    }
    const candidate = options.randomPort();
    const answer = await prober.probe(candidate);
    if (answer === 'refused') {
      return {port: candidate};
    }
  }
  return {failure: 'noFreePort'};
}

/**
 * Finds a free port with the prober. With a range, the ports are probed in order; without one, up to ten random
 * candidates are probed. The budget is checked before each probe; the first refused port wins.
 */
export function findFreePort(
  prober: PortProber,
  range: PortRange | undefined,
  options?: FindOptions,
): Promise<FindOutcome> {
  const filled = withDefaults(options);
  return range === undefined
    ? searchRandom(prober, filled)
    : searchRange(prober, range, filled);
}
