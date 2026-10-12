/**
 * @fileoverview The tunnels the editor is told about for the `LocalForward` entries of the effective ssh options:
 * each entry's addresses, or the reason it is left out.
 */

import {portOfText} from './entries.ts';

/** A host and a port. */
export interface EnvironmentAddress {
  host: string;
  port: number;
}

/** A forward of the ssh options as the editor shows it. */
export interface EnvironmentTunnel {
  remoteAddress: EnvironmentAddress;
  localAddress: EnvironmentAddress;
}

/** Why a `LocalForward` entry was left out. */
export type ForwardSkipReason =
  'badShape' | 'badPort' | 'localSocket' | 'remoteSocket' | 'bracketedIpv6';

/** An entry that was left out, by its position in the list. */
export interface SkippedForward {
  index: number;
  reason: ForwardSkipReason;
}

/** The tunnels in input order, and the entries left out. */
export interface EnvironmentTunnels {
  tunnels: EnvironmentTunnel[];
  skipped: SkippedForward[];
}

type Part =
  | {kind: 'bad'}
  | {kind: 'socket'}
  | {kind: 'address'; host: string; port: string; bracketedIpv6: boolean};

const BLANKS = /[ \t]+/;
const BRACKETED = /^\[[^\]]+\]:/;
const BAD_PART: Part = {kind: 'bad'};
const SOCKET_PART: Part = {kind: 'socket'};

function isPair(parts: string[]): parts is [string, string] {
  return parts.length === 2;
}

/** One side of an entry: `port`, `host:port` or `[host]:port`; the host is empty when the side has none. */
function readPart(text: string, hostRequired: boolean): Part {
  if (text.includes('/')) {
    return SOCKET_PART;
  }
  if (text.startsWith('[')) {
    if (!BRACKETED.test(text)) {
      return BAD_PART;
    }
    const close = text.indexOf(']');
    const host = text.slice(1, close);
    return {
      kind: 'address',
      host,
      port: text.slice(close + 2),
      bracketedIpv6: host.includes(':'),
    };
  }
  const colon = text.lastIndexOf(':');
  if (colon === 0 || (hostRequired && colon === -1)) {
    return BAD_PART;
  }
  return {
    kind: 'address',
    host: colon === -1 ? '' : text.slice(0, colon),
    port: text.slice(colon + 1),
    bracketedIpv6: false,
  };
}

function tunnelOf(text: string): EnvironmentTunnel | ForwardSkipReason {
  const parts = text.split(BLANKS);
  if (!isPair(parts)) {
    return 'badShape';
  }
  const listen = readPart(parts[0], false);
  const target = readPart(parts[1], true);
  if (listen.kind === 'bad' || target.kind === 'bad') {
    return 'badShape';
  }
  const badPort = [listen, target].some(
    part => part.kind === 'address' && portOfText(part.port) === undefined,
  );
  if (badPort) {
    return 'badPort';
  }
  if (listen.kind === 'socket') {
    return 'localSocket';
  }
  if (target.kind === 'socket') {
    return 'remoteSocket';
  }
  if (listen.bracketedIpv6 || target.bracketedIpv6) {
    return 'bracketedIpv6';
  }
  return {
    remoteAddress: {host: target.host, port: Number(target.port)},
    localAddress: {
      host: ['', 'localhost'].includes(listen.host) ? 'localhost' : listen.host,
      port: Number(listen.port),
    },
  };
}

/** The tunnels for `LocalForward` entries of the form `<listen> <target>`, and the entries that cannot be one. */
export function environmentTunnels(
  localForwards: readonly string[],
): EnvironmentTunnels {
  const tunnels: EnvironmentTunnel[] = [];
  const skipped: SkippedForward[] = [];
  for (const [index, text] of localForwards.entries()) {
    const outcome = tunnelOf(text);
    if (typeof outcome === 'string') {
      skipped.push({index, reason: outcome});
    } else {
      tunnels.push(outcome);
    }
  }
  return {tunnels, skipped};
}
