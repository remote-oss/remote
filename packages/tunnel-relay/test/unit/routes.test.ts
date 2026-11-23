import {deepStrictEqual} from 'node:assert';
import type {RelayConfig} from '../../src/config.ts';
import {problem, type Answer} from '../../src/problem.ts';
import {
  API_VERSION,
  route,
  type Authenticate,
  type Caller,
  type RouteContext,
} from '../../src/routes.ts';
import {Store} from '../../src/store.ts';
import {Tokens} from '../../src/auth/tokens.ts';

const CONFIG: RelayConfig = {
  domain: 'relay.test',
  port: 443,
  certificateFile: '',
  keyFile: '',
  storeFile: ':memory:',
  clusterId: 'usw2',
};

const OWNER: Caller = {kind: 'account', id: 7, login: 'owner'};
const OTHER: Caller = {kind: 'account', id: 8, login: 'other'};

/** The relay's tokens at a fixed time, signed with a fixed key. */
const TOKENS = new Tokens(Buffer.alloc(32, 1), () => 0);

describe('the management routes of the relay', () => {
  let store: Store;
  let caller: Caller | Answer;

  function authenticate(): ReturnType<Authenticate> {
    return Promise.resolve(caller);
  }

  function context(config: RelayConfig = CONFIG): RouteContext {
    return {
      store,
      config,
      authenticate,
      tokens: TOKENS,
      report: () => undefined,
    };
  }

  /** Sends `method path` with the API version and `query`, `body` and `headers`. */
  function send(
    method: string,
    path: string,
    options: {
      query?: Record<string, string>;
      body?: unknown;
      headers?: Record<string, string>;
      version?: string | null;
      config?: RelayConfig;
    } = {},
  ): Promise<Answer> {
    const query = new URLSearchParams(options.query);
    if (options.version !== null) {
      query.set('api-version', options.version ?? API_VERSION);
    }
    return route(
      {
        method,
        path,
        query,
        headers: options.headers ?? {},
        readBody: () => Promise.resolve(options.body),
      },
      context(options.config),
    );
  }

  function detailOf(answer: Answer): [number, string] {
    return [answer.status, (answer.body as {detail: string}).detail];
  }

  beforeEach(() => {
    store = new Store(':memory:');
    caller = OWNER;
  });

  afterEach(() => {
    store.close();
  });

  describe('every request', () => {
    it('passes on a failure to read the body that is no refusal, for the server to answer 500', async () => {
      let failure = '';
      try {
        await route(
          {
            method: 'PUT',
            path: '/tunnels/one',
            query: new URLSearchParams({'api-version': API_VERSION}),
            headers: {},
            readBody: () => Promise.reject(new Error('the stream broke')),
          },
          context(),
        );
      } catch (caught) {
        failure = String(caught);
      }
      deepStrictEqual(failure, 'Error: the stream broke');
    });

    it('answers 400 to a path with an escape that decodes to nothing', async () => {
      deepStrictEqual(detailOf(await send('GET', '/tunnels/%E0%A4%A')), [
        400,
        'The path is not valid.',
      ]);
    });

    it('needs the one API version', async () => {
      deepStrictEqual(
        [
          detailOf(await send('GET', '/tunnels', {version: null})),
          detailOf(await send('GET', '/tunnels', {version: '2023-01-01'})),
        ],
        [
          [400, `The api-version must be ${API_VERSION}.`],
          [400, `The api-version must be ${API_VERSION}.`],
        ],
      );
    });

    it('answers 404 for a route outside the tunnels, the cluster recommendations among them', async () => {
      deepStrictEqual(
        [
          detailOf(await send('GET', '/userlimits')),
          detailOf(await send('GET', '/clusters/recommendations')),
          detailOf(await send('PUT', '/clusters')),
          detailOf(await send('GET', '/tunnels/a/ports/1/more')),
        ],
        Array(4).fill([404, 'There is no such route.']),
      );
    });

    it('answers /clusters with its one cluster and the address of its service', async () => {
      deepStrictEqual(
        [
          await send('GET', '/clusters'),
          (await send('GET', '/clusters', {config: {...CONFIG, port: 8443}}))
            .body,
        ],
        [
          {
            status: 200,
            body: [
              {
                clusterId: 'usw2',
                uri: 'https://cp.relay.test',
                azureLocation: '',
              },
            ],
          },
          [
            {
              clusterId: 'usw2',
              uri: 'https://cp.relay.test:8443',
              azureLocation: '',
            },
          ],
        ],
      );
    });

    it("answers with the refusal of a caller who isn't signed in", async () => {
      caller = problem(401, 'Sign in with a GitHub account.');
      deepStrictEqual(detailOf(await send('GET', '/tunnels')), [
        401,
        'Sign in with a GitHub account.',
      ]);
    });
  });

  describe('a tunnel', () => {
    it('is created with the id the client chose, with clusterId and tunnelId, its name in lower case and its ports', async () => {
      const created = await send('PUT', '/tunnels/my-tunnel', {
        query: {includePorts: 'true'},
        body: {
          name: 'Web',
          description: 'mine',
          labels: ['a'],
          ports: [{portNumber: 8080, protocol: 'auto'}, 'junk', {}],
          tunnelId: 'ignored',
          clusterId: 'ignored',
          status: {},
        },
      });
      deepStrictEqual(created, {
        status: 200,
        body: {
          description: 'mine',
          labels: ['a'],
          tunnelId: 'my-tunnel',
          clusterId: 'usw2',
          name: 'web',
          ports: [
            {
              portNumber: 8080,
              protocol: 'auto',
              tunnelId: 'my-tunnel',
              clusterId: 'usw2',
            },
          ],
          endpoints: [],
        },
      });
    });

    it('is updated with merge semantics: absent fields are kept and read-only ones ignored', async () => {
      await send('PUT', '/tunnels/one', {
        body: {name: 'web', description: 'first', labels: ['a']},
      });
      const updated = await send('PUT', '/tunnels/one', {
        body: {description: 'second', created: 'ignored'},
      });
      deepStrictEqual(updated.body, {
        description: 'second',
        labels: ['a'],
        tunnelId: 'one',
        clusterId: 'usw2',
        name: 'web',
        endpoints: [],
      });
    });

    it('keeps its ports across an update, merging the ones the update names', async () => {
      await send('PUT', '/tunnels/one', {
        body: {ports: [{portNumber: 80, protocol: 'http', description: 'a'}]},
      });
      await send('PUT', '/tunnels/one', {
        body: {ports: [{portNumber: 80, description: 'b'}]},
      });
      deepStrictEqual(store.portsOf('one'), [
        {portNumber: 80, protocol: 'http', description: 'b'},
      ]);
    });

    it('is refused, and nothing is stored, when a port it lists has a number outside 1 to 65535 or none that is a whole number', async () => {
      const seen = [];
      for (const portNumber of [0, 65536, 1.5, '80', null]) {
        seen.push(
          detailOf(
            await send('PUT', '/tunnels/one', {
              body: {name: 'web', ports: [{portNumber}]},
            }),
          ),
        );
      }
      deepStrictEqual(
        [seen, store.tunnelById('one'), store.portsOf('one')],
        [
          Array<[number, string]>(5).fill([
            400,
            'The port number is not valid.',
          ]),
          undefined,
          [],
        ],
      );
    });

    it('keeps a listed port with no number out of the store, as before', async () => {
      await send('PUT', '/tunnels/one', {
        body: {ports: [{protocol: 'http'}, 'text']},
      });
      deepStrictEqual(store.portsOf('one'), []);
    });

    it('is refused for an id, name, labels or description the contract does not allow, or a body that is not a tunnel', async () => {
      deepStrictEqual(
        [
          detailOf(await send('PUT', '/tunnels/AB', {body: {}})),
          detailOf(await send('PUT', '/tunnels/one', {body: 'text'})),
          detailOf(await send('PUT', '/tunnels/one', {body: []})),
          detailOf(await send('PUT', '/tunnels/one', {body: null})),
          detailOf(await send('PUT', '/tunnels/one', {body: {name: 'ab'}})),
          detailOf(await send('PUT', '/tunnels/one', {body: {name: 3}})),
          detailOf(await send('PUT', '/tunnels/one', {body: {labels: 'a'}})),
          detailOf(
            await send('PUT', '/tunnels/one', {body: {labels: ['a b']}}),
          ),
          detailOf(
            await send('PUT', '/tunnels/one', {
              body: {description: 'x'.repeat(401)},
            }),
          ),
          detailOf(await send('PUT', '/tunnels/one', {body: {description: 1}})),
        ],
        [
          [400, 'The tunnel id is not valid.'],
          [400, 'The body must be a tunnel.'],
          [400, 'The body must be a tunnel.'],
          [400, 'The body must be a tunnel.'],
          [400, 'The tunnel name is not valid.'],
          [400, 'The tunnel name is not valid.'],
          [400, 'The tunnel labels are not valid.'],
          [400, 'The tunnel labels are not valid.'],
          [400, 'The tunnel description is not valid.'],
          [400, 'The tunnel description is not valid.'],
        ],
      );
    });

    it('is refused as existing for If-None-Match: *, and taken when another account holds its id', async () => {
      await send('PUT', '/tunnels/one', {body: {}});
      const exists = await send('PUT', '/tunnels/one', {
        body: {},
        headers: {'if-none-match': '*'},
      });
      caller = OTHER;
      const taken = await send('PUT', '/tunnels/one', {body: {}});
      deepStrictEqual(
        [detailOf(exists), detailOf(taken)],
        [
          [409, 'The tunnel exists.'],
          [409, 'The tunnel id is taken.'],
        ],
      );
    });

    it('keeps a name unique per account: 409 without forceRename, and with it the other tunnel loses the name', async () => {
      await send('PUT', '/tunnels/one', {body: {name: 'web'}});
      const refused = await send('PUT', '/tunnels/two', {body: {name: 'WEB'}});
      const forced = await send('PUT', '/tunnels/two', {
        body: {name: 'web'},
        query: {forceRename: 'true'},
      });
      caller = OTHER;
      const otherAccount = await send('PUT', '/tunnels/three', {
        body: {name: 'web'},
      });
      deepStrictEqual(
        [
          detailOf(refused),
          forced.status,
          store.tunnelById('one')?.name,
          store.tunnelById('two')?.name,
          otherAccount.status,
        ],
        [[409, 'The tunnel name is taken.'], 200, '', 'web', 200],
      );
    });

    it('is read by id or by name, and only by its owner', async () => {
      await send('PUT', '/tunnels/one', {body: {name: 'web'}});
      const byId = await send('GET', '/tunnels/one');
      const byName = await send('GET', '/tunnels/WEB');
      caller = OTHER;
      const other = await send('GET', '/tunnels/one');
      deepStrictEqual(
        [
          (byId.body as {tunnelId: string}).tunnelId,
          (byName.body as {tunnelId: string}).tunnelId,
          detailOf(other),
        ],
        ['one', 'one', [404, 'There is no such tunnel.']],
      );
    });

    it('is deleted by its owner, and is not found after', async () => {
      await send('PUT', '/tunnels/one', {body: {}});
      deepStrictEqual(
        [
          (await send('DELETE', '/tunnels/one')).status,
          detailOf(await send('DELETE', '/tunnels/one')),
          detailOf(await send('GET', '/tunnels/one')),
        ],
        [
          200,
          [404, 'There is no such tunnel.'],
          [404, 'There is no such tunnel.'],
        ],
      );
    });

    it('answers 404 for another method', async () => {
      await send('PUT', '/tunnels/one', {body: {}});
      deepStrictEqual(detailOf(await send('PATCH', '/tunnels/one')), [
        404,
        'There is no such route.',
      ]);
    });
  });

  describe('the list of tunnels', () => {
    beforeEach(async () => {
      await send('PUT', '/tunnels/aaa', {body: {labels: ['x', 'y']}});
      await send('PUT', '/tunnels/bbb', {body: {labels: ['x']}});
      await send('PUT', '/tunnels/ccc', {body: {}});
      caller = OTHER;
      await send('PUT', '/tunnels/ddd', {body: {labels: ['x']}});
      caller = OWNER;
    });

    /** The ids of the listed tunnels, in their by-region shape. */
    async function listed(
      query: Record<string, string> = {},
    ): Promise<string[]> {
      const answer = await send('GET', '/tunnels', {query});
      const [region] = (
        answer.body as {
          value: Array<{
            regionName: string;
            clusterId: string;
            value: Array<{tunnelId: string}>;
          }>;
        }
      ).value;
      deepStrictEqual(
        [region?.regionName, region?.clusterId],
        ['usw2', 'usw2'],
      );
      return (region?.value ?? []).map(tunnel => tunnel.tunnelId);
    }

    it("lists the caller's own tunnels, with global=true or without", async () => {
      deepStrictEqual(
        [await listed(), await listed({global: 'true'})],
        [
          ['aaa', 'bbb', 'ccc'],
          ['aaa', 'bbb', 'ccc'],
        ],
      );
    });

    it('filters by labels, any of them or, with allLabels=true, all of them', async () => {
      deepStrictEqual(
        [
          await listed({labels: 'y'}),
          await listed({labels: 'x,y'}),
          await listed({labels: 'x,y', allLabels: 'true'}),
        ],
        [['aaa'], ['aaa', 'bbb'], ['aaa']],
      );
    });

    it('stops at the limit, and ignores a limit that is not a count', async () => {
      deepStrictEqual(
        [
          await listed({limit: '2'}),
          await listed({limit: '0'}),
          await listed({limit: 'many'}),
          await listed({limit: '-1'}),
        ],
        [['aaa', 'bbb'], [], ['aaa', 'bbb', 'ccc'], ['aaa', 'bbb', 'ccc']],
      );
    });

    it('answers 404 for another method on the list', async () => {
      deepStrictEqual(detailOf(await send('POST', '/tunnels')), [
        404,
        'There is no such route.',
      ]);
    });
  });

  describe('the name check', () => {
    it("says whether a valid name is free among the caller's tunnels", async () => {
      await send('PUT', '/tunnels/one', {body: {name: 'web'}});
      async function check(name: string): Promise<unknown> {
        return (await send('GET', `/tunnels/${name}:checkNameAvailability`))
          .body;
      }
      const owners = [
        await check('web'),
        await check('WEB'),
        await check('api'),
        await check('ab'),
      ];
      caller = OTHER;
      deepStrictEqual(
        [owners, await check('web')],
        [[false, false, true, false], true],
      );
    });

    it('answers 404 for another method', async () => {
      deepStrictEqual(
        detailOf(await send('PUT', '/tunnels/web:checkNameAvailability')),
        [404, 'There is no such route.'],
      );
    });
  });

  describe("a host's endpoint", () => {
    beforeEach(async () => {
      await send('PUT', '/tunnels/one', {body: {}});
    });

    it('is registered with the addresses of the relay legs and the port address format', async () => {
      const registered = await send('PUT', '/tunnels/one/endpoints/h1-relay', {
        query: {connectionMode: 'TunnelRelay'},
        body: {
          connectionMode: 'TunnelRelay',
          hostId: 'h1',
          hostPublicKeys: ['k'],
        },
      });
      const elsewhere = await send('PUT', '/tunnels/one/endpoints/h2-relay', {
        query: {connectionMode: 'TunnelRelay'},
        body: {hostId: 'h2'},
        config: {...CONFIG, port: 8443},
      });
      deepStrictEqual(
        [
          registered.body,
          (elsewhere.body as {hostRelayUri: string}).hostRelayUri,
        ],
        [
          {
            connectionMode: 'TunnelRelay',
            hostId: 'h1',
            hostPublicKeys: ['k'],
            id: 'h1-relay',
            hostRelayUri: 'wss://cp.relay.test/relay/host/one',
            clientRelayUri: 'wss://cp.relay.test/relay/client/one',
            portUriFormat: 'https://one-{port}.relay.test/',
          },
          'wss://cp.relay.test:8443/relay/host/one',
        ],
      );
    });

    it('is listed on the tunnel', async () => {
      await send('PUT', '/tunnels/one/endpoints/h1-relay', {
        query: {connectionMode: 'TunnelRelay'},
        body: {hostId: 'h1'},
      });
      const tunnel = await send('GET', '/tunnels/one');
      deepStrictEqual(
        (tunnel.body as {endpoints: Array<{id: string}>}).endpoints.map(
          endpoint => endpoint.id,
        ),
        ['h1-relay'],
      );
    });

    it('is refused for another connection mode or a body that is not an endpoint', async () => {
      deepStrictEqual(
        [
          detailOf(
            await send('PUT', '/tunnels/one/endpoints/h1-relay', {body: {}}),
          ),
          detailOf(
            await send('PUT', '/tunnels/one/endpoints/h1-relay', {
              query: {connectionMode: 'TunnelRelay'},
              body: 'text',
            }),
          ),
        ],
        [
          [400, 'The connection mode must be TunnelRelay.'],
          [400, 'The body must be an endpoint.'],
        ],
      );
    });

    it('is unregistered by its id or by its host id, and is not found after', async () => {
      for (const host of ['h1', 'h2']) {
        await send('PUT', `/tunnels/one/endpoints/${host}-relay`, {
          query: {connectionMode: 'TunnelRelay'},
          body: {hostId: host},
        });
      }
      deepStrictEqual(
        [
          (await send('DELETE', '/tunnels/one/endpoints/h1-relay')).status,
          (await send('DELETE', '/tunnels/one/endpoints/h2')).status,
          detailOf(await send('DELETE', '/tunnels/one/endpoints/h2')),
        ],
        [200, 200, [404, 'There is no such endpoint.']],
      );
    });

    it("answers 404 for another method, another route, and another account's tunnel", async () => {
      const getEndpoint = await send('GET', '/tunnels/one/endpoints/h1-relay');
      const unknown = await send('GET', '/tunnels/one/events');
      const noItem = await send('GET', '/tunnels/one/endpoints');
      caller = OTHER;
      const others = await send('GET', '/tunnels/one/ports');
      deepStrictEqual(
        [
          detailOf(getEndpoint),
          detailOf(unknown),
          detailOf(noItem),
          detailOf(others),
        ],
        [
          [404, 'There is no such route.'],
          [404, 'There is no such route.'],
          [404, 'There is no such route.'],
          [404, 'There is no such tunnel.'],
        ],
      );
    });
  });

  describe('a tunnel token', () => {
    beforeEach(async () => {
      await send('PUT', '/tunnels/one', {body: {name: 'web'}});
      await send('PUT', '/tunnels/two', {body: {}});
      await send('PUT', '/tunnels/one/ports/80', {body: {}});
    });

    /** The statuses of each request as a caller holding a token of `scope` for tunnel one. */
    async function statusesAs(
      scope: 'host' | 'connect' | 'manage:ports',
      requests: ReadonlyArray<[string, string, unknown?]>,
    ): Promise<number[]> {
      caller = {kind: 'tunnel', tunnelId: 'one', scope};
      const statuses: number[] = [];
      for (const [method, path, body] of requests) {
        const answer = await send(method, path, {
          body,
          query: {connectionMode: 'TunnelRelay'},
        });
        statuses.push(answer.status);
      }
      return statuses;
    }

    it('reaches only its own tunnel, by id, and as far as its scope grants', async () => {
      const requests: ReadonlyArray<[string, string, unknown?]> = [
        ['GET', '/tunnels/one'],
        ['GET', '/tunnels/web'],
        ['GET', '/tunnels/two'],
        ['GET', '/tunnels/two/ports'],
        ['GET', '/tunnels/one/ports'],
        ['PUT', '/tunnels/one/ports/81', {}],
        ['PUT', '/tunnels/one/endpoints/h1-relay', {hostId: 'h1'}],
        ['PUT', '/tunnels/one', {}],
        ['DELETE', '/tunnels/one'],
        ['GET', '/tunnels'],
        ['GET', '/tunnels/web:checkNameAvailability'],
      ];
      deepStrictEqual(
        {
          host: await statusesAs('host', requests),
          connect: await statusesAs('connect', requests),
          ports: await statusesAs('manage:ports', requests),
        },
        {
          host: [200, 404, 404, 404, 200, 200, 200, 403, 403, 403, 403],
          connect: [200, 404, 404, 404, 200, 403, 403, 403, 403, 403, 403],
          ports: [200, 404, 404, 404, 200, 200, 403, 403, 403, 403, 403],
        },
      );
    });

    it('is refused with the detail that says what it lacks', async () => {
      caller = {kind: 'tunnel', tunnelId: 'one', scope: 'connect'};
      deepStrictEqual(detailOf(await send('DELETE', '/tunnels/one/ports/80')), [
        403,
        'This token does not grant that.',
      ]);
    });

    it('reads its tunnel with no access tokens, whatever scopes it asks for', async () => {
      caller = {kind: 'tunnel', tunnelId: 'one', scope: 'host'};
      const answer = await send('GET', '/tunnels/one', {
        query: {tokenScopes: 'host,connect'},
      });
      deepStrictEqual('accessTokens' in (answer.body as object), false);
    });
  });

  describe("an owner's access tokens", () => {
    it('are one per scope asked for that the relay issues, on create, update, get and list alike', async () => {
      const scopes = {tokenScopes: 'host,connect,manage,manage:ports'};
      const created = await send('PUT', '/tunnels/one', {
        body: {},
        query: scopes,
      });
      const updated = await send('PUT', '/tunnels/one', {
        body: {},
        query: scopes,
      });
      const read = await send('GET', '/tunnels/one', {query: scopes});
      const listed = await send('GET', '/tunnels', {query: scopes});
      const plain = await send('GET', '/tunnels/one');
      function grants(body: unknown): unknown {
        return Object.fromEntries(
          Object.entries(
            (body as {accessTokens: Record<string, string>}).accessTokens,
          ).map(([scope, token]) => [scope, TOKENS.check(token)]),
        );
      }
      const expected = {
        host: {tunnelId: 'one', scope: 'host'},
        connect: {tunnelId: 'one', scope: 'connect'},
        'manage:ports': {tunnelId: 'one', scope: 'manage:ports'},
      };
      deepStrictEqual(
        [
          grants(created.body),
          grants(updated.body),
          grants(read.body),
          grants(
            (listed.body as {value: Array<{value: unknown[]}>}).value[0]
              ?.value[0],
          ),
          'accessTokens' in (plain.body as object),
        ],
        [expected, expected, expected, expected, false],
      );
    });
  });

  describe('access control', () => {
    it('refuses an Anonymous entry that allows, on a tunnel or a port, and keeps a deny and other entries', async () => {
      const allow = {entries: [{type: 'Anonymous', scopes: ['connect']}]};
      const deny = {entries: [{type: 'Anonymous', isDeny: true}]};
      const others = {entries: [{type: 'Users', subjects: ['42']}, 'junk']};
      await send('PUT', '/tunnels/one', {body: {}});
      deepStrictEqual(
        [
          detailOf(
            await send('PUT', '/tunnels/two', {body: {accessControl: allow}}),
          ),
          detailOf(
            await send('PUT', '/tunnels/one/ports/80', {
              body: {accessControl: allow},
            }),
          ),
          (await send('PUT', '/tunnels/three', {body: {accessControl: deny}}))
            .status,
          (
            await send('PUT', '/tunnels/one/ports/80', {
              body: {accessControl: deny},
            })
          ).status,
          (await send('PUT', '/tunnels/four', {body: {accessControl: others}}))
            .status,
          (await send('PUT', '/tunnels/five', {body: {accessControl: 'none'}}))
            .status,
        ],
        [
          [400, "Public access isn't offered."],
          [400, "Public access isn't offered."],
          200,
          200,
          200,
          200,
        ],
      );
    });
  });

  describe("a tunnel's ports", () => {
    beforeEach(async () => {
      await send('PUT', '/tunnels/one', {body: {name: 'web'}});
    });

    it('are created and merged by number, with the tunnel and cluster ids, and listed', async () => {
      const created = await send('PUT', '/tunnels/one/ports/80', {
        body: {protocol: 'http', portNumber: 9},
      });
      await send('PUT', '/tunnels/web/ports/80', {body: {description: 'site'}});
      const listed = await send('GET', '/tunnels/one/ports');
      deepStrictEqual(
        [created.body, listed.body],
        [
          {
            protocol: 'http',
            portNumber: 80,
            tunnelId: 'one',
            clusterId: 'usw2',
          },
          {
            value: [
              {
                protocol: 'http',
                portNumber: 80,
                description: 'site',
                tunnelId: 'one',
                clusterId: 'usw2',
              },
            ],
          },
        ],
      );
    });

    it("keep their protocol: the same one succeeds, a changed one is refused with the clients' detail", async () => {
      await send('PUT', '/tunnels/one/ports/80', {body: {protocol: 'http'}});
      deepStrictEqual(
        [
          (
            await send('PUT', '/tunnels/one/ports/80', {
              body: {protocol: 'http'},
            })
          ).status,
          detailOf(
            await send('PUT', '/tunnels/one/ports/80', {
              body: {protocol: 'https'},
            }),
          ),
        ],
        [200, [400, 'The tunnel port protocol cannot be changed.']],
      );
    });

    it('are read and deleted by number, and not found after', async () => {
      await send('PUT', '/tunnels/one/ports/80', {body: {}});
      deepStrictEqual(
        [
          (await send('GET', '/tunnels/one/ports/80')).body,
          (await send('DELETE', '/tunnels/one/ports/80')).status,
          detailOf(await send('GET', '/tunnels/one/ports/80')),
          detailOf(await send('DELETE', '/tunnels/one/ports/80')),
        ],
        [
          {portNumber: 80, tunnelId: 'one', clusterId: 'usw2'},
          200,
          [404, 'There is no such port.'],
          [404, 'There is no such port.'],
        ],
      );
    });

    it('are refused for a number outside 1 to 65535 or a body that is not a port', async () => {
      deepStrictEqual(
        [
          detailOf(await send('PUT', '/tunnels/one/ports/0', {body: {}})),
          detailOf(await send('PUT', '/tunnels/one/ports/65536', {body: {}})),
          detailOf(await send('PUT', '/tunnels/one/ports/http', {body: {}})),
          detailOf(await send('PUT', '/tunnels/one/ports/80', {body: 'text'})),
        ],
        [
          [400, 'The port number is not valid.'],
          [400, 'The port number is not valid.'],
          [400, 'The port number is not valid.'],
          [400, 'The body must be a port.'],
        ],
      );
    });

    it('answer 404 for another method', async () => {
      await send('PUT', '/tunnels/one/ports/80', {body: {}});
      deepStrictEqual(
        [
          detailOf(await send('POST', '/tunnels/one/ports')),
          detailOf(await send('POST', '/tunnels/one/ports/80')),
        ],
        [
          [404, 'There is no such route.'],
          [404, 'There is no such route.'],
        ],
      );
    });
  });
});
