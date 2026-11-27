/**
 * @fileoverview The agent's relay over the dev tunnels SDK: the management client for the relay's domain, signed in as
 * the stored GitHub token, and the SDK's host for the tunnel's host leg, with the host key kept in the state folder. No
 * decision lives here: the registration is `tunnel.ts` and the leg's end is `serve.ts`; the conformance job runs this
 * file against a relay.
 */

import {
  ConnectionStatus,
  TunnelRelayTunnelHost,
} from '@microsoft/dev-tunnels-connections';
import {
  TunnelAccessScopes,
  type Tunnel,
} from '@microsoft/dev-tunnels-contracts';
import {
  ManagementApiVersions,
  type TunnelManagementClient,
  TunnelManagementHttpClient,
} from '@microsoft/dev-tunnels-management';
import {
  BigInt as SshBigInt,
  type KeyPair,
  type RsaParameters,
  SshAlgorithms,
  SshDisconnectReason,
  SshConnectionError,
  type SshStream,
} from '@microsoft/dev-tunnels-ssh';
import {Buffer} from 'node:buffer';
import manifest from '../package.json' with {type: 'json'};
import {
  CONTROL_PORT,
  RelayError,
  type RelayTunnel,
  type TunnelService,
} from './relay.ts';
import type {TunnelPorts} from './control/ports.ts';
import type {HostEnd, HostLeg} from './serve.ts';
import {readStateFile, writeStateFile} from './state.ts';

/** The numbers of an RSA key as the state folder keeps them: each as base64 of its signed bytes. */
type StoredKey = Record<keyof RsaParameters, string>;

const KEY_FIELDS: ReadonlyArray<keyof RsaParameters> = [
  'modulus',
  'exponent',
  'd',
  'p',
  'q',
  'dp',
  'dq',
  'qi',
];

/** The text a refusal shows: the relay's own detail or title, else what its status says; never the request. */
function refusalOf(caught: unknown): RelayError {
  const response = (
    caught as {
      response?: {status?: number; data?: {detail?: string; title?: string}};
    }
  ).response;
  if (response?.status === undefined) {
    const code = (caught as {code?: unknown}).code;
    return new RelayError(
      0,
      `the relay could not be reached${typeof code === 'string' ? ` (${code})` : ''}`,
    );
  }
  return new RelayError(
    response.status,
    response.data?.detail ??
      response.data?.title ??
      `the relay answered ${String(response.status)}`,
  );
}

/** Runs `request`, turning a failure of the relay's service into a `RelayError`. */
async function relayed<Result>(
  request: () => Promise<Result>,
): Promise<Result> {
  try {
    return await request();
  } catch (caught) {
    throw refusalOf(caught);
  }
}

/** The tunnel as the agent holds it. */
function relayTunnelOf(tunnel: Tunnel, name: string): RelayTunnel {
  return {
    tunnelId: tunnel.tunnelId ?? '',
    clusterId: tunnel.clusterId ?? '',
    name: tunnel.name ?? name,
    ports: (tunnel.ports ?? []).map(port => port.portNumber),
  };
}

/** The management client for the relay at `domain`, which signs in as the GitHub account of `token`. */
function clientOf(domain: string, token: string): TunnelManagementHttpClient {
  return TunnelManagementHttpClient.forCustomDomain(
    domain,
    [{name: 'remote-oss-tunnel-agent', version: manifest.version}],
    ManagementApiVersions.Version20230927preview,
    () => Promise.resolve(`github ${token}`),
  );
}

/** The relay's management service over `client`. */
function serviceOf(client: TunnelManagementHttpClient): TunnelService {
  return {
    get: (tunnelId, clusterId) =>
      relayed(async () => {
        const found = await client.getTunnel(
          {tunnelId, clusterId},
          {includePorts: true},
        );
        return found === null ? undefined : relayTunnelOf(found, '');
      }),
    create: name =>
      relayed(async () =>
        relayTunnelOf(await client.createTunnel({name}), name),
      ),
    rename: (tunnelId, clusterId, name) =>
      relayed(async () => {
        await client.updateTunnel({tunnelId, clusterId, name});
      }),
    delete: (tunnelId, clusterId) =>
      relayed(() => client.deleteTunnel({tunnelId, clusterId})),
    addPort: (tunnelId, clusterId, port) =>
      relayed(async () => {
        await client.createTunnelPort(
          {tunnelId, clusterId},
          {portNumber: port, protocol: 'auto'},
        );
      }),
  };
}

/** The host's key from the state folder, made and kept when there is none: the same key at every start. */
async function hostKeyOf(folder: string): Promise<KeyPair> {
  const algorithm = SshAlgorithms.publicKey.rsaWithSha512;
  if (algorithm === null || algorithm === undefined) {
    throw new Error('the SSH library has no RSA key algorithm');
  }
  const keyPair = algorithm.createKeyPair();
  const kept = readStateFile(folder, 'host-key');
  if (kept === undefined) {
    await keyPair.generate();
    const parameters = (await keyPair.exportParameters()) as RsaParameters;
    const stored = Object.fromEntries(
      KEY_FIELDS.map(field => [
        field,
        parameters[field]?.toBytes().toString('base64') ?? '',
      ]),
    );
    writeStateFile(folder, 'host-key', `${JSON.stringify(stored)}\n`);
    return keyPair;
  }
  const stored = JSON.parse(kept) as StoredKey;
  await keyPair.importParameters(
    Object.fromEntries(
      KEY_FIELDS.filter(field => stored[field] !== '').map(field => [
        field,
        new SshBigInt(Buffer.from(stored[field], 'base64')),
      ]),
    ),
  );
  return keyPair;
}

/** How the SDK's host ended, from the error it ended with. */
function endOf(error: Error | undefined): HostEnd {
  return error instanceof SshConnectionError &&
    error.reason === SshDisconnectReason.tooManyConnections
    ? {kind: 'otherHost'}
    : {kind: 'ended', reason: error?.message ?? 'the relay closed the leg'};
}

/** The host leg over the SDK's host, which reconnects in place and refreshes its token until it ends for good. */
function legOf(
  client: TunnelManagementHttpClient,
  folder: string,
  acceptControl: (stream: SshStream, tunnel: RelayTunnel) => void,
): HostLeg {
  return {
    hold: async (tunnel, stop) => {
      const host = new TunnelRelayTunnelHost(client as TunnelManagementClient);
      // Nothing binds a port of this machine: the control port's connections go to the control server, any other closes.
      host.forwardConnectionsToLocalPorts = false;
      host.forwardedPortConnecting(forwarded => {
        if (forwarded.port === CONTROL_PORT) {
          acceptControl(forwarded.stream, tunnel);
        } else {
          forwarded.stream.destroy();
        }
      });
      host.hostPrivateKeyPromise = hostKeyOf(folder);
      const ended = new Promise<HostEnd>(resolve => {
        host.connectionStatusChanged(change => {
          if (change.status === ConnectionStatus.Disconnected) {
            resolve(endOf(change.disconnectError));
          }
        });
        stop.addEventListener('abort', () => {
          resolve({kind: 'stopped'});
        });
      });
      const hosted = await relayed(() =>
        client.getTunnel(
          {tunnelId: tunnel.tunnelId, clusterId: tunnel.clusterId},
          {includePorts: true, tokenScopes: [TunnelAccessScopes.Host]},
        ),
      );
      if (hosted === null) {
        return {kind: 'ended', reason: 'the relay no longer has the tunnel'};
      }
      await host.connect(hosted);
      const end = await ended;
      await host.dispose();
      return end;
    },
  };
}

/** What the agent has of the relay at `domain`, signed in with `token`, keeping its host key in `folder`. */
export interface Relay {
  service: TunnelService;
  hostLeg: HostLeg;
  /** The ports of `tunnel`. */
  portsOf(tunnel: RelayTunnel): TunnelPorts;
}

/**
 * The relay at `domain` for the account of `token`. The host leg hands each connection to the control port to
 * `acceptControl` with the tunnel it serves, and closes the connections to every other port.
 */
export function relayOf(
  domain: string,
  token: string,
  folder: string,
  acceptControl: (stream: SshStream, tunnel: RelayTunnel) => void,
): Relay {
  const client = clientOf(domain, token);
  const service = serviceOf(client);
  return {
    service,
    hostLeg: legOf(client, folder, acceptControl),
    portsOf: tunnel => ({
      addPrivate: port =>
        service.addPort(tunnel.tunnelId, tunnel.clusterId, port),
      remove: port =>
        relayed(async () => {
          await client.deleteTunnelPort(
            {tunnelId: tunnel.tunnelId, clusterId: tunnel.clusterId},
            port,
          );
        }),
    }),
  };
}
