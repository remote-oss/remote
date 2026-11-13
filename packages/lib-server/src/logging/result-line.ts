/**
 * @fileoverview The one line a server's result block gives the log.
 */

import type {ResultBlock} from '../scripts/result-block.ts';

/**
 * The one line a parsed result block gives the log: its status, then the server's port, the host's system and
 * architecture, and the download and install times, each only when the block has it. No other fact is logged, so none
 * of the host's environment values reach the log.
 */
export function serverResultLine(block: ResultBlock): string {
  const parts = [
    block.status,
    ...(block.serverFacts.port === undefined
      ? []
      : [`port ${block.serverFacts.port}`]),
    ...(block.hostFacts.os === undefined ? [] : [`os ${block.hostFacts.os}`]),
    ...(block.hostFacts.arch === undefined
      ? []
      : [`architecture ${block.hostFacts.arch}`]),
    ...(block.timings.download === undefined
      ? []
      : [`download ${String(block.timings.download)} ms`]),
    ...(block.timings.install === undefined
      ? []
      : [`install ${String(block.timings.install)} ms`]),
  ];
  return `Server result: ${parts.join(', ')}`;
}
