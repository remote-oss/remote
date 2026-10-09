/**
 * @fileoverview The helper side: listens on the endpoint, grants a lease to each client that says hello with the
 * record's nonce, answers requests through the consumer's handler, and ends by its policy or on a stop.
 */

import {EventEmitter, once} from 'node:events';
import type {EndpointConnection, EndpointPort} from '../endpoint/protocol.ts';
import {
  type HelperMessage,
  type PlainData,
  readClientMessage,
} from '../endpoint/protocol.ts';
import type {EndPolicy} from '../types.ts';
import {
  EndPolicyRunner,
  type PolicyOutcome,
  type Scheduler,
} from './end-policy.ts';
import {LeaseTable} from './leases.ts';

/** What a request handler can do beyond answering: tell every lease something. */
export interface RequestContext {
  /** The lease that sent the request. */
  lease: number;
  broadcast(body: PlainData): void;
}

/** What a handler can do at any time, not only while it answers a request. */
export interface HelperControl {
  /** Tells every lease something. */
  broadcast(body: PlainData): void;
  /** Ends the helper, as a `stop` from a client does. */
  stop(): void;
}

/** The consumer's part of a helper. */
export interface MessageHandler {
  /** Answers one request; a rejection reaches the client as a failed reply. */
  onRequest(body: PlainData, context: RequestContext): Promise<PlainData>;
  /** Runs the action a delayed-check policy names, before the helper ends. */
  runAction(action: string): Promise<void>;
  /** Called once, before the endpoint listens, with the helper's control. */
  attach?(control: HelperControl): void;
  /**
   * Called after a lease has been granted, once its welcome is sent, and after a lease has closed, with the numbers
   * of the live leases, oldest first.
   */
  onLeasesChanged?(leaseIds: readonly number[]): void;
}

/** Everything a helper needs to serve. */
export interface ServeOptions {
  endpoint: string;
  nonce: string;
  payload: Record<string, string | number | boolean>;
  policy: EndPolicy;
  handler: MessageHandler;
  port: EndpointPort;
  clock: () => number;
  scheduler: Scheduler;
  /** How long a new connection may take to say hello before it is closed. */
  helloLimitMilliseconds: number;
  logLine: (line: string) => void;
}

/** Why the helper ended. */
export type ServeEnd = 'policy' | 'stopped';

function failureText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

/**
 * Serves until the end policy fires or a client sends stop, then closes every connection and the endpoint.
 * Throws PolicyError before listening when the policy cannot run.
 */
export async function serve(options: ServeOptions): Promise<ServeEnd> {
  const {handler, logLine} = options;
  const table = new LeaseTable(options.clock);
  const connections = new Map<number, EndpointConnection>();
  const ending = new EventEmitter();
  // The one 'end' event carries the outcome as its only argument.
  const ended = once(ending, 'end') as Promise<[PolicyOutcome | 'stopped']>;
  function finish(outcome: PolicyOutcome | 'stopped'): void {
    ending.emit('end', outcome);
  }
  const runner = new EndPolicyRunner(
    options.policy,
    table,
    options.scheduler,
    outcome => {
      finish(outcome);
    },
  );
  function broadcast(message: HelperMessage): void {
    for (const connection of connections.values()) {
      connection.send(message);
    }
  }
  table.onChange(event => {
    broadcast({
      type: 'leaseListChanged',
      leases: event.leases.map(lease => lease.leaseId),
    });
  });
  function leasesChanged(): void {
    handler.onLeasesChanged?.(table.live().map(live => live.leaseId));
  }
  handler.attach?.({
    broadcast: body => {
      broadcast({type: 'message', body});
    },
    stop: () => {
      finish('stopped');
    },
  });
  function accept(connection: EndpointConnection): void {
    let lease: number | undefined;
    const cancelHello = options.scheduler.setTimer(
      options.helloLimitMilliseconds,
      () => {
        logLine('a connection did not say hello in time');
        connection.close();
      },
    );
    connection.onClose(() => {
      cancelHello();
      if (lease !== undefined) {
        connections.delete(lease);
        table.close(lease);
        leasesChanged();
      }
    });
    connection.onMessage(value => {
      const message = readClientMessage(value);
      if (lease === undefined) {
        if (message?.type !== 'hello' || message.nonce !== options.nonce) {
          logLine('a connection was refused: no hello with the nonce');
          connection.close();
          return;
        }
        cancelHello();
        const granted = table.open().leaseId;
        lease = granted;
        connections.set(granted, connection);
        connection.send({
          type: 'welcome',
          lease: granted,
          leases: table.live().map(live => live.leaseId),
          payload: options.payload,
        } satisfies HelperMessage);
        leasesChanged();
        return;
      }
      if (message?.type === 'stop') {
        finish('stopped');
        return;
      }
      if (message?.type !== 'request') {
        logLine('a message that is not a request was ignored');
        return;
      }
      const {requestId} = message;
      handler
        .onRequest(message.body, {
          lease,
          broadcast: body => {
            broadcast({type: 'message', body});
          },
        })
        .then(
          body => {
            connection.send({
              type: 'reply',
              requestId,
              body,
            } satisfies HelperMessage);
          },
          (caught: unknown) => {
            connection.send({
              type: 'failed',
              requestId,
              reason: failureText(caught),
            } satisfies HelperMessage);
          },
        );
    });
  }
  const server = await options.port.listen(options.endpoint, accept);
  const [outcome] = await ended;
  runner.dispose();
  if (outcome !== 'stopped' && outcome.kind === 'runActionThenEnd') {
    await handler.runAction(outcome.action).catch((caught: unknown) => {
      logLine(`the end action failed: ${failureText(caught)}`);
    });
  }
  for (const connection of [...connections.values()]) {
    connection.close();
  }
  await server.close();
  return outcome === 'stopped' ? 'stopped' : 'policy';
}
