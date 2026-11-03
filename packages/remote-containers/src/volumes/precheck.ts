/**
 * @fileoverview The access pre-check of a clone, on the host before any Docker object: `git ls-remote` of the source,
 * with git's and ssh's questions through the askpass relay and never on a terminal. Its exit status alone decides.
 */

import type {AskpassRelay} from './askpass-relay.ts';
import type {CloneOrigin, CloneSource} from './clone-source.ts';
import {lsRemoteArguments} from './git-arguments.ts';

/** What the pre-check is made from. */
export interface PrecheckPorts {
  openRelay(): Promise<AskpassRelay>;
  /** Runs `git` with these arguments and added variables; gives its exit status, or `null` when it ended on a signal. */
  runGit(
    gitArguments: readonly string[],
    environment: Readonly<Record<string, string>>,
    cancellation: AbortSignal,
  ): Promise<number | null>;
}

/** How the pre-check ended. */
export type PrecheckOutcome = 'reachable' | 'unreachable' | 'cancelled';

/** Checks that `source` can be read, with the relay open for the run and closed after it. */
export async function precheck(
  source: CloneSource,
  origin: CloneOrigin,
  ports: PrecheckPorts,
  cancellation: AbortSignal,
): Promise<PrecheckOutcome> {
  const relay = await ports.openRelay();
  try {
    const status = await ports.runGit(
      lsRemoteArguments(source, origin),
      {GIT_TERMINAL_PROMPT: '0', ...relay.environment},
      cancellation,
    );
    if (cancellation.aborted) {
      return 'cancelled';
    }
    return status === 0 ? 'reachable' : 'unreachable';
  } finally {
    await relay.close();
  }
}
