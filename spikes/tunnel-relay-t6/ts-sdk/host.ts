/**
 * @fileoverview The T.6 spike's TypeScript host: `[dev-tunnels]`'s own TypeScript host (ts/, the V1 protocol, whose
 * host leg is a dev-tunnels-ssh client session with no security) on the spike's relay, forwarding one port to an echo
 * service beside it. It creates the tunnel with the port, connects, and stays until it is stopped.
 */

import {createServer} from 'node:net';
import connections from '@microsoft/dev-tunnels-connections';
import management from '@microsoft/dev-tunnels-management';

const {TunnelRelayTunnelHost} = connections;
const {TunnelManagementHttpClient, ManagementApiVersions} = management;

const domain = required('RELAY_DOMAIN');
const tunnelId = required('TUNNEL_ID');
const echoPort = Number(required('ECHO_PORT'));

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function say(text: string): void {
  process.stdout.write(`ts-host: ${text}\n`);
}

const echo = createServer(socket => socket.pipe(socket));
await new Promise<void>(resolve => echo.listen(echoPort, '127.0.0.1', resolve));
say(`echo service on 127.0.0.1:${String(echoPort)}`);

const managementClient = new TunnelManagementHttpClient(
  'tunnel-relay-t6-ts-host',
  ManagementApiVersions.Version20230927preview,
  () => Promise.resolve('github spike-test-token'),
  `https://cp.${domain}/`,
);
const tunnel = await managementClient.createTunnel(
  {tunnelId, ports: [{portNumber: echoPort, protocol: 'auto'}]},
  {tokenScopes: ['host', 'connect'], includePorts: true},
);
say(`tunnel ${String(tunnel.tunnelId)} in ${String(tunnel.clusterId)}`);

const host = new TunnelRelayTunnelHost(managementClient);
if (process.env.TRACE === '1') {
  host.trace = (level, eventId, message, error) => {
    say(`trace ${String(level)} ${String(eventId)}: ${message}${error === undefined ? '' : ` (${String(error)})`}`);
  };
}
const started = Date.now();
await host.connect(tunnel);
say(`host leg connected in ${String(Date.now() - started)} ms`);

process.on('SIGTERM', () => {
  host.dispose();
  echo.close();
});
