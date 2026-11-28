/**
 * @fileoverview What a window and the profile's local proxy say to each other over the proxy's endpoint: plain data,
 * one request and one reply at a time, each read back by a reader that refuses anything else.
 */

import type {PlainData} from 'lib-helper';

/** The editor's proxy settings the window passes, which the proxy uses for the relay's HTTPS and the client leg. */
interface ProxySettings {
  /** `http.proxy`; empty for none. */
  url: string;
  /** `http.proxyStrictSSL`. */
  strictSsl: boolean;
  /** `http.noProxy`. */
  noProxy: string[];
}

/** What a window asks of the proxy. */
export type ProxyRequest =
  | {type: 'attach'; token: string; proxy: ProxySettings}
  | {type: 'open'; tunnelName: string; port: number}
  | {type: 'serveKept'; tunnelName: string}
  | {type: 'keepServe'; tunnelName: string; served: PlainData};

/** Why the proxy could not open a stream to a tunnel's port. */
export type OpenFailureReason =
  'notFound' | 'refused' | 'unreachable' | 'unauthorized' | 'limit';

/** The proxy's answer to a request. */
export type ProxyReply =
  | {type: 'attached'}
  | {type: 'opened'; socket: string; ticket: string}
  | {type: 'failed'; reason: OpenFailureReason; detail: string}
  | {type: 'serve'; served: PlainData | null}
  | {type: 'accepted'};

/** The highest TCP port number. */
const LAST_PORT = 65535;

/** A ticket as the proxy issues it: 32 random bytes as lower-case hex. */
const TICKET = /^[0-9a-f]{64}$/;

const OPEN_FAILURES: readonly string[] = [
  'notFound',
  'refused',
  'unreachable',
  'unauthorized',
  'limit',
];

type Fields = Readonly<Record<string, PlainData>>;

function isFields(value: PlainData | undefined): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A text that isn't empty. */
function isText(value: PlainData | undefined): value is string {
  return typeof value === 'string' && value !== '';
}

function isPort(value: PlainData | undefined): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= LAST_PORT
  );
}

function readProxySettings(
  value: PlainData | undefined,
): ProxySettings | undefined {
  if (!isFields(value)) {
    return undefined;
  }
  const {url, strictSsl, noProxy} = value;
  return typeof url === 'string' &&
    typeof strictSsl === 'boolean' &&
    Array.isArray(noProxy) &&
    noProxy.every(entry => typeof entry === 'string')
    ? {url, strictSsl, noProxy}
    : undefined;
}

/** The request `body` is, or undefined when it is none. */
export function readProxyRequest(body: PlainData): ProxyRequest | undefined {
  if (!isFields(body)) {
    return undefined;
  }
  switch (body.type) {
    case 'attach': {
      const proxy = readProxySettings(body.proxy);
      return isText(body.token) && proxy !== undefined
        ? {type: 'attach', token: body.token, proxy}
        : undefined;
    }
    case 'open':
      return isText(body.tunnelName) && isPort(body.port)
        ? {type: 'open', tunnelName: body.tunnelName, port: body.port}
        : undefined;
    case 'serveKept':
      return isText(body.tunnelName)
        ? {type: 'serveKept', tunnelName: body.tunnelName}
        : undefined;
    case 'keepServe':
      return isText(body.tunnelName) && isFields(body.served)
        ? {type: 'keepServe', tunnelName: body.tunnelName, served: body.served}
        : undefined;
    default:
      return undefined;
  }
}

/** The reply `body` is, or undefined when it is none. */
export function readProxyReply(body: PlainData): ProxyReply | undefined {
  if (!isFields(body)) {
    return undefined;
  }
  switch (body.type) {
    case 'attached':
    case 'accepted':
      return {type: body.type};
    case 'opened':
      return isText(body.socket) &&
        typeof body.ticket === 'string' &&
        TICKET.test(body.ticket)
        ? {type: 'opened', socket: body.socket, ticket: body.ticket}
        : undefined;
    case 'failed':
      return typeof body.reason === 'string' &&
        OPEN_FAILURES.includes(body.reason) &&
        typeof body.detail === 'string'
        ? {
            type: 'failed',
            reason: body.reason as OpenFailureReason,
            detail: body.detail,
          }
        : undefined;
    case 'serve':
      return body.served === null || isFields(body.served)
        ? {type: 'serve', served: body.served}
        : undefined;
    default:
      return undefined;
  }
}
