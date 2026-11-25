/**
 * @fileoverview Who a request is from, by its `Authorization` header (the relay brief's sections 3 and 4): a GitHub
 * account on the allowlist, by `github <token>` or `github client_id=<id> <token>`, or a tunnel token's grant, by
 * `tunnel <token>`. Other schemes, `aad` and `bearer` among them, are refused
 * (`[dev-tunnels] rs/src/management/authorization.rs:10-32`; `[cli] auth.rs:491-503`).
 */

import {problem, type Answer} from '../problem.ts';
import type {Authenticate, Caller} from '../routes.ts';
import type {Allowlist} from './allowlist.ts';
import type {GithubIdentity} from './github.ts';
import type {Tokens} from './tokens.ts';

const SIGN_IN = 'Sign in with a GitHub account.';

/** What deciding who a request is from needs. */
export interface Authorities {
  github: GithubIdentity;
  allowlist: Allowlist;
  tokens: Tokens;
}

/** The relay's `authenticate`: a caller for a request, or the answer that refuses it. */
export function authenticateWith(authorities: Authorities): Authenticate {
  return headers => callerOf(headers.authorization, authorities);
}

/** The caller of `header`, or the answer that refuses it. */
async function callerOf(
  header: string | undefined,
  {github, allowlist, tokens}: Authorities,
): Promise<Caller | Answer> {
  const [scheme, ...words] = (header ?? '').trim().split(/\s+/);
  const token = words.at(-1);
  if (token === undefined) {
    return problem(401, SIGN_IN);
  }
  if (scheme === 'tunnel' && words.length === 1) {
    const grant = tokens.check(token);
    return grant === undefined
      ? problem(401, 'The tunnel token is not valid.')
      : {kind: 'tunnel', tunnelId: grant.tunnelId, scope: grant.scope};
  }
  if (scheme !== 'github') {
    return problem(401, SIGN_IN);
  }
  const answer = await github.accountOf(token);
  if (answer.kind === 'refused') {
    return problem(401, 'GitHub refused the token.');
  }
  if (answer.kind === 'failed') {
    return problem(502, `GitHub could not be asked: ${answer.reason}`);
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
