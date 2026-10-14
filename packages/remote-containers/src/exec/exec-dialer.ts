/**
 * @fileoverview The dialer that opens a connection to a port on the container's loopback by running the relay script
 * through `docker exec -i`: what the process reads on stdin goes to the port, and what the port sends comes out on
 * stdout.
 */

import {type Dialer, streamDuplex} from 'lib-forwarding';
import type {EngineHost} from '../engine/engine-host.ts';
import {dialArguments} from './exec-arguments.ts';

/** The dialer of the container `containerId`; `nodePath` is the installed server's own `node`. */
export function execDialer(
  engine: EngineHost,
  containerId: string,
  user: string,
  nodePath: string,
  relayScriptPath: string,
): Dialer {
  return {
    dial: async target => {
      if (target.kind === 'socket') {
        throw new Error('a socket target is not available in a container');
      }
      const spawned = await engine.spawn(
        dialArguments(
          containerId,
          user,
          nodePath,
          relayScriptPath,
          target.port,
        ),
        {cancellation: new AbortController().signal},
      );
      if (spawned.kind === 'failed') {
        throw new Error(spawned.detail);
      }
      const {process} = spawned;
      process.stdin.on('error', () => undefined);
      return streamDuplex({
        readable: process.stdout,
        writable: process.stdin,
        whenEnded: listener => {
          void process.exited.then(listener);
        },
        destroy: () => {
          process.stdin.end();
          process.kill();
        },
      });
    },
  };
}
