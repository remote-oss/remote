/**
 * @fileoverview The proxy's tunnel legs over the dev tunnels SDK: the management client for the relay's domain,
 * signed in as the window's GitHub token, finds a tunnel by name with a connect token, and one SDK client per tunnel
 * holds its client leg and opens a stream to any of its ports. No decision lives here: the answers are `handler.ts`'s;
 * the conformance job and the tunnels launch run this file against a relay.
 */

import {TunnelRelayTunnelClient} from '@microsoft/dev-tunnels-connections';
import {TunnelAccessScopes} from '@microsoft/dev-tunnels-contracts';
import {
  ManagementApiVersions,
  type TunnelManagementClient,
  TunnelManagementHttpClient,
} from '@microsoft/dev-tunnels-management';
import type {OpenFailureReason} from 'lib-tunnels';
import type {Access, LegOutcome, TunnelLegs} from './handler.ts';

/** A tunnel's client leg and the token it was opened with. */
interface Held {
  client: TunnelRelayTunnelClient;
  token: string;
}

/** The reason a refusal of the relay gives, by its HTTP status; none for one the relay never answered. */
function reasonOf(status: number | undefined): OpenFailureReason {
  if (status === undefined) {
    return 'unreachable';
  }
  if (status === 401) {
    return 'unauthorized';
  }
  return status === 429 ? 'limit' : 'refused';
}

/** What a failed call shows: the relay's own detail or title, else what its status says; never the request. */
function failureOf(caught: unknown): LegOutcome {
  const response = (
    caught as {
      response?: {status?: number; data?: {detail?: string; title?: string}};
    }
  ).response;
  const status = response?.status;
  return {
    kind: 'failed',
    reason: reasonOf(status),
    detail:
      response?.data?.detail ??
      response?.data?.title ??
      (status === undefined
        ? 'the relay could not be reached'
        : `the relay answered ${String(status)}`),
  };
}

/** The legs to the tunnels of the relay at `domain`, the proxy naming itself by `version`. */
export function sdkLegs(domain: string, version: string): TunnelLegs {
  const held = new Map<string, Held>();

  function managementOf(access: Access): TunnelManagementHttpClient {
    return TunnelManagementHttpClient.forCustomDomain(
      domain,
      [{name: 'remote-oss-tunnel-proxy', version}],
      ManagementApiVersions.Version20230927preview,
      () => Promise.resolve(`github ${access.token}`),
    );
  }

  async function legOf(
    tunnelName: string,
    access: Access,
  ): Promise<Held | LegOutcome> {
    const known = held.get(tunnelName);
    if (known?.token === access.token) {
      return known;
    }
    const management = managementOf(access);
    const tunnels = await management.listTunnels(undefined, undefined, {
      tokenScopes: [TunnelAccessScopes.Connect],
      includePorts: true,
    });
    const tunnel = tunnels.find(each => each.name === tunnelName);
    if (tunnel === undefined) {
      return {
        kind: 'failed',
        reason: 'notFound',
        detail: `no tunnel ${tunnelName}`,
      };
    }
    const client = new TunnelRelayTunnelClient(
      management as TunnelManagementClient,
    );
    client.acceptLocalConnectionsForForwardedPorts = false;
    await client.connect(tunnel);
    const opened = {client, token: access.token};
    held.set(tunnelName, opened);
    return opened;
  }

  return {
    async stream(tunnelName, port, access) {
      try {
        const found = await legOf(tunnelName, access);
        if ('kind' in found) {
          return found;
        }
        await found.client.waitForForwardedPort(port);
        return {
          kind: 'stream',
          stream: await found.client.connectToForwardedPort(port),
        };
      } catch (caught) {
        return failureOf(caught);
      }
    },
  };
}
