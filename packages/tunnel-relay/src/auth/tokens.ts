/**
 * @fileoverview The relay's tunnel access tokens: a JWT per scope, signed HS256 with the relay's own key, with the
 * claims `exp`, `scp`, `tid`, `own`, `gen` and `cid` (the relay brief's section 4): `own` and `gen` are the tunnel's
 * owner and generation when it was minted, so the token reaches no later tunnel given the same id. The TypeScript SDK
 * reads only `exp`
 * (`[dev-tunnels] ts/src/management/tunnelAccessTokenProperties.ts:11-12,70-72`); the relay reads back all but `cid`,
 * which names its one cluster.
 */

import {createHmac, timingSafeEqual} from 'node:crypto';
import type {TunnelRecord} from '../store.ts';

/** The scopes the relay issues tokens for (`rs/src/contracts/tunnel_access_scopes.rs`). */
const TOKEN_SCOPES = ['host', 'connect', 'manage:ports'] as const;

/** A scope the relay issues tokens for. */
export type TokenScope = (typeof TOKEN_SCOPES)[number];

/** How long each scope's token lives, in seconds: a day for a host, an hour for the rest. */
const LIFETIMES: Readonly<Record<TokenScope, number>> = {
  host: 24 * 60 * 60,
  connect: 60 * 60,
  'manage:ports': 60 * 60,
};

/** The fewest bytes of key the tokens are signed with. */
const MIN_KEY_BYTES = 32;

/** What a valid token grants. */
export interface TokenGrant {
  tunnelId: string;
  /** The numeric GitHub id of the tunnel's owner when the token was minted. */
  owner: number;
  /** The tunnel's generation when the token was minted. */
  generation: string;
  scope: TokenScope;
}

/** Whether `value` is a scope the relay issues tokens for. */
export function isTokenScope(value: string): value is TokenScope {
  return (TOKEN_SCOPES as readonly string[]).includes(value);
}

/** Issues and checks the relay's tokens with one key. */
export class Tokens {
  private readonly key: Buffer;
  private readonly now: () => number;

  /** Tokens signed with `key`, at the times `now` gives in milliseconds. */
  constructor(key: Buffer, now: () => number) {
    if (key.length < MIN_KEY_BYTES) {
      throw new Error(
        `The token key has ${String(key.length)} bytes, fewer than ${String(MIN_KEY_BYTES)}.`,
      );
    }
    this.key = key;
    this.now = now;
  }

  /** A token of `scope` for `tunnel` in cluster `clusterId`. */
  issue(
    tunnel: Pick<TunnelRecord, 'id' | 'owner' | 'generation'>,
    clusterId: string,
    scope: TokenScope,
  ): string {
    const claims = {
      exp: Math.floor(this.now() / 1000) + LIFETIMES[scope],
      scp: scope,
      tid: tunnel.id,
      own: tunnel.owner,
      gen: tunnel.generation,
      cid: clusterId,
    };
    const unsigned = `${encoded({alg: 'HS256', typ: 'JWT'})}.${encoded(claims)}`;
    return `${unsigned}.${this.signature(unsigned)}`;
  }

  /** What `token` grants, or nothing for a token that is malformed, signed with another key or expired. */
  check(token: string): TokenGrant | undefined {
    const [header, payload, signature, ...rest] = token.split('.');
    if (
      header === undefined ||
      payload === undefined ||
      signature === undefined ||
      rest.length > 0
    ) {
      return undefined;
    }
    const expected = Buffer.from(this.signature(`${header}.${payload}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return undefined;
    }
    const claims = decoded(payload);
    const scope = typeof claims?.scp === 'string' ? claims.scp : '';
    if (
      claims === undefined ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= this.now() ||
      typeof claims.tid !== 'string' ||
      typeof claims.own !== 'number' ||
      typeof claims.gen !== 'string' ||
      !isTokenScope(scope)
    ) {
      return undefined;
    }
    return {
      tunnelId: claims.tid,
      owner: claims.own,
      generation: claims.gen,
      scope,
    };
  }

  /** The base64url HMAC-SHA256 of `unsigned` with the key. */
  private signature(unsigned: string): string {
    return createHmac('sha256', this.key).update(unsigned).digest('base64url');
  }
}

/** `value` as base64url JSON. */
function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/** The JSON object in base64url `part`, or nothing when it is not one. */
function decoded(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(part, 'base64url').toString('utf8'),
    );
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}
