/**
 * @fileoverview Who a GitHub token belongs to: `GET <base>/user` with the token, answered by the account's numeric id
 * and login. An account is kept five minutes and a refusal one, keyed by a hash of the token, which is never kept
 * itself, and at most a thousand answers at once: past that, the one read least recently goes.
 */

import {createHash} from 'node:crypto';

/** A GitHub account. */
interface GithubAccount {
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

/** How long an account is kept, in milliseconds. */
const KEPT_FOR = 5 * 60 * 1000;

/** How long a refusal is kept, in milliseconds. */
const REFUSED_FOR = 60 * 1000;

/** What is kept of an answer: an account, or a refusal; a failure to ask is never kept. */
type KeptAnswer = Extract<GithubAnswer, {kind: 'account' | 'refused'}>;

/** The most answers kept at once. */
export const KEPT_MOST = 1000;

/** Asks GitHub who tokens belong to, keeping each account answer for five minutes and each refusal for one. */
export class GithubIdentity {
  private readonly base: string;
  private readonly fetch: Fetch;
  private readonly now: () => number;
  private readonly kept = new Map<
    string,
    {answer: KeptAnswer; until: number}
  >();

  /** Asks the API at `base` with `fetch`, at the times `now` gives in milliseconds. */
  constructor(base: string, fetch: Fetch, now: () => number) {
    this.base = base;
    this.fetch = fetch;
    this.now = now;
  }

  /**
   * The answer kept for `token`, which reading makes the most recent, or none: a kept answer that has run out is
   * dropped here.
   */
  cached(token: string): GithubAnswer | undefined {
    const key = keyOf(token);
    const known = this.kept.get(key);
    if (known === undefined) {
      return undefined;
    }
    this.kept.delete(key);
    if (known.until <= this.now()) {
      return undefined;
    }
    this.kept.set(key, known);
    return known.answer;
  }

  /** Asks GitHub who `token` belongs to, keeping an account or a refusal, and gives the account or why there is none. */
  async lookup(token: string): Promise<GithubAnswer> {
    const key = keyOf(token);
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
      this.keep(key, {kind: 'refused'}, REFUSED_FOR);
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
    this.keep(key, {kind: 'account', account}, KEPT_FOR);
    return {kind: 'account', account};
  }

  /** Keeps `answer` under `key` for `lifetime` milliseconds, dropping the one read least recently first when the most are kept. */
  private keep(key: string, answer: KeptAnswer, lifetime: number): void {
    this.kept.delete(key);
    if (this.kept.size >= KEPT_MOST) {
      // The first key is the one read least recently, since every answer is set anew when kept or read.
      for (const oldest of this.kept.keys()) {
        this.kept.delete(oldest);
        break;
      }
    }
    this.kept.set(key, {answer, until: this.now() + lifetime});
  }
}

/** The key an answer is kept under: a hash of the token. */
function keyOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
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
