/**
 * @fileoverview lib-forwarding: the local port search the tunneling extensions use — the range parsed from the
 * setting, and the first port a prober finds free.
 */
export type {ParsedRange, PortRange} from './port-search/range.ts';
export {parseRange} from './port-search/range.ts';
export type {
  FindOptions,
  FindOutcome,
  PortProber,
  ProbeAnswer,
} from './port-search/find.ts';
export {findFreePort} from './port-search/find.ts';
