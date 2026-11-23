/**
 * @fileoverview The management routes of the relay brief's section 2, over the store: tunnels, their names, ports and
 * hosts' endpoints. An account reaches its own tunnels only; a tunnel token reaches its own tunnel only, as far as its
 * scope grants (section 4). A request reaches the routes parsed; the server reads and writes the wire. Sources:
 * `[dev-tunnels] rs/src/management/http_client.rs:38-42,61-307` and `[cli] tunnels/dev_tunnels.rs`.
 */

import {problem, Refused, success, type Answer} from './problem.ts';
import {isTokenScope, type TokenScope, type Tokens} from './auth/tokens.ts';
import type {RelayConfig} from './config.ts';
import {areLabels, isTunnelId, isTunnelName, MAX_DESCRIPTION} from './names.ts';
import type {Store, TunnelRecord} from './store.ts';

/** The only API version the relay serves (`http_client.rs:44,684-685`). */
export const API_VERSION = '2023-09-27-preview';

/** A request of a GitHub account on the allowlist, by its numeric id. */
interface AccountCaller {
  kind: 'account';
  id: number;
  login: string;
}

/** A request with a tunnel token: one tunnel, and what the token's scope grants on it. */
interface TunnelCaller {
  kind: 'tunnel';
  tunnelId: string;
  scope: TokenScope;
}

/** Who a request acts for. */
export type Caller = AccountCaller | TunnelCaller;

/** Who a request is from: its caller, or the answer that refuses it. */
export type Authenticate = (
  headers: Readonly<Record<string, string | undefined>>,
) => Promise<Caller | Answer>;

/** A request as the routes take it, its body read. */
interface Request {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}

/** A request as the server hands it over: its body is read only once the caller has signed in. */
export interface IncomingRequest extends Omit<Request, 'body'> {
  /** The body as JSON, none when empty; a body the relay refuses throws `Refused`. */
  readBody(): Promise<unknown>;
}

/** What the routes work with. */
export interface RouteContext {
  store: Store;
  config: RelayConfig;
  authenticate: Authenticate;
  tokens: Tokens;
  /** Hears an error a route threw, which the caller's answer doesn't carry. */
  report(error: unknown): void;
}

/** Whether `value` is a TCP port number: an integer from 1 to 65535. */
function isPortNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

/** The parts of `path` decoded, or none when one holds an escape that isn't one. */
function decodedParts(path: string): string[] | undefined {
  try {
    return path
      .split('/')
      .filter(part => part !== '')
      .map(decodeURIComponent);
  } catch {
    return undefined;
  }
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

const NOT_GRANTED = 'This token does not grant that.';

/** Answers `request`. */
export async function route(
  incoming: IncomingRequest,
  context: RouteContext,
): Promise<Answer> {
  if (incoming.query.get('api-version') !== API_VERSION) {
    return problem(400, `The api-version must be ${API_VERSION}.`);
  }
  const parts = decodedParts(incoming.path);
  if (parts === undefined) {
    return problem(400, 'The path is not valid.');
  }
  const clustersAsked = parts.length === 1 && parts[0] === 'clusters';
  if ((parts[0] !== 'tunnels' || parts.length > 4) && !clustersAsked) {
    return problem(404, 'There is no such route.');
  }
  const caller = await context.authenticate(incoming.headers);
  if ('status' in caller) {
    return caller;
  }
  let body: unknown;
  try {
    body = await incoming.readBody();
  } catch (caught) {
    if (caught instanceof Refused) {
      return caught.answer;
    }
    throw caught;
  }
  const request: Request = {...incoming, body};
  if (clustersAsked) {
    return request.method === 'GET'
      ? success([clusterOf(context.config)])
      : problem(404, 'There is no such route.');
  }
  const [, tunnelPart, section, item] = parts;
  if (tunnelPart === undefined || tunnelPart.endsWith(CHECK_NAME)) {
    return caller.kind === 'account'
      ? accountRoute(request, tunnelPart, section, caller, context)
      : problem(403, NOT_GRANTED);
  }
  if (section === undefined) {
    return tunnelRoute(request, tunnelPart.toLowerCase(), caller, context);
  }
  const tunnel = callersTunnel(tunnelPart.toLowerCase(), caller, context);
  if (tunnel === undefined) {
    return problem(404, 'There is no such tunnel.');
  }
  if (!granted(caller, section, request.method)) {
    return problem(403, NOT_GRANTED);
  }
  if (section === 'endpoints' && item !== undefined) {
    return endpointRoute(request, tunnel, item, context);
  }
  if (section === 'ports') {
    return portRoute(request, tunnel, item, context);
  }
  return problem(404, 'There is no such route.');
}

/** The routes only an account reaches: its list of tunnels and the name check. */
function accountRoute(
  request: Request,
  tunnelPart: string | undefined,
  section: string | undefined,
  caller: AccountCaller,
  context: RouteContext,
): Answer {
  if (request.method !== 'GET' || section !== undefined) {
    return problem(404, 'There is no such route.');
  }
  return tunnelPart === undefined
    ? listTunnels(request.query, caller, context)
    : success(
        nameAvailable(tunnelPart.slice(0, -CHECK_NAME.length), caller, context),
      );
}

/** Whether a tunnel token's scope grants `method` on `section`; an account's own tunnel grants everything. */
function granted(caller: Caller, section: string, method: string): boolean {
  if (caller.kind === 'account') {
    return true;
  }
  if (section === 'endpoints') {
    return caller.scope === 'host';
  }
  return method === 'GET' || caller.scope !== 'connect';
}

/** The tunnel `idOrName` the caller may reach: an account's own, or a tunnel token's own by id. */
function callersTunnel(
  idOrName: string,
  caller: Caller,
  context: RouteContext,
): TunnelRecord | undefined {
  if (caller.kind === 'account') {
    return ownTunnel(idOrName, caller, context);
  }
  return idOrName === caller.tunnelId
    ? context.store.tunnelById(idOrName)
    : undefined;
}

/** The caller's tunnel with id or name `idOrName`, or none: another account's tunnel is not found. */
function ownTunnel(
  idOrName: string,
  caller: AccountCaller,
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
  caller: AccountCaller,
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
  caller: AccountCaller,
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
    .map(tunnel => tunnelView(tunnel, query, context, true));
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
  if (caller.kind === 'tunnel' && request.method !== 'GET') {
    return problem(403, NOT_GRANTED);
  }
  if (request.method === 'PUT' && caller.kind === 'account') {
    return putTunnel(request, idOrName, caller, context);
  }
  const tunnel = callersTunnel(idOrName, caller, context);
  if (tunnel === undefined) {
    return problem(404, 'There is no such tunnel.');
  }
  if (request.method === 'GET') {
    return success(
      tunnelView(tunnel, request.query, context, caller.kind === 'account'),
    );
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
  caller: AccountCaller,
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
      if (fields !== undefined && isPortNumber(fields.portNumber)) {
        store.putPort(tunnelId, fields.portNumber, {
          ...store.port(tunnelId, fields.portNumber),
          ...fields,
        });
      }
    }
    return success(tunnelView(record, request.query, context, true));
  });
}

/** The answer that refuses a tunnel body's name, labels or description, or none. */
function fieldProblem(body: Record<string, unknown>): Answer | undefined {
  const ports: unknown[] = Array.isArray(body.ports) ? body.ports : [];
  if (
    ports.some(port => {
      const portNumber = objectOf(port)?.portNumber;
      return portNumber !== undefined && !isPortNumber(portNumber);
    })
  ) {
    return problem(400, 'The port number is not valid.');
  }
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
  return accessProblem(body);
}

/**
 * The answer that refuses public access, or none: an `Anonymous` entry that allows (section 4). `[cli]`'s private
 * ports send an `Anonymous` deny entry (`dev_tunnels.rs:1288-1317`), which is kept; other entries are kept and grant
 * nothing in release 1.
 */
function accessProblem(body: Record<string, unknown>): Answer | undefined {
  const entries = objectOf(body.accessControl)?.entries;
  const allowsAnyone =
    Array.isArray(entries) &&
    entries.some(entry => {
      const fields = objectOf(entry);
      return fields?.type === 'Anonymous' && fields.isDeny !== true;
    });
  return allowsAnyone
    ? problem(400, "Public access isn't offered.")
    : undefined;
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
  if (!isPortNumber(number)) {
    return problem(400, 'The port number is not valid.');
  }
  const existing = store.port(tunnel.id, number);
  if (request.method === 'PUT') {
    const body = objectOf(request.body);
    if (body === undefined) {
      return problem(400, 'The body must be a port.');
    }
    const refused = accessProblem(body);
    if (refused !== undefined) {
      return refused;
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

/**
 * A tunnel as the clients read it: `clusterId` and `tunnelId` always, ports when asked for, every endpoint, and for
 * its owner a token per scope asked for in `tokenScopes` that the relay issues.
 */
function tunnelView(
  tunnel: TunnelRecord,
  query: URLSearchParams,
  {store, config, tokens}: RouteContext,
  owner: boolean,
): Record<string, unknown> {
  const scopes = owner
    ? (query.get('tokenScopes') ?? '').split(',').filter(isTokenScope)
    : [];
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
    ...(scopes.length === 0
      ? {}
      : {
          accessTokens: Object.fromEntries(
            scopes.map(scope => [
              scope,
              tokens.issue(tunnel.id, config.clusterId, scope),
            ]),
          ),
        }),
  };
}

function portView(
  tunnel: TunnelRecord,
  port: Record<string, unknown>,
  config: RelayConfig,
): Record<string, unknown> {
  return {...port, tunnelId: tunnel.id, clusterId: config.clusterId};
}

/** The relay's host and port, the port left out when it is HTTPS's own. */
function authorityOf(config: RelayConfig): string {
  return config.port === 443
    ? config.domain
    : `${config.domain}:${String(config.port)}`;
}

/**
 * The relay's one cluster as `ClusterDetails` (`[dev-tunnels] ts/src/contracts/clusterDetails.ts:11-26`), which the
 * TypeScript SDK's `listClusters` reads (`ts/src/management/tunnelManagementHttpClient.ts:687-698`).
 */
function clusterOf(config: RelayConfig): Record<string, string> {
  return {
    clusterId: config.clusterId,
    uri: `https://cp.${authorityOf(config)}`,
    azureLocation: '',
  };
}

/** An endpoint with the relay's addresses for its legs (brief section 5; `relay_tunnel_host.rs:396-428,450-467`). */
function endpointView(
  tunnelId: string,
  endpoint: Record<string, unknown>,
  config: RelayConfig,
): Record<string, unknown> {
  const authority = authorityOf(config);
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
