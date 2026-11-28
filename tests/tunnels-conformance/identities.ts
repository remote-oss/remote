/**
 * @fileoverview The stub identity service of the tunnels run: the GitHub accounts the run's relay asks `/user` about,
 * the fixed test tokens that name them, and the service's answers. No real account or token exists anywhere in the run.
 */

import {readFileSync} from 'node:fs';
import {createServer, type Server} from 'node:http';

/** A GitHub account as `/user` answers it: the relay reads its numeric id and its login. */
export interface StubAccount {
  id: number;
  login: string;
}

/** The run's accounts: `listed` and `alsoListed` are on the relay's allowlist, `unlisted` is not. */
export const ACCOUNTS = {
  listed: {id: 9100001, login: 'tunnels-run-a'},
  alsoListed: {id: 9100002, login: 'tunnels-run-b'},
  unlisted: {id: 9100003, login: 'tunnels-run-c'},
} as const satisfies Record<string, StubAccount>;

/**
 * The fixed test tokens: one for each account, one shaped like a personal access token for the listed account, and one
 * the service refuses with 401.
 */
export const TOKENS = {
  listed: 'stub-token-listed',
  alsoListed: 'stub-token-also-listed',
  unlisted: 'stub-token-unlisted',
  listedPersonal: `ghp_${'7'.repeat(36)}`,
  refused: 'stub-token-refused',
} as const;

/** What the service knows: each token it identifies, with its account. A token it doesn't list gets 401. */
export type IdentityTable = Readonly<Record<string, StubAccount>>;

/** The table the run starts with: every token but `refused`. */
export function startingTable(): IdentityTable {
  return {
    [TOKENS.listed]: ACCOUNTS.listed,
    [TOKENS.alsoListed]: ACCOUNTS.alsoListed,
    [TOKENS.unlisted]: ACCOUNTS.unlisted,
    [TOKENS.listedPersonal]: ACCOUNTS.listed,
  };
}

/** The allowlist file the run starts with: the ids of the two listed accounts, one per line. */
export function startingAllowlist(): string {
  return `${String(ACCOUNTS.listed.id)}\n${String(ACCOUNTS.alsoListed.id)}\n`;
}

/** An answer of the service: its status and its JSON body. */
export interface IdentityAnswer {
  status: number;
  body: object;
}

const BEARER = /^Bearer (\S+)$/;

/**
 * The answer to a request for `path` with the method `method` and the `Authorization` header `authorization`: the
 * account of a bearer token the table lists, 401 for any other token or none, and 404 for anything but `GET /user`.
 */
export function answerOf(
  table: IdentityTable,
  method: string | undefined,
  path: string | undefined,
  authorization: string | undefined,
): IdentityAnswer {
  if (method !== 'GET' || path !== '/user') {
    return {status: 404, body: {message: 'Not Found'}};
  }
  const token = BEARER.exec(authorization ?? '')?.[1];
  const account = token === undefined ? undefined : table[token];
  return account === undefined
    ? {status: 401, body: {message: 'Bad credentials'}}
    : {status: 200, body: {id: account.id, login: account.login}};
}

/**
 * The service: it reads the table from `tableFile` at each request, so a row can change an account's login or add a
 * token mid-run.
 */
export function identityServer(tableFile: string): Server {
  return createServer((request, response) => {
    const table = JSON.parse(readFileSync(tableFile, 'utf8')) as IdentityTable;
    const answer = answerOf(
      table,
      request.method,
      request.url,
      request.headers.authorization,
    );
    response.writeHead(answer.status, {'content-type': 'application/json'});
    response.end(JSON.stringify(answer.body));
  });
}
