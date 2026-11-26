/**
 * @fileoverview Who a request is from, by its `Authorization` header (the relay brief's sections 3 and 4): a GitHub
 * account on the allowlist, by `github <token>` or `github client_id=<id> <token>`, or a tunnel token's grant, by
 * `tunnel <token>`, while the tunnel it was minted for is stored with the same owner and generation. Other schemes, `aad` and `bearer` among them, are refused
 * (`[dev-tunnels] rs/src/management/authorization.rs:10-32`; `[cli] auth.rs:491-503`).
 */

import {problem, type Answer} from '../problem.ts';
import type {Authenticate, Caller} from '../routes.ts';
import type {Allowlist} from './allowlist.ts';
import type {GithubIdentity} from './github.ts';
import type {LookupLimit} from './lookups.ts';
import type {Tokens} from './tokens.ts';
import type {Store} from '../store.ts';

const SIGN_IN = 'Sign in with a GitHub account.';

/** What deciding who a request is from needs. */
export interface Authorities {
  github: GithubIdentity;
  /** How often one address may ask GitHub about tokens that are in no cache. */
  lookups: LookupLimit;
  allowlist: Allowlist;
  tokens: Tokens;
  /** The stored tunnels a tunnel token is checked against. */
  tunnels: Pick<Store, 'tunnelById'>;
  /** Hears why GitHub could not be asked, which the caller's answer doesn't carry. */
  report: (reason: string) => void;
}

/** The relay's `authenticate`: a caller for a request, or the answer that refuses it. */
export function authenticateWith(authorities: Authorities): Authenticate {
  return (headers, address) =>
    callerOf(headers.authorization, address, authorities);
}

/** The caller of `header`, or the answer that refuses it. */
async function callerOf(
  header: string | undefined,
  address: string,
  {github, lookups, allowlist, tokens, tunnels, report}: Authorities,
): Promise<Caller | Answer> {
  const [scheme, ...words] = (header ?? '').trim().split(/\s+/);
  const token = words.at(-1);
  if (token === undefined) {
    return problem(401, SIGN_IN);
  }
  if (scheme === 'tunnel' && words.length === 1) {
    const grant = tokens.check(token);
    const tunnel =
      grant === undefined ? undefined : tunnels.tunnelById(grant.tunnelId);
    return grant === undefined ||
      tunnel?.owner !== grant.owner ||
      tunnel.generation !== grant.generation
      ? problem(401, 'The tunnel token is not valid.')
      : {kind: 'tunnel', tunnelId: grant.tunnelId, scope: grant.scope};
  }
  if (scheme !== 'github') {
    return problem(401, SIGN_IN);
  }
  let answer = github.cached(token);
  if (answer === undefined) {
    const taken = lookups.take(address);
    if (taken.kind === 'refused') {
      const wait = String(taken.retryAfterSeconds);
      return {
        ...problem(
          429,
          `This address has asked GitHub about too many tokens; try again in ${wait} seconds.`,
        ),
        headers: {'Retry-After': wait},
      };
    }
    answer = await github.lookup(token);
  }
  if (answer.kind === 'refused') {
    return problem(401, 'GitHub refused the token.');
  }
  if (answer.kind === 'failed') {
    report(`GitHub could not be asked: ${answer.reason}`);
    return problem(502, 'GitHub could not be asked.');
  }
  const {account} = answer;
  if (!allowlist.admits(account.id)) {
    return problem(
      403,
      `The tunnel service doesn't admit the GitHub account ${account.login}.`,
    );
  }
  return {kind: 'account', id: account.id, login: account.login};
}
