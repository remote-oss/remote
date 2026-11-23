/**
 * @fileoverview The T.6 spike's client: `[dev-tunnels]`'s TypeScript client (the Remote - Tunnels extension's path) on
 * the spike's relay. Its SSH session with the host runs end to end through the relay's client leg. It sends a fixed
 * payload through the host's forwarded echo port and prints the byte count and SHA-256 both ways, and the times.
 */

import {createHash} from 'node:crypto';
import connections from '@microsoft/dev-tunnels-connections';
import management from '@microsoft/dev-tunnels-management';

const {TunnelRelayTunnelClient} = connections;
const {TunnelManagementHttpClient, ManagementApiVersions} = management;

const domain = required('RELAY_DOMAIN');
const tunnelId = required('TUNNEL_ID');
const echoPort = Number(required('ECHO_PORT'));
const label = process.env.HOST_LABEL ?? 'host';

/** The payload: 64 KiB of bytes fixed by their index, the same in every run. */
const PAYLOAD = Buffer.from(
  Array.from({length: 64 * 1024}, (_, index) => (index * 31 + 7) % 256),
);

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function say(text: string): void {
  process.stdout.write(`client (${label}): ${text}\n`);
}

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const managementClient = new TunnelManagementHttpClient(
  'tunnel-relay-t6-client',
  ManagementApiVersions.Version20230927preview,
  () => Promise.resolve('github spike-test-token'),
  `https://cp.${domain}/`,
);
const tunnel = await managementClient.getTunnel(
  {tunnelId, clusterId: 'spike1'},
  {tokenScopes: ['connect'], includePorts: true},
);
if (tunnel === null) {
  throw new Error(`tunnel ${tunnelId} not found`);
}

const client = new TunnelRelayTunnelClient();
client.acceptLocalConnectionsForForwardedPorts = false;
if (process.env.TRACE === '1') {
  client.trace = (level, eventId, message, error) => {
    say(`trace ${String(level)} ${String(eventId)}: ${message}${error === undefined ? '' : ` (${String(error)})`}`);
  };
}
const connecting = Date.now();
await client.connect(tunnel);
say(`connected through the client leg in ${String(Date.now() - connecting)} ms`);
await client.waitForForwardedPort(echoPort);
const stream = await client.connectToForwardedPort(echoPort);

const sent = Date.now();
const received: Buffer[] = [];
let count = 0;
const echoed = new Promise<Buffer>((resolve, reject) => {
  stream.on('data', (chunk: Buffer) => {
    received.push(chunk);
    count += chunk.length;
    if (count >= PAYLOAD.length) {
      resolve(Buffer.concat(received));
    }
  });
  stream.on('error', reject);
  stream.on('end', () => reject(new Error(`ended after ${String(count)} bytes`)));
  stream.on('close', () => reject(new Error(`closed after ${String(count)} bytes`)));
  // The timer also keeps the process alive while the echo is on its way.
  const waiting = setTimeout(() => reject(new Error(`no echo after ${String(count)} bytes in 15 s`)), 15_000);
  stream.on('data', () => {
    if (count >= PAYLOAD.length) {
      clearTimeout(waiting);
    }
  });
});
stream.write(PAYLOAD);
const back = await echoed;
const roundTrip = Date.now() - sent;
const same = back.length === PAYLOAD.length && digest(back) === digest(PAYLOAD);
say(`sent ${String(PAYLOAD.length)} bytes sha256 ${digest(PAYLOAD)}`);
say(`back ${String(back.length)} bytes sha256 ${digest(back)}`);
say(`round trip ${String(roundTrip)} ms: ${same ? 'PIPE OK' : 'PIPE MISMATCH'}`);
stream.destroy();
await client.dispose();
process.exit(same ? 0 : 1);
