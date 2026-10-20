/**
 * @fileoverview The message handler of the shutdown helper: it reads each request, gives it to the registry under the
 * lease that sent it, and answers; it ends connections when leases close and runs the drain action before the helper ends.
 */

import type {EndPolicy, MessageHandler} from 'lib-helper';
import {readShutdownRequest} from './protocol.ts';
import {CHECK_MILLISECONDS, type ShutdownRegistry} from './registry.ts';

/** The action of the helper's end policy: wait for every pending check and lookup. */
export const DRAIN_ACTION = 'drain';

/** How the helper ends: ten seconds after its last lease, once every pending check and lookup is done. */
export const SHUTDOWN_END_POLICY: EndPolicy = {
  kind: 'delayedCheckAfterLastLease',
  milliseconds: CHECK_MILLISECONDS,
  action: DRAIN_ACTION,
};

/** The handler over `registry`. */
export function createShutdownHandler(
  registry: ShutdownRegistry,
): MessageHandler {
  return {
    onRequest: (body, context) => {
      const read = readShutdownRequest(body);
      if (read.kind === 'malformed') {
        return Promise.resolve({accepted: false, problem: read.problem});
      }
      const {request} = read;
      if (request.type === 'register') {
        return Promise.resolve(registry.register(context.lease, request));
      }
      if (request.type === 'container') {
        return Promise.resolve(registry.setContainer(request));
      }
      return Promise.resolve(registry.leave(request));
    },
    runAction: action =>
      action === DRAIN_ACTION
        ? registry.drain()
        : Promise.reject(new Error(`the helper has no action ${action}`)),
    onLeasesChanged: leaseIds => {
      registry.leasesChanged(leaseIds);
    },
  };
}
