/**
 * @fileoverview The management routes of the relay brief's section 2, over the store: tunnels, their names, ports and
 * hosts' endpoints, for the caller's own tunnels only. A request reaches the routes parsed; the server reads and writes
 * the wire. Sources: `[dev-tunnels] rs/src/management/http_client.rs:38-42,61-307` and `[cli] tunnels/dev_tunnels.rs`.
 */

import {problem, success, type Answer} from './problem.ts';
import type {RelayConfig} from './config.ts';
import {areLabels, isTunnelId, isTunnelName, MAX_DESCRIPTION} from './names.ts';
import type {Store, TunnelRecord} from './store.ts';

/** The only API version the relay serves (`http_client.rs:44,684-685`). */
export const API_VERSION = '2023-09-27-preview';

/** The account a request acts for: a GitHub account, by its numeric id. */
export interface Caller {
  id: number;
  login: string;
}

/** Who a request is from: its caller, or the answer that refuses it. */
export type Authenticate = (
  headers: Readonly<Record<string, string | undefined>>,
) => Promise<Caller | Answer>;

/** A request as the routes take it. */
export interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}

/** What the routes work with. */
export interface RouteContext {
  store: Store;
  config: RelayConfig;
  authenticate: Authenticate;
}

/** The tunnel fields a client sends that the relay sets itself, ignored on a write. */
const READ_ONLY = new Set([
  'tunnelId',
  'clusterId',
  'name',
  'ports',
  'endpoints',
  'accessTokens',
  'status',
  'created',
]);

const CHECK_NAME = ':checkNameAvailability';

/** Answers `request`. */
export async function route(
  request: Request,
  context: RouteContext,
): Promise<Answer> {
  if (request.query.get('api-version') !== API_VERSION) {
    return problem(400, `The api-version must be ${API_VERSION}.`);
  }
  const parts = request.path.split('/').filter(part => part !== '');
  if (parts[0] !== 'tunnels' || parts.length > 4) {
    return problem(404, 'There is no such route.');
  }
  const caller = await context.authenticate(request.headers);
  if (!('id' in caller)) {
    return caller;
  }
  const [, tunnelPart, section, item] = parts.map(decodeURIComponent);
  if (tunnelPart === undefined) {
    return request.method === 'GET'
      ? listTunnels(request.query, caller, context)
      : problem(404, 'There is no such route.');
  }
  if (tunnelPart.endsWith(CHECK_NAME) && section === undefined) {
    return request.method === 'GET'
      ? success(
          nameAvailable(
            tunnelPart.slice(0, -CHECK_NAME.length),
            caller,
            context,
          ),
        )
      : problem(404, 'There is no such route.');
  }
  if (section === undefined) {
    return tunnelRoute(request, tunnelPart.toLowerCase(), caller, context);
  }
  const tunnel = ownTunnel(tunnelPart.toLowerCase(), caller, context);
  if (tunnel === undefined) {
    return problem(404, 'There is no such tunnel.');
  }
  if (section === 'endpoints' && item !== undefined) {
    return endpointRoute(request, tunnel, item, context);
  }
  if (section === 'ports') {
    return portRoute(request, tunnel, item, context);
  }
  return problem(404, 'There is no such route.');
}

/** The caller's tunnel with id or name `idOrName`, or none: another account's tunnel is not found. */
function ownTunnel(
  idOrName: string,
  caller: Caller,
  {store}: RouteContext,
): TunnelRecord | undefined {
  const byId = store.tunnelById(idOrName);
  if (byId !== undefined) {
    return byId.owner === caller.id ? byId : undefined;
  }
  return store.tunnelByName(caller.id, idOrName);
}

function nameAvailable(
  name: string,
  caller: Caller,
  {store}: RouteContext,
): boolean {
  const lower = name.toLowerCase();
  return (
    lower !== '' &&
    isTunnelName(lower) &&
    store.tunnelByName(caller.id, lower) === undefined
  );
}

/** The caller's tunnels in the by-region shape (`contracts/tunnel_list_by_region_response.rs:11-18`). */
function listTunnels(
  query: URLSearchParams,
  caller: Caller,
  context: RouteContext,
): Answer {
  const wanted = (query.get('labels') ?? '')
    .split(',')
    .filter(label => label !== '');
  const every = query.get('allLabels') === 'true';
  const limit = Number(query.get('limit') ?? Infinity);
  const tunnels = context.store
    .tunnelsOf(caller.id)
    .filter(tunnel => {
      if (wanted.length === 0) {
        return true;
      }
      const labels = (tunnel.fields.labels as string[] | undefined) ?? [];
      return every
        ? wanted.every(label => labels.includes(label))
        : wanted.some(label => labels.includes(label));
    })
    .slice(0, Number.isInteger(limit) && limit >= 0 ? limit : undefined)
    .map(tunnel => tunnelView(tunnel, query, context));
  return success({
    value: [
      {
        regionName: context.config.clusterId,
        clusterId: context.config.clusterId,
        value: tunnels,
      },
    ],
  });
}

function tunnelRoute(
  request: Request,
  idOrName: string,
  caller: Caller,
  context: RouteContext,
): Answer {
  if (request.method === 'PUT') {
    return putTunnel(request, idOrName, caller, context);
  }
  const tunnel = ownTunnel(idOrName, caller, context);
  if (tunnel === undefined) {
    return problem(404, 'There is no such tunnel.');
  }
  if (request.method === 'GET') {
    return success(tunnelView(tunnel, request.query, context));
  }
  if (request.method === 'DELETE') {
    context.store.deleteTunnel(tunnel.id);
    return success();
  }
  return problem(404, 'There is no such route.');
}

/** Creates the tunnel with the client's id, or updates the caller's own with merge semantics. */
function putTunnel(
  request: Request,
  tunnelId: string,
  caller: Caller,
  context: RouteContext,
): Answer {
  if (!isTunnelId(tunnelId)) {
    return problem(400, 'The tunnel id is not valid.');
  }
  const body = objectOf(request.body);
  if (body === undefined) {
    return problem(400, 'The body must be a tunnel.');
  }
  const invalid = fieldProblem(body);
  if (invalid !== undefined) {
    return invalid;
  }
  const {store} = context;
  const existing = store.tunnelById(tunnelId);
  if (existing !== undefined && existing.owner !== caller.id) {
    return problem(409, 'The tunnel id is taken.');
  }
  if (existing !== undefined && request.headers['if-none-match'] === '*') {
    return problem(409, 'The tunnel exists.');
  }
  const name =
    typeof body.name === 'string'
      ? body.name.toLowerCase()
      : (existing?.name ?? '');
  const force = request.query.get('forceRename') === 'true';
  return store.transaction(() => {
    const holder = store.tunnelByName(caller.id, name);
    if (holder !== undefined && holder.id !== tunnelId) {
      if (!force) {
        return problem(409, 'The tunnel name is taken.');
      }
      store.putTunnel({...holder, name: ''});
    }
    const record: TunnelRecord = {
      id: tunnelId,
      owner: caller.id,
      name,
      fields: {...existing?.fields, ...writable(body)},
    };
    store.putTunnel(record);
    for (const port of (body.ports as unknown[] | undefined) ?? []) {
      const fields = objectOf(port);
      if (fields !== undefined && typeof fields.portNumber === 'number') {
        store.putPort(tunnelId, fields.portNumber, {
          ...store.port(tunnelId, fields.portNumber),
          ...fields,
        });
      }
    }
    return success(tunnelView(record, request.query, context));
  });
}

/** The answer that refuses a tunnel body's name, labels or description, or none. */
function fieldProblem(body: Record<string, unknown>): Answer | undefined {
  if (
    body.name !== undefined &&
    (typeof body.name !== 'string' || !isTunnelName(body.name))
  ) {
    return problem(400, 'The tunnel name is not valid.');
  }
  if (
    body.labels !== undefined &&
    (!Array.isArray(body.labels) || !areLabels(body.labels))
  ) {
    return problem(400, 'The tunnel labels are not valid.');
  }
  if (
    body.description !== undefined &&
    (typeof body.description !== 'string' ||
      body.description.length > MAX_DESCRIPTION)
  ) {
    return problem(400, 'The tunnel description is not valid.');
  }
  return undefined;
}

function writable(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !READ_ONLY.has(key)),
  );
}

function endpointRoute(
  request: Request,
  tunnel: TunnelRecord,
  endpointId: string,
  context: RouteContext,
): Answer {
  const {store} = context;
  if (request.method === 'PUT') {
    if (request.query.get('connectionMode') !== 'TunnelRelay') {
      return problem(400, 'The connection mode must be TunnelRelay.');
    }
    const body = objectOf(request.body);
    if (body === undefined) {
      return problem(400, 'The body must be an endpoint.');
    }
    const fields = {...body, id: endpointId};
    store.putEndpoint(tunnel.id, endpointId, fields);
    return success(endpointView(tunnel.id, fields, context.config));
  }
  if (request.method === 'DELETE') {
    const removed =
      store.deleteEndpoint(tunnel.id, endpointId) ||
      store.deleteEndpoint(tunnel.id, `${endpointId}-relay`);
    return removed ? success() : problem(404, 'There is no such endpoint.');
  }
  return problem(404, 'There is no such route.');
}

function portRoute(
  request: Request,
  tunnel: TunnelRecord,
  item: string | undefined,
  context: RouteContext,
): Answer {
  const {store} = context;
  if (item === undefined) {
    return request.method === 'GET'
      ? success({
          value: store
            .portsOf(tunnel.id)
            .map(port => portView(tunnel, port, context.config)),
        })
      : problem(404, 'There is no such route.');
  }
  const number = Number(item);
  if (!Number.isInteger(number) || number < 1 || number > 65535) {
    return problem(400, 'The port number is not valid.');
  }
  const existing = store.port(tunnel.id, number);
  if (request.method === 'PUT') {
    const body = objectOf(request.body);
    if (body === undefined) {
      return problem(400, 'The body must be a port.');
    }
    if (
      existing?.protocol !== undefined &&
      body.protocol !== undefined &&
      existing.protocol !== body.protocol
    ) {
      return problem(400, 'The tunnel port protocol cannot be changed.');
    }
    const fields = {...existing, ...body, portNumber: number};
    store.putPort(tunnel.id, number, fields);
    return success(portView(tunnel, fields, context.config));
  }
  if (existing === undefined) {
    return problem(404, 'There is no such port.');
  }
  if (request.method === 'GET') {
    return success(portView(tunnel, existing, context.config));
  }
  if (request.method === 'DELETE') {
    store.deletePort(tunnel.id, number);
    return success();
  }
  return problem(404, 'There is no such route.');
}

/** A tunnel as the clients read it: `clusterId` and `tunnelId` always, ports when asked for, every endpoint. */
function tunnelView(
  tunnel: TunnelRecord,
  query: URLSearchParams,
  {store, config}: RouteContext,
): Record<string, unknown> {
  return {
    ...tunnel.fields,
    tunnelId: tunnel.id,
    clusterId: config.clusterId,
    ...(tunnel.name === '' ? {} : {name: tunnel.name}),
    ...(query.get('includePorts') === 'true'
      ? {
          ports: store
            .portsOf(tunnel.id)
            .map(port => portView(tunnel, port, config)),
        }
      : {}),
    endpoints: store
      .endpointsOf(tunnel.id)
      .map(endpoint => endpointView(tunnel.id, endpoint, config)),
  };
}

function portView(
  tunnel: TunnelRecord,
  port: Record<string, unknown>,
  config: RelayConfig,
): Record<string, unknown> {
  return {...port, tunnelId: tunnel.id, clusterId: config.clusterId};
}

/** An endpoint with the relay's addresses for its legs (brief section 5; `relay_tunnel_host.rs:396-428,450-467`). */
function endpointView(
  tunnelId: string,
  endpoint: Record<string, unknown>,
  config: RelayConfig,
): Record<string, unknown> {
  const authority =
    config.port === 443
      ? config.domain
      : `${config.domain}:${String(config.port)}`;
  return {
    ...endpoint,
    hostRelayUri: `wss://cp.${authority}/relay/host/${tunnelId}`,
    clientRelayUri: `wss://cp.${authority}/relay/client/${tunnelId}`,
    portUriFormat: `https://${tunnelId}-{port}.${config.domain}/`,
  };
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
