import {deepStrictEqual} from 'node:assert';
import type {RelayTunnel} from '../../src/relay.ts';
import {type HostEnd, serveTunnel} from '../../src/serve.ts';

const TUNNEL: RelayTunnel = {
  tunnelId: 'tunnel1',
  clusterId: 'cluster',
  name: 'dev-box',
  ports: [],
};

/** What serving the tunnel with a host leg that ends with `end` said, and the status of the run. */
async function servedWith(end: HostEnd): Promise<[string[], number]> {
  const said: string[] = [];
  const status = await serveTunnel(
    {hold: () => Promise.resolve(end)},
    TUNNEL,
    new AbortController().signal,
    line => {
      said.push(line);
    },
  );
  return [said, status];
}

describe('serving the tunnel', () => {
  it('ends with status 0 and says nothing when the user stopped the agent', async () => {
    deepStrictEqual(await servedWith({kind: 'stopped'}), [[], 0]);
  });

  it('hands the leg the tunnel and the stop signal it is to hold until', async () => {
    const stop = new AbortController().signal;
    const heard: unknown[] = [];
    await serveTunnel(
      {
        hold: (tunnel, signal) => {
          heard.push(tunnel, signal);
          return Promise.resolve({kind: 'stopped'});
        },
      },
      TUNNEL,
      stop,
      () => undefined,
    );
    deepStrictEqual(heard, [TUNNEL, stop]);
  });

  it('ends with status 1 and says why when another host took the tunnel, so that the service manager does not fight for it', async () => {
    deepStrictEqual(await servedWith({kind: 'otherHost'}), [
      ['another host has taken this tunnel; this agent stops'],
      1,
    ]);
  });

  it('ends with status 1 and says the leg’s reason when it ended for good, so that the service manager starts the agent again', async () => {
    deepStrictEqual(
      await servedWith({
        kind: 'ended',
        reason: 'the relay no longer has the tunnel',
      }),
      [['the host leg ended: the relay no longer has the tunnel'], 1],
    );
  });
});
