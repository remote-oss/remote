import {deepStrictEqual} from 'node:assert';
import type {RequestContext} from 'lib-helper';
import {
  createShutdownHandler,
  DRAIN_ACTION,
  SHUTDOWN_END_POLICY,
} from '../../src/shutdown/shutdown-handler.ts';
import type {ShutdownRegistry} from '../../src/shutdown/registry.ts';

const IDENTITY = {
  hostPath: '/home/user/proj',
  configFile: '/home/user/proj/.devcontainer/devcontainer.json',
};
const ENGINE = {dockerPath: 'docker', environment: {}};

/** A registry that records what the handler asked of it. */
function recordingRegistry(): {registry: ShutdownRegistry; calls: unknown[]} {
  const calls: unknown[] = [];
  const registry: ShutdownRegistry = {
    register: (leaseId, request) => {
      calls.push(['register', leaseId, request.connectionId]);
      return {accepted: true};
    },
    setContainer: request => {
      calls.push(['container', request.connectionId, request.action]);
      return {accepted: true};
    },
    leave: request => {
      calls.push(['leave', request.connectionId]);
      return {accepted: true};
    },
    leasesChanged: leases => {
      calls.push(['leases', [...leases]]);
    },
    drain: () => {
      calls.push(['drain']);
      return Promise.resolve();
    },
  };
  return {registry, calls};
}

const CONTEXT: RequestContext = {
  lease: 7,
  broadcast: () => undefined,
  notify: () => undefined,
};

describe('the shutdown handler (card containers-68)', () => {
  it('F-0417 BR-8: each request reaches the registry, a register under the lease that sent it', async () => {
    const {registry, calls} = recordingRegistry();
    const handler = createShutdownHandler(registry);
    const replies = [
      await handler.onRequest(
        {
          type: 'register',
          connectionId: 'a',
          identity: IDENTITY,
          engine: ENGINE,
        },
        CONTEXT,
      ),
      await handler.onRequest(
        {
          type: 'container',
          connectionId: 'a',
          containerId: 'c0ffee',
          action: 'none',
        },
        CONTEXT,
      ),
      await handler.onRequest({type: 'leave', connectionId: 'a'}, CONTEXT),
    ];
    deepStrictEqual(
      [replies, calls],
      [
        [{accepted: true}, {accepted: true}, {accepted: true}],
        [
          ['register', 7, 'a'],
          ['container', 'a', 'none'],
          ['leave', 'a'],
        ],
      ],
    );
  });

  it('F-0417 BR-11: a malformed message is answered with its problem and reaches nothing', async () => {
    const {registry, calls} = recordingRegistry();
    const reply = await createShutdownHandler(registry).onRequest(
      {type: 'nap'},
      CONTEXT,
    );
    deepStrictEqual(
      [reply, calls],
      [{accepted: false, problem: 'the message has no connectionId'}, []],
    );
  });

  it('F-0417 AC-23: a change of the live leases reaches the registry as it is', () => {
    const {registry, calls} = recordingRegistry();
    createShutdownHandler(registry).onLeasesChanged?.([1, 3]);
    deepStrictEqual(calls, [['leases', [1, 3]]]);
  });

  it('F-0417 BR-3: the drain action waits on the registry, and any other action is refused', async () => {
    const {registry, calls} = recordingRegistry();
    const handler = createShutdownHandler(registry);
    await handler.runAction(DRAIN_ACTION);
    const refused = await handler.runAction('tidy').then(
      () => 'accepted',
      (caught: unknown) => String(caught),
    );
    deepStrictEqual(
      [calls, refused],
      [[['drain']], 'Error: the helper has no action tidy'],
    );
  });

  it('F-0417 BR-3: the helper ends ten seconds after its last lease, draining first', () => {
    deepStrictEqual(SHUTDOWN_END_POLICY, {
      kind: 'delayedCheckAfterLastLease',
      milliseconds: 10_000,
      action: 'drain',
    });
  });
});
