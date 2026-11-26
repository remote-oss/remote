/**
 * @fileoverview Who a GitHub token belongs to: `GET <base>/user` with the token, answered by the account's numeric id
 * and login. Answers are kept five minutes, keyed by a hash of the token, which is never kept itself, and at most a
 * thousand at once: past that, the oldest goes, which is also the first to run out.
 */

import {createHash} from 'node:crypto';

/** A GitHub account. */
export interface GithubAccount {
  id: number;
  login: string;
}

/** What asking GitHub gave: the account, a refused token, or a failure to ask. */
export type GithubAnswer =
  | {kind: 'account'; account: GithubAccount}
  | {kind: 'refused'}
  | {kind: 'failed'; reason: string};

/** The `fetch` the lookup uses. */
export type Fetch = (address: string, init: RequestInit) => Promise<Response>;

/** How long an answer is kept, in milliseconds. */
const KEPT_FOR = 5 * 60 * 1000;

/** The most answers kept at once. */
export const KEPT_MOST = 1000;

/** Asks GitHub who tokens belong to, keeping each account answer for five minutes. */
export class GithubIdentity {
  private readonly base: string;
  private readonly fetch: Fetch;
  private readonly now: () => number;
  private readonly kept = new Map<
    string,
    {account: GithubAccount; until: number}
  >();

  /** Asks the API at `base` with `fetch`, at the times `now` gives in milliseconds. */
  constructor(base: string, fetch: Fetch, now: () => number) {
    this.base = base;
    this.fetch = fetch;
    this.now = now;
  }

  /** The account `token` belongs to, or why there is none. */
  async accountOf(token: string): Promise<GithubAnswer> {
    const key = createHash('sha256').update(token).digest('hex');
    const known = this.kept.get(key);
    if (known !== undefined && known.until > this.now()) {
      return {kind: 'account', account: known.account};
    }
    let response: Response;
    try {
      response = await this.fetch(`${this.base}/user`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'User-Agent': 'tunnel-relay',
        },
      });
    } catch (error) {
      return {kind: 'failed', reason: String(error)};
    }
    if (response.status === 401) {
      return {kind: 'refused'};
    }
    if (!response.ok) {
      return {
        kind: 'failed',
        reason: `GitHub answered ${String(response.status)}`,
      };
    }
    const body: unknown = await response.json().catch(() => undefined);
    const account = accountIn(body);
    if (account === undefined) {
      return {kind: 'failed', reason: 'GitHub answered with no account'};
    }
    this.keep(key, account);
    return {kind: 'account', account};
  }

  /** Keeps `account` under `key`, dropping the oldest answer first when the most are kept. */
  private keep(key: string, account: GithubAccount): void {
    this.kept.delete(key);
    if (this.kept.size >= KEPT_MOST) {
      // The first key is the oldest answer, since every answer is set anew when kept.
      for (const oldest of this.kept.keys()) {
        this.kept.delete(oldest);
        break;
      }
    }
    this.kept.set(key, {account, until: this.now() + KEPT_FOR});
  }
}

/** The account in GitHub's answer, or none when it has no numeric id and login. */
function accountIn(body: unknown): GithubAccount | undefined {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const fields = body as {id?: unknown; login?: unknown};
  return typeof fields.id === 'number' && typeof fields.login === 'string'
    ? {id: fields.id, login: fields.login}
    : undefined;
}
