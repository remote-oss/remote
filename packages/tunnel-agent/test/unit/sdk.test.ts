import {deepStrictEqual} from 'node:assert';
import {
  ConnectionStatus,
  ConnectionStatusChangedEventArgs,
  TunnelRelayTunnelHost,
} from '@microsoft/dev-tunnels-connections';
import {TunnelManagementHttpClient} from '@microsoft/dev-tunnels-management';
import {
  SshConnectionError,
  SshDisconnectReason,
  type SshStream,
} from '@microsoft/dev-tunnels-ssh';
import {existsSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {CONTROL_PORT, type RelayTunnel} from '../../src/relay.ts';
import {relayOf} from '../../src/sdk.ts';
import {stateFolderOf, writeStateFile} from '../../src/state.ts';

const TUNNEL: RelayTunnel = {
  tunnelId: 'tunnel1',
  clusterId: 'cluster',
  name: 'dev-box',
  ports: [],
};

describe('the host leg over the SDK, before it reaches the relay', () => {
  let folder = '';
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'agent-sdk-'));
    folder = stateFolderOf(home);
  });

  afterEach(() => {
    rmSync(home, {recursive: true, force: true});
  });

  /** The leg of a relay that nothing answers, over the state folder of the row. */
  function legOnNoRelay() {
    return relayOf('relay.invalid', 'a-token', folder, () => undefined).hostLeg;
  }

  it('a leg whose stop came already ends as stopped at once, without making a host key or asking the relay', async () => {
    const stopped = new AbortController();
    stopped.abort();
    const end = await legOnNoRelay().hold(TUNNEL, stopped.signal);
    deepStrictEqual(
      [end, existsSync(path.join(folder, 'host-key'))],
      [{kind: 'stopped'}, false],
    );
  });

  it('a host key file that cannot be read ends the leg with a named reason before the relay is asked, and rejects nothing', async () => {
    writeStateFile(folder, 'host-key', '{not json');
    const end = await legOnNoRelay().hold(TUNNEL, new AbortController().signal);
    deepStrictEqual(
      end.kind === 'ended' &&
        end.reason.startsWith('the host key could not be read: '),
      true,
    );
  });
});

/** What the SDK's host holds that a stand-in for its connect fires events through. */
interface HostEvents {
  forwardConnectionsToLocalPorts: boolean;
  forwardedPortConnectingEmitter: {fire(event: unknown): void};
  connectionStatusChangedEmitter: {fire(event: unknown): void};
}

describe('the SDK host a leg holds, with its connect and its relay lookup stood in (card #3335)', () => {
  const realConnect: unknown = Reflect.get(
    TunnelRelayTunnelHost.prototype,
    'connect',
  );
  const realGetTunnel: unknown = Reflect.get(
    TunnelManagementHttpClient.prototype,
    'getTunnel',
  );
  let folder = '';
  let home = '';

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'agent-sdk-host-'));
    folder = stateFolderOf(home);
    Reflect.set(TunnelManagementHttpClient.prototype, 'getTunnel', () =>
      Promise.resolve({tunnelId: TUNNEL.tunnelId, clusterId: TUNNEL.clusterId}),
    );
  });

  afterEach(() => {
    Reflect.set(TunnelRelayTunnelHost.prototype, 'connect', realConnect);
    Reflect.set(
      TunnelManagementHttpClient.prototype,
      'getTunnel',
      realGetTunnel,
    );
    rmSync(home, {recursive: true, force: true});
  });

  /** Makes the host's connect run `script` on the real host object, then resolve; the SDK opens no connection. */
  function connectRuns(script: (host: HostEvents) => void): void {
    Reflect.set(
      TunnelRelayTunnelHost.prototype,
      'connect',
      function (this: HostEvents) {
        script(this);
        return Promise.resolve();
      },
    );
  }

  /** Tells the host the relay ended its connection with `error`, as the SDK does. */
  function disconnected(host: HostEvents, error?: Error): void {
    host.connectionStatusChangedEmitter.fire(
      new ConnectionStatusChangedEventArgs(
        ConnectionStatus.Connected,
        ConnectionStatus.Disconnected,
        error,
      ),
    );
  }

  /** The end of a leg whose host's connect runs `script`, with `acceptControl` given the control streams. */
  function endOfLeg(
    script: (host: HostEvents) => void,
    acceptControl: (stream: SshStream) => void = () => undefined,
  ) {
    connectRuns(script);
    return relayOf(
      'relay.invalid',
      'a-token',
      folder,
      acceptControl,
    ).hostLeg.hold(TUNNEL, new AbortController().signal);
  }

  it('the host binds no port of this machine for the tunnel’s ports: its forwarding to local ports is off when it connects', async () => {
    const seen: boolean[] = [];
    await endOfLeg(host => {
      seen.push(host.forwardConnectionsToLocalPorts);
      disconnected(host);
    });
    deepStrictEqual(seen, [false]);
  });

  it('a connection to a port other than the control port is destroyed, and the control port’s goes to the control server, not destroyed', async () => {
    const destroyed: number[] = [];
    const accepted: unknown[] = [];
    const streamOf = (port: number): SshStream =>
      ({destroy: () => destroyed.push(port)}) as unknown as SshStream;
    const controlStream = streamOf(CONTROL_PORT);
    await endOfLeg(
      host => {
        for (const port of [2222, CONTROL_PORT]) {
          host.forwardedPortConnectingEmitter.fire({
            port,
            stream: port === CONTROL_PORT ? controlStream : streamOf(port),
          });
        }
        disconnected(host);
      },
      stream => accepted.push(stream),
    );
    deepStrictEqual([destroyed, accepted], [[2222], [controlStream]]);
  });

  it('a host the relay ended for too many connections, another host holding the tunnel, ends the leg as otherHost', async () => {
    const end = await endOfLeg(host => {
      disconnected(
        host,
        new SshConnectionError(
          'too many',
          SshDisconnectReason.tooManyConnections,
        ),
      );
    });
    deepStrictEqual(end, {kind: 'otherHost'});
  });

  it('a host that ended with any other error ends the leg with that error’s message, and one that ended with none says the relay closed the leg', async () => {
    const ends = [
      await endOfLeg(host => {
        disconnected(
          host,
          new SshConnectionError('gone', SshDisconnectReason.connectionLost),
        );
      }),
      await endOfLeg(host => {
        disconnected(host);
      }),
    ];
    deepStrictEqual(ends, [
      {kind: 'ended', reason: 'gone'},
      {kind: 'ended', reason: 'the relay closed the leg'},
    ]);
  });
});
