import {deepStrictEqual} from 'node:assert';
import {createHmac} from 'node:crypto';
import {Allowlist} from '../../src/auth/allowlist.ts';
import {
  authenticateWith,
  NO_LONGER_ADMITTED,
} from '../../src/auth/authenticate.ts';
import {type Fetch, GithubIdentity, KEPT_MOST} from '../../src/auth/github.ts';
import {LookupLimit} from '../../src/auth/lookups.ts';
import {Tokens} from '../../src/auth/tokens.ts';
import type {TunnelRecord} from '../../src/store.ts';

const SIGNING_KEY = Buffer.alloc(32, 7);

/** Tunnel `one` as the store holds it: owner 42, generation `g1`. */
const TUNNEL_ONE: TunnelRecord = {
  id: 'one',
  owner: 42,
  name: '',
  generation: 'g1',
  fields: {},
};

/** The message `work` throws with. */
function messageOf(work: () => unknown): string {
  try {
    work();
    return 'no error';
  } catch (error) {
    return (error as Error).message;
  }
}

/** The authorities over `github`, with the account 42 admitted, no tunnel stored and a fresh limit on lookups. */
function authoritiesOver(github: GithubIdentity) {
  return {
    github,
    lookups: new LookupLimit(() => 0),
    allowlist: new Allowlist({modified: () => 1, text: () => '42\n'}),
    tokens: new Tokens(SIGNING_KEY, () => 0),
    tunnels: {tunnelById: () => undefined},
    report: () => undefined,
  };
}

/** What a caller of the relay gets for `token`: the answer kept for it, else GitHub's. */
async function answered(
  github: GithubIdentity,
  token: string,
): Promise<unknown> {
  return github.cached(token) ?? (await github.lookup(token));
}

/** A `fetch` that answers every request with `status` and `body`, and records the requests. */
function fetchAnswering(
  status: number,
  body: unknown,
): {fetch: Fetch; asked: Array<{address: string; init: RequestInit}>} {
  const asked: Array<{address: string; init: RequestInit}> = [];
  function fetch(address: string, init: RequestInit): Promise<Response> {
    asked.push({address, init});
    return Promise.resolve(
      new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
      }),
    );
  }
  return {fetch, asked};
}

/** The claims a token for tunnel `one` names it by. */
const MINTED = {tid: 'one', own: 42, gen: 'g1', cid: 'usw2'};

describe("the relay's tunnel tokens", () => {
  it("a token carries its tunnel, the tunnel's owner and generation, cluster, scope and expiry, a day for a host and an hour for the rest", () => {
    const tokens = new Tokens(SIGNING_KEY, () => 1_000_000);
    function claimsOf(token: string): unknown {
      return JSON.parse(
        Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      );
    }
    deepStrictEqual(
      [
        claimsOf(tokens.issue(TUNNEL_ONE, 'usw2', 'host')),
        claimsOf(tokens.issue(TUNNEL_ONE, 'usw2', 'connect')),
        claimsOf(tokens.issue(TUNNEL_ONE, 'usw2', 'manage:ports')),
      ],
      [
        {exp: 1000 + 86_400, scp: 'host', ...MINTED},
        {exp: 1000 + 3600, scp: 'connect', ...MINTED},
        {exp: 1000 + 3600, scp: 'manage:ports', ...MINTED},
      ],
    );
  });

  it('a token checks back to its grant until it expires', () => {
    let clock = 0;
    const tokens = new Tokens(SIGNING_KEY, () => clock);
    const token = tokens.issue(TUNNEL_ONE, 'usw2', 'connect');
    const before = tokens.check(token);
    clock = 3600 * 1000;
    deepStrictEqual(
      [before, tokens.check(token)],
      [
        {tunnelId: 'one', owner: 42, generation: 'g1', scope: 'connect'},
        undefined,
      ],
    );
  });

  it('refuses a token of another key, an altered one, a malformed one, and one whose claims are not a grant', () => {
    const tokens = new Tokens(SIGNING_KEY, () => 0);
    const token = tokens.issue(TUNNEL_ONE, 'usw2', 'host');
    const [header = '', , signature = ''] = token.split('.');
    deepStrictEqual(
      [
        new Tokens(Buffer.alloc(32, 8), () => 0).check(token),
        tokens.check(
          `${header}.${Buffer.from('{"tid":"two"}').toString('base64url')}.${signature}`,
        ),
        tokens.check('only.two'),
        tokens.check('a.b.c.d'),
        tokens.check(`${header}.e30.short`),
        tokens.check(signedClaims({exp: 99, scp: 'manage', ...MINTED})),
        tokens.check(signedClaims({exp: 99, scp: 'host', ...MINTED, tid: 7})),
        tokens.check(signedClaims({exp: 'later', scp: 'host', ...MINTED})),
        tokens.check(signedClaims({exp: 99, ...MINTED})),
        tokens.check(signedClaims([1])),
        tokens.check(`${header}.%%.${resign(`${header}.%%`)}`),
        tokens.check(
          signedClaims({exp: 99, scp: 'host', tid: 'one', gen: 'g1'}),
        ),
        tokens.check(
          signedClaims({exp: 99, scp: 'host', ...MINTED, own: '42'}),
        ),
        tokens.check(signedClaims({exp: 99, scp: 'host', tid: 'one', own: 42})),
        tokens.check(signedClaims({exp: 99, scp: 'host', ...MINTED, gen: 1})),
        tokens.check(signedClaims({exp: 99, scp: 'host', ...MINTED})),
      ],
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        {tunnelId: 'one', owner: 42, generation: 'g1', scope: 'host'},
      ],
    );
  });

  it('refuses a key shorter than 32 bytes', () => {
    deepStrictEqual(
      messageOf(() => new Tokens(Buffer.alloc(31), () => 0)),
      'The token key has 31 bytes, fewer than 32.',
    );
  });
});

/** The HS256 signature of `unsigned` with the test key, as the relay computes it. */
function resign(unsigned: string): string {
  return createHmac('sha256', SIGNING_KEY).update(unsigned).digest('base64url');
}

/** A token whose claims are `claims`, signed with the test key as the relay signs. */
function signedClaims(claims: unknown): string {
  const header = Buffer.from('{"alg":"HS256","typ":"JWT"}').toString(
    'base64url',
  );
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.${resign(`${header}.${payload}`)}`;
}

describe('who a GitHub token belongs to', () => {
  it('asks the API with the token, and keeps the account five minutes by a hash of the token', async () => {
    let clock = 0;
    const {fetch, asked} = fetchAnswering(200, {id: 42, login: 'octo'});
    const github = new GithubIdentity(
      'https://github.test',
      fetch,
      () => clock,
    );
    const first = await answered(github, 'secret');
    clock = 5 * 60 * 1000 - 1;
    const kept = await answered(github, 'secret');
    const other = await answered(github, 'another');
    clock = 5 * 60 * 1000;
    await answered(github, 'secret');
    deepStrictEqual(
      [
        first,
        kept,
        other,
        asked.length,
        asked[0]?.address,
        (asked[0]?.init.headers as Record<string, string>).Authorization,
      ],
      [
        {kind: 'account', account: {id: 42, login: 'octo'}},
        {kind: 'account', account: {id: 42, login: 'octo'}},
        {kind: 'account', account: {id: 42, login: 'octo'}},
        3,
        'https://github.test/user',
        'Bearer secret',
      ],
    );
  });

  it('says a token GitHub refuses is refused, and any other failure is a failure', async () => {
    async function answerOf(fetch: Fetch): Promise<unknown> {
      return answered(
        new GithubIdentity('https://github.test', fetch, () => 0),
        'secret',
      );
    }
    deepStrictEqual(
      [
        await answerOf(fetchAnswering(401, {}).fetch),
        await answerOf(fetchAnswering(500, {}).fetch),
        await answerOf(fetchAnswering(200, 'not json').fetch),
        await answerOf(fetchAnswering(200, {id: '42', login: 'octo'}).fetch),
        await answerOf(fetchAnswering(200, null).fetch),
        await answerOf(() => Promise.reject(new Error('offline'))),
      ],
      [
        {kind: 'refused'},
        {kind: 'failed', reason: 'GitHub answered 500'},
        {kind: 'failed', reason: 'GitHub answered with no account'},
        {kind: 'failed', reason: 'GitHub answered with no account'},
        {kind: 'failed', reason: 'GitHub answered with no account'},
        {kind: 'failed', reason: 'Error: offline'},
      ],
    );
  });
});

describe('the answers GitHub gave, kept', () => {
  /** A lookup that answers every token with its own account, and how many times it asked. */
  function counted(now: () => number) {
    let asked = 0;
    const identity = new GithubIdentity(
      'https://github.test',
      () => {
        asked += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({id: asked, login: `user${String(asked)}`}),
          ),
        );
      },
      now,
    );
    return {identity, asked: () => asked};
  }

  it('keeps at most a thousand, dropping the oldest when full, so the first token is asked again', async () => {
    const {identity, asked} = counted(() => 0);
    for (let index = 0; index <= KEPT_MOST; index++) {
      await answered(identity, `token-${String(index)}`);
    }
    await answered(identity, `token-${String(KEPT_MOST)}`);
    const beforeFirst = asked();
    await answered(identity, 'token-0');
    deepStrictEqual([beforeFirst, asked()], [KEPT_MOST + 1, KEPT_MOST + 2]);
  });
});

describe('the refusals and the order of the answers kept', () => {
  /** A lookup that answers with `statuses` in turn, then 500, and how many times it asked. */
  function answeringInTurn(statuses: number[], now: () => number) {
    let asked = 0;
    const identity = new GithubIdentity(
      'https://github.test',
      () => {
        const status = statuses[asked] ?? 500;
        asked += 1;
        return Promise.resolve(
          new Response(JSON.stringify({id: asked, login: 'octo'}), {status}),
        );
      },
      now,
    );
    return {identity, asked: () => asked};
  }

  it('keeps a refused token as refused for a minute, answers it from the kept answer without asking, and asks again after', async () => {
    let clock = 0;
    const {identity, asked} = answeringInTurn([401, 401], () => clock);
    const first = await answered(identity, 'bad');
    clock = 60 * 1000 - 1;
    const kept = await answered(identity, 'bad');
    const keptAsked = asked();
    clock = 60 * 1000;
    const again = await answered(identity, 'bad');
    deepStrictEqual(
      [first, kept, keptAsked, again, asked()],
      [{kind: 'refused'}, {kind: 'refused'}, 1, {kind: 'refused'}, 2],
    );
  });

  it('keeps no failure to ask, so the next call asks again', async () => {
    const {identity, asked} = answeringInTurn([500, 500], () => 0);
    await answered(identity, 'token');
    await answered(identity, 'token');
    deepStrictEqual(asked(), 2);
  });

  it('keeps an account five minutes and a refusal one, each from its own start', async () => {
    let clock = 0;
    const {identity, asked} = answeringInTurn(
      [200, 401, 200, 401],
      () => clock,
    );
    await answered(identity, 'good');
    await answered(identity, 'bad');
    clock = 60 * 1000;
    await answered(identity, 'good');
    await answered(identity, 'bad');
    deepStrictEqual(asked(), 3);
  });

  it('makes an answer the most recent when it is read, so the one read least recently goes first at the bound', async () => {
    const {identity, asked} = answeringInTurn(
      Array.from({length: KEPT_MOST + 3}, () => 200),
      () => 0,
    );
    for (let index = 0; index < KEPT_MOST; index += 1) {
      await answered(identity, `token-${String(index)}`);
    }
    // Reading token-0 makes it the most recent; the next keep drops token-1, not token-0.
    await answered(identity, 'token-0');
    await answered(identity, 'fresh');
    const before = asked();
    await answered(identity, 'token-0');
    const zeroKept = asked() === before;
    await answered(identity, 'token-1');
    deepStrictEqual([zeroKept, asked()], [true, before + 1]);
  });

  it('counts the refusals toward the thousand, so random bad tokens cannot grow the kept answers', async () => {
    const {identity, asked} = answeringInTurn(
      Array.from({length: KEPT_MOST + 2}, () => 401),
      () => 0,
    );
    for (let index = 0; index <= KEPT_MOST; index += 1) {
      await answered(identity, `bad-${String(index)}`);
    }
    const before = asked();
    await answered(identity, 'bad-0');
    deepStrictEqual(asked(), before + 1);
  });
});

describe('the allowlist', () => {
  it('admits the numeric ids of its file, skips comments and other lines, and reads the file again when it changes', () => {
    let modified = 1;
    let text = '42\n# the operator\n  7  # a comment\nnot-an-id\n';
    let reads = 0;
    const allowlist = new Allowlist({
      modified: () => modified,
      text: () => {
        reads += 1;
        return text;
      },
    });
    const before = [
      allowlist.admits(42),
      allowlist.admits(7),
      allowlist.admits(8),
    ];
    const unchanged = allowlist.admits(42);
    text = '8\n';
    modified = 2;
    deepStrictEqual(
      [before, unchanged, allowlist.admits(42), allowlist.admits(8), reads],
      [[true, true, false], true, false, true, 2],
    );
  });

  it('announces each reading of its file, whether a check or a refresh asks for it, and only when the file changed', () => {
    let modified = 1;
    let readings = 0;
    const allowlist = new Allowlist(
      {modified: () => modified, text: () => '42\n'},
      () => {
        readings += 1;
      },
    );
    allowlist.refresh();
    allowlist.admits(42);
    allowlist.refresh();
    const unchanged = readings;
    modified = 2;
    allowlist.admits(42);
    modified = 3;
    allowlist.refresh();
    deepStrictEqual([unchanged, readings], [1, 3]);
  });
});

describe('who a request is from', () => {
  /** What the authorities reported, in order. */
  let reported: string[] = [];

  beforeEach(() => {
    reported = [];
  });

  /** The caller or refusal for `authorization`, with GitHub answering `answer` and account 42 admitted. */
  async function callerFor(
    authorization: string | undefined,
    githubStatus = 200,
    tokens = new Tokens(SIGNING_KEY, () => 0),
    stored = TUNNEL_ONE,
  ): Promise<unknown> {
    const authenticate = authenticateWith({
      github: new GithubIdentity(
        'https://github.test',
        fetchAnswering(githubStatus, {id: 42, login: 'octo'}).fetch,
        () => 0,
      ),
      lookups: new LookupLimit(() => 0),
      allowlist: new Allowlist({modified: () => 1, text: () => '42\n'}),
      tokens,
      tunnels: {
        tunnelById: tunnelId => (tunnelId === stored.id ? stored : undefined),
      },
      report: reason => {
        reported.push(reason);
      },
    });
    return authenticate({authorization}, '10.0.0.1');
  }

  it('tells the caller of a lookup that failed one fixed line, and reports why to the relay alone', async () => {
    const answer = await callerFor('github secret', 503);
    deepStrictEqual(
      [JSON.stringify(answer).includes('503'), reported],
      [false, ['GitHub could not be asked: GitHub answered 503']],
    );
  });

  /** An authenticate over GitHub answering `status`, at most ten lookups an address a minute, and how many times GitHub was asked. */
  function limited(status: number) {
    let asked = 0;
    const authenticate = authenticateWith(
      authoritiesOver(
        new GithubIdentity(
          'https://github.test',
          () => {
            asked += 1;
            return Promise.resolve(
              new Response(JSON.stringify({id: 42, login: 'octo'}), {status}),
            );
          },
          () => 0,
        ),
      ),
    );
    return {authenticate, asked: () => asked};
  }

  it('answers the eleventh uncached lookup of an address in a minute with 429 and Retry-After, asks GitHub no more, and still serves another address', async () => {
    const {authenticate, asked} = limited(200);
    const given: unknown[] = [];
    for (let index = 0; index < 11; index += 1) {
      given.push(
        await authenticate(
          {authorization: `github token-${String(index)}`},
          '10.0.0.1',
        ),
      );
    }
    const other = await authenticate(
      {authorization: 'github another'},
      '10.0.0.2',
    );
    deepStrictEqual(
      [
        given
          .slice(0, 10)
          .every(each => (each as {kind?: string}).kind === 'account'),
        given[10],
        other,
        asked(),
      ],
      [
        true,
        {
          status: 429,
          body: {
            title: 'Too Many Requests',
            detail:
              'This address has asked GitHub about too many tokens; try again in 60 seconds.',
          },
          headers: {'Retry-After': '60'},
        },
        {kind: 'account', id: 42, login: 'octo'},
        11,
      ],
    );
  });

  it('answers a cached account and a cached refusal from an address that is at its limit, taking nothing from it', async () => {
    const good = limited(200);
    const refusing = limited(401);
    for (const {authenticate} of [good, refusing]) {
      await authenticate({authorization: 'github kept'}, '10.0.0.1');
      for (let index = 0; index < 9; index += 1) {
        await authenticate(
          {authorization: `github fill-${String(index)}`},
          '10.0.0.1',
        );
      }
    }
    deepStrictEqual(
      [
        await good.authenticate({authorization: 'github kept'}, '10.0.0.1'),
        await refusing.authenticate({authorization: 'github kept'}, '10.0.0.1'),
        good.asked(),
        refusing.asked(),
      ],
      [
        {kind: 'account', id: 42, login: 'octo'},
        {
          status: 401,
          body: {title: 'Unauthorized', detail: 'GitHub refused the token.'},
        },
        10,
        10,
      ],
    );
  });

  it('takes an admitted account from either GitHub form', async () => {
    const account = {kind: 'account', id: 42, login: 'octo'};
    deepStrictEqual(
      [
        await callerFor('github secret'),
        await callerFor('github client_id=abc secret'),
      ],
      [account, account],
    );
  });

  it('takes a tunnel token as its grant, and refuses one that does not check', async () => {
    const tokens = new Tokens(SIGNING_KEY, () => 0);
    deepStrictEqual(
      [
        await callerFor(
          `tunnel ${tokens.issue(TUNNEL_ONE, 'usw2', 'host')}`,
          200,
          tokens,
        ),
        await callerFor('tunnel forged', 200, tokens),
        await callerFor('tunnel one two', 200, tokens),
      ],
      [
        {kind: 'tunnel', tunnelId: 'one', owner: 42, scope: 'host'},
        {
          status: 401,
          body: {
            title: 'Unauthorized',
            detail: 'The tunnel token is not valid.',
          },
        },
        {
          status: 401,
          body: {
            title: 'Unauthorized',
            detail: 'Sign in with a GitHub account.',
          },
        },
      ],
    );
  });

  it('refuses with 403 a valid tunnel token whose owner the allowlist no longer lists', async () => {
    const tokens = new Tokens(SIGNING_KEY, () => 0);
    const unlisted = {...TUNNEL_ONE, owner: 9};
    deepStrictEqual(
      await callerFor(
        `tunnel ${tokens.issue(unlisted, 'usw2', 'host')}`,
        200,
        tokens,
        unlisted,
      ),
      {
        status: 403,
        body: {title: 'Forbidden', detail: NO_LONGER_ADMITTED},
      },
    );
  });

  it('refuses a tunnel token whose tunnel is gone, or is stored with another owner or generation', async () => {
    const tokens = new Tokens(SIGNING_KEY, () => 0);
    const token = `tunnel ${tokens.issue(TUNNEL_ONE, 'usw2', 'connect')}`;
    const refused = {
      status: 401,
      body: {title: 'Unauthorized', detail: 'The tunnel token is not valid.'},
    };
    deepStrictEqual(
      [
        await callerFor(token, 200, tokens, {...TUNNEL_ONE, id: 'two'}),
        await callerFor(token, 200, tokens, {...TUNNEL_ONE, owner: 43}),
        await callerFor(token, 200, tokens, {...TUNNEL_ONE, generation: 'g2'}),
        await callerFor(token, 200, tokens, {...TUNNEL_ONE, name: 'renamed'}),
      ],
      [
        refused,
        refused,
        refused,
        {kind: 'tunnel', tunnelId: 'one', owner: 42, scope: 'connect'},
      ],
    );
  });

  it('refuses no header, other schemes, a refused token, a failed lookup, and an account not on the allowlist', async () => {
    const signIn = {
      status: 401,
      body: {title: 'Unauthorized', detail: 'Sign in with a GitHub account.'},
    };
    const notAdmitted = authenticateWith(
      authoritiesOver(
        new GithubIdentity(
          'https://github.test',
          fetchAnswering(200, {id: 9, login: 'stranger'}).fetch,
          () => 0,
        ),
      ),
    );
    deepStrictEqual(
      [
        await callerFor(undefined),
        await callerFor('github'),
        await callerFor('aad token'),
        await callerFor('bearer token'),
        await callerFor('github secret', 401),
        await callerFor('github secret', 503),
        await notAdmitted({authorization: 'github secret'}, '10.0.0.1'),
      ],
      [
        signIn,
        signIn,
        signIn,
        signIn,
        {
          status: 401,
          body: {title: 'Unauthorized', detail: 'GitHub refused the token.'},
        },
        {
          status: 502,
          body: {
            title: 'Error',
            detail: 'GitHub could not be asked.',
          },
        },
        {
          status: 403,
          body: {
            title: 'Forbidden',
            detail:
              "The tunnel service doesn't admit the GitHub account stranger.",
          },
        },
      ],
    );
  });
});
