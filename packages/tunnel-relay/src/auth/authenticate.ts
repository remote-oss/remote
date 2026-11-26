/**
 * @fileoverview Who a request is from, by its `Authorization` header (the relay brief's sections 3 and 4): a GitHub
 * account on the allowlist, by `github <token>` or `github client_id=<id> <token>`, or a tunnel token's grant, by
 * `tunnel <token>`, while the tunnel it was minted for is stored with the same owner and generation and that owner is
 * still on the allowlist. Other schemes, `aad` and `bearer` among them, are refused
 * (`[dev-tunnels] rs/src/management/authorization.rs:10-32`; `[cli] auth.rs:491-503`).
 */

import {problem, type Answer} from '../problem.ts';
import type {Authenticate, Caller} from '../routes.ts';
import type {Allowlist} from './allowlist.ts';
import type {GithubIdentity} from './github.ts';
import type {Tokens} from './tokens.ts';
import type {Store} from '../store.ts';

const SIGN_IN = 'Sign in with a GitHub account.';

/** Why a valid tunnel token of an owner taken off the allowlist is refused, and why that owner's legs are closed. */
export const NO_LONGER_ADMITTED = "The tunnel's owner is no longer admitted.";

/** What deciding who a request is from needs. */
export interface Authorities {
  github: GithubIdentity;
  allowlist: Allowlist;
  tokens: Tokens;
  /** The stored tunnels a tunnel token is checked against. */
  tunnels: Pick<Store, 'tunnelById'>;
  /** Hears why GitHub could not be asked, which the caller's answer doesn't carry. */
  report: (reason: string) => void;
}

/** The relay's `authenticate`: a caller for a request, or the answer that refuses it. */
export function authenticateWith(authorities: Authorities): Authenticate {
  return headers => callerOf(headers.authorization, authorities);
}

/** The caller of `header`, or the answer that refuses it. */
async function callerOf(
  header: string | undefined,
  {github, allowlist, tokens, tunnels, report}: Authorities,
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
    if (
      grant === undefined ||
      tunnel?.owner !== grant.owner ||
      tunnel.generation !== grant.generation
    ) {
      return problem(401, 'The tunnel token is not valid.');
    }
    if (!allowlist.admits(grant.owner)) {
      return problem(403, NO_LONGER_ADMITTED);
    }
    return {
      kind: 'tunnel',
      tunnelId: grant.tunnelId,
      owner: grant.owner,
      scope: grant.scope,
    };
  }
  if (scheme !== 'github') {
    return problem(401, SIGN_IN);
  }
  const answer = await github.accountOf(token);
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
