/**
 * @fileoverview The T.6 spike's relay: the dev tunnels management routes the hosts and the client call before their
 * legs open, the host leg as a dev-tunnels-ssh server session with no security (key exchange, host key and cipher all
 * `none`), and the client leg piped unread through a `client-ssh-session-stream` channel of the host's session.
 * Sources: `[dev-tunnels]` at 64048c1409ff (ADR-0014), the relay brief's sections 2 and 5. A spike: nothing merges.
 */

import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createServer, type IncomingMessage, type ServerResponse} from 'node:https';
import ssh from '@microsoft/dev-tunnels-ssh';
import {WebSocketServer, type WebSocket} from 'ws';

const {SshServerSession, SshSessionConfiguration, WebSocketStream, SshDisconnectReason} = ssh;

const API_VERSION = '2023-09-27-preview';
const CLUSTER_ID = 'spike1';
const HOST_PROTOCOL = 'tunnel-relay-host';
const CLIENT_PROTOCOL = 'tunnel-relay-client';
const CLIENT_CHANNEL = 'client-ssh-session-stream';

const domain = required('RELAY_DOMAIN');
const port = Number(process.env.RELAY_PORT ?? '443');
const authority = port === 443 ? domain : `${domain}:${String(port)}`;

/** The relay's readout: one line per event, prefixed, for the run's log. */
function say(text: string): void {
  process.stdout.write(`relay: ${text}\n`);
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set`);
  }
  return value;
}

interface Port {
  portNumber: number;
  protocol?: string;
  [field: string]: unknown;
}

interface Endpoint {
  id: string;
  connectionMode: string;
  hostId: string;
  hostPublicKeys?: string[];
  [field: string]: unknown;
}

interface TunnelRecord {
  fields: Record<string, unknown>;
  ports: Map<number, Port>;
  endpoints: Map<string, Endpoint>;
}

const tunnels = new Map<string, TunnelRecord>();

type Session = InstanceType<typeof SshServerSession>;
const hostSessions = new Map<string, Session>();

/** A test token for a scope: a JWT whose only claim the SDKs read is `exp`; nothing checks its signature here. */
function tokenFor(tunnelId: string, scope: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const claims = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    scp: scope,
    tid: tunnelId,
    cid: CLUSTER_ID,
  };
  return `${encode({alg: 'none', typ: 'JWT'})}.${encode(claims)}.${randomBytes(8).toString('base64url')}`;
}

function endpointView(tunnelId: string, endpoint: Endpoint): Endpoint {
  return {
    ...endpoint,
    hostRelayUri: `wss://${authority}/relay/host/${tunnelId}`,
    clientRelayUri: `wss://${authority}/relay/client/${tunnelId}`,
    portUriFormat: `https://${tunnelId}-{port}.${domain}/`,
  };
}

function tunnelView(
  tunnelId: string,
  record: TunnelRecord,
  scopes: readonly string[],
): Record<string, unknown> {
  return {
    ...record.fields,
    tunnelId,
    clusterId: CLUSTER_ID,
    ports: [...record.ports.values()],
    endpoints: [...record.endpoints.values()].map(each =>
      endpointView(tunnelId, each),
    ),
    ...(scopes.length === 0
      ? {}
      : {
          accessTokens: Object.fromEntries(
            scopes.map(scope => [scope, tokenFor(tunnelId, scope)]),
          ),
        }),
  };
}

function answer(response: ServerResponse, status: number, body?: unknown): void {
  response.statusCode = status;
  response.setHeader('VsSaaS-Request-Id', randomBytes(8).toString('hex'));
  if (body === undefined) {
    response.end();
    return;
  }
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

function problem(response: ServerResponse, status: number, detail: string): void {
  answer(response, status, {title: 'Request failed', detail});
}

async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : (JSON.parse(text) as Record<string, unknown>);
}

/** The management routes of brief section 2 that the hosts and the client call before their legs open. */
async function manage(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `https://${authority}`);
  if (url.searchParams.get('api-version') !== API_VERSION) {
    problem(response, 400, `The api-version must be ${API_VERSION}.`);
    return;
  }
  const scopes = (url.searchParams.get('tokenScopes') ?? '')
    .split(',')
    .filter(scope => scope !== '');
  const parts = url.pathname.split('/').filter(part => part !== '');
  const method = request.method ?? 'GET';
  say(`${method} ${url.pathname}${url.search === '' ? '' : ` (${[...url.searchParams.keys()].join(',')})`}`);
  if (parts[0] !== 'tunnels' || parts[1] === undefined) {
    problem(response, 404, 'No such route.');
    return;
  }
  const tunnelId = decodeURIComponent(parts[1]).toLowerCase();
  const record = tunnels.get(tunnelId);
  const [, , sub, item] = parts;
  if (sub === undefined) {
    if (method === 'PUT') {
      const fields = await bodyOf(request);
      if (record !== undefined && request.headers['if-none-match'] === '*') {
        problem(response, 409, 'A tunnel with this id exists.');
        return;
      }
      const next: TunnelRecord = record ?? {
        fields: {},
        ports: new Map(),
        endpoints: new Map(),
      };
      for (const [key, value] of Object.entries(fields)) {
        if (!['ports', 'endpoints', 'accessTokens', 'tunnelId', 'clusterId'].includes(key)) {
          next.fields[key] = value;
        }
      }
      for (const each of (fields.ports as Port[] | undefined) ?? []) {
        next.ports.set(each.portNumber, each);
      }
      tunnels.set(tunnelId, next);
      answer(response, 200, tunnelView(tunnelId, next, scopes));
      return;
    }
    if (record === undefined) {
      problem(response, 404, 'No such tunnel.');
      return;
    }
    if (method === 'GET') {
      answer(response, 200, tunnelView(tunnelId, record, scopes));
      return;
    }
    if (method === 'DELETE') {
      tunnels.delete(tunnelId);
      answer(response, 200);
      return;
    }
  }
  if (record === undefined) {
    problem(response, 404, 'No such tunnel.');
    return;
  }
  if (sub === 'endpoints' && item !== undefined) {
    if (method === 'PUT') {
      const endpoint = (await bodyOf(request)) as unknown as Endpoint;
      record.endpoints.set(item, {...endpoint, id: item});
      answer(response, 200, endpointView(tunnelId, record.endpoints.get(item) as Endpoint));
      return;
    }
    if (method === 'DELETE') {
      const known =
        record.endpoints.delete(item) || record.endpoints.delete(`${item}-relay`);
      answer(response, known ? 200 : 404);
      return;
    }
  }
  if (sub === 'ports') {
    if (item === undefined && method === 'GET') {
      answer(response, 200, {value: [...record.ports.values()]});
      return;
    }
    const portNumber = Number(item);
    if (method === 'PUT') {
      const portRecord = (await bodyOf(request)) as unknown as Port;
      const existing = record.ports.get(portNumber);
      if (existing?.protocol !== undefined && portRecord.protocol !== undefined && existing.protocol !== portRecord.protocol) {
        problem(response, 400, 'The tunnel port protocol cannot be changed.');
        return;
      }
      record.ports.set(portNumber, {...existing, ...portRecord, portNumber});
      answer(response, 200, record.ports.get(portNumber));
      return;
    }
    if (method === 'GET') {
      const found = record.ports.get(portNumber);
      if (found === undefined) {
        problem(response, 404, 'No such port.');
        return;
      }
      answer(response, 200, found);
      return;
    }
    if (method === 'DELETE') {
      answer(response, record.ports.delete(portNumber) ? 200 : 404);
      return;
    }
  }
  problem(response, 404, 'No such route.');
}

/** The negotiated security of a host session, read from the session: `none` where no algorithm was set up. */
function securityOf(session: Session): string {
  const algorithms = session.algorithms;
  const kex = session.sessionId === null ? 'none' : 'negotiated';
  const hostKey = algorithms?.publicKeyAlgorithmName ?? 'none';
  const cipher = algorithms?.cipher?.constructor.name ?? 'none';
  const mac = algorithms?.messageSigner?.constructor.name ?? 'none';
  return `kex=${kex} hostKey=${hostKey} cipher=${cipher} mac=${mac}`;
}

/** The host leg: the relay is the SSH server of the host's session, with no security, and keeps it for clients. */
async function hostLeg(socket: WebSocket, tunnelId: string, agent: string): Promise<void> {
  const started = Date.now();
  socket.binaryType = 'arraybuffer';
  const session = new SshServerSession(new SshSessionConfiguration(false));
  session.onAuthenticating(event => {
    event.authenticationPromise = Promise.resolve({});
  });
  session.onClosed(event => {
    say(`host leg ${tunnelId} closed: ${String(event.reason)} ${event.message ?? ''}`);
    if (hostSessions.get(tunnelId) === session) {
      hostSessions.delete(tunnelId);
    }
  });
  try {
    await session.connect(new WebSocketStream(socket as never));
  } catch (caught) {
    say(`host leg ${tunnelId} FAILED after ${String(Date.now() - started)} ms (${agent}): ${String(caught)}`);
    socket.close();
    return;
  }
  hostSessions.set(tunnelId, session);
  say(`host leg ${tunnelId} connected in ${String(Date.now() - started)} ms (${agent}): ${securityOf(session)}`);
}

/** The client leg: a channel of the host's session per client, its bytes piped both ways and never read. */
async function clientLeg(socket: WebSocket, tunnelId: string): Promise<void> {
  const session = hostSessions.get(tunnelId);
  if (session === undefined) {
    say(`client leg ${tunnelId} refused: no host`);
    socket.close(1011, 'No host is connected.');
    return;
  }
  // The client speaks as soon as its socket opens, before the channel is open: its bytes wait for the channel.
  let toHost = 0;
  let toClient = 0;
  const opened = Date.now();
  const opening = session.openChannel(CLIENT_CHANNEL);
  let sending: Promise<unknown> = opening;
  socket.on('message', (data: Buffer) => {
    toHost += data.length;
    sending = sending
      .then(() => opening)
      .then(open => open.send(data))
      .catch(() => undefined);
  });
  const channel = await opening;
  say(`client leg ${tunnelId}: ${CLIENT_CHANNEL} channel ${String(channel.channelId)} open in ${String(Date.now() - opened)} ms`);
  channel.onDataReceived(data => {
    toClient += data.length;
    socket.send(data);
    channel.adjustWindow(data.length);
  });
  const ended = (side: string) => {
    say(`client leg ${tunnelId} ended by the ${side}: ${String(toHost)} bytes to the host, ${String(toClient)} to the client`);
  };
  socket.on('close', () => {
    ended('client');
    void channel.close().catch(() => undefined);
  });
  channel.onClosed(() => {
    ended('host');
    socket.close();
  });
}

const server = createServer(
  {cert: readFileSync(required('TLS_CERT')), key: readFileSync(required('TLS_KEY'))},
  (request, response) => {
    manage(request, response).catch((caught: unknown) => {
      problem(response, 500, String(caught));
    });
  },
);

const legs = new WebSocketServer({
  noServer: true,
  handleProtocols: protocols =>
    [HOST_PROTOCOL, CLIENT_PROTOCOL].find(each => protocols.has(each)) ?? false,
});

server.on('upgrade', (request, socket, head) => {
  const [, relay, side, tunnelId] = new URL(request.url ?? '/', `https://${authority}`).pathname.split('/');
  const wanted = side === 'host' ? HOST_PROTOCOL : CLIENT_PROTOCOL;
  const offered = (request.headers['sec-websocket-protocol'] ?? '').split(',').map(each => each.trim());
  if (relay !== 'relay' || tunnelId === undefined || !offered.includes(wanted)) {
    say(`upgrade refused: ${request.url ?? ''} offering ${offered.join(',')}`);
    socket.destroy();
    return;
  }
  legs.handleUpgrade(request, socket, head, websocket => {
    const agent = request.headers['user-agent'] ?? 'no user agent';
    if (side === 'host') {
      void hostLeg(websocket, tunnelId, agent);
    } else {
      void clientLeg(websocket, tunnelId);
    }
  });
});

server.listen(port, () => {
  say(`listening on ${authority}, api-version ${API_VERSION}, cluster ${CLUSTER_ID}`);
});

process.on('SIGTERM', () => {
  for (const session of hostSessions.values()) {
    void session.close(SshDisconnectReason.byApplication, 'relay stopping');
  }
  server.close();
});

