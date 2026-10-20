/**
 * @fileoverview The window's lease on the shutdown helper: one per extension host, acquired the first time a
 * connection tells the helper something and kept for the host's life, so its close is the helper's signal that the
 * window ended. Every failure is one line in the log and nothing else: the connect goes on, and nothing is shown.
 */

import type {HelperEvent, PlainData, RequestOutcome} from 'lib-helper';
import type {Logger} from 'lib-log';
import type {ShutdownRequest} from './protocol.ts';

/** How long a request to the helper may take, in milliseconds. */
export const REQUEST_MILLISECONDS = 2000;

/** What the window uses of a lease. */
export interface LeaseOnHelper {
  request(body: PlainData, limitMilliseconds: number): Promise<RequestOutcome>;
  onEvent(listener: (event: HelperEvent) => void): () => void;
}

/** What acquiring the lease gave: the lease, or why there is none. */
export type LeaseAcquired =
  {kind: 'acquired'; lease: LeaseOnHelper} | {kind: 'failed'; failure: string};

/** What the window's lease needs of the world. */
export interface WindowLeasePorts {
  /** Joins the helper of the instance, or starts it. */
  acquire(): Promise<LeaseAcquired>;
  logger: Logger;
}

/** What a connection tells the helper through. */
export interface ShutdownMessenger {
  /** Sends the request after the ones before it; it never rejects, and it resolves once the helper answered or gave up. */
  send(request: ShutdownRequest): Promise<void>;
}

/** The window's lease over `ports`. */
export function createWindowLease(ports: WindowLeasePorts): ShutdownMessenger {
  const {logger} = ports;
  let lease: LeaseOnHelper | undefined;
  /** Whether the helper was not there the last time: only a register asks for it again. */
  let unavailable = false;
  let queue: Promise<void> = Promise.resolve();

  /** The lease now, acquired when there is none; undefined when the helper is not there. */
  async function leaseNow(): Promise<LeaseOnHelper | undefined> {
    if (lease !== undefined) {
      return lease;
    }
    const outcome = await ports.acquire();
    if (outcome.kind === 'failed') {
      unavailable = true;
      logger.warn(
        `the shutdown helper isn't available (${outcome.failure}): this window's containers won't be stopped when it closes`,
      );
      return undefined;
    }
    const acquired = outcome.lease;
    acquired.onEvent(event => {
      if (event.kind === 'helperGone') {
        gone(acquired);
      }
    });
    unavailable = false;
    lease = acquired;
    return acquired;
  }

  /** The helper behind `closed` is gone: the next register asks for a helper again. */
  function gone(closed: LeaseOnHelper): void {
    if (lease === closed) {
      lease = undefined;
      unavailable = true;
    }
  }

  /** Gives one request to the helper, and logs a line when it does not take it. */
  async function deliver(request: ShutdownRequest): Promise<void> {
    if (unavailable && request.type !== 'register') {
      return;
    }
    const current = await leaseNow();
    if (current === undefined) {
      return;
    }
    const outcome = await current.request(
      request as unknown as PlainData,
      REQUEST_MILLISECONDS,
    );
    if (outcome.kind === 'helperGone') {
      gone(current);
    }
    const problem = problemOf(outcome);
    if (problem !== undefined) {
      logger.warn(
        `the shutdown helper did not take the ${request.type} message: ${problem}`,
      );
    }
  }

  return {
    send: request => {
      queue = queue.then(() =>
        deliver(request).catch((caught: unknown) => {
          logger.warn(
            `the shutdown helper could not be asked: ${caught instanceof Error ? caught.message : String(caught)}`,
          );
        }),
      );
      return queue;
    },
  };
}

/** Why the helper did not take a request, or undefined when it answered that it did. */
function problemOf(outcome: RequestOutcome): string | undefined {
  if (outcome.kind === 'reply') {
    const body = outcome.body as {accepted?: unknown; problem?: unknown};
    return body.accepted === true
      ? undefined
      : `refused: ${String(body.problem)}`;
  }
  return outcome.kind === 'rejected' ? outcome.reason : outcome.kind;
}
