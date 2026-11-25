import {deepStrictEqual, throws} from 'node:assert';
import {configOf} from '../../src/config.ts';
import {
  areLabels,
  isClusterId,
  isTunnelId,
  isTunnelName,
  MAX_DESCRIPTION,
  MAX_LABELS,
} from '../../src/names.ts';
import {problem, success} from '../../src/problem.ts';

/** The message `work` throws with. */
function messageOf(work: () => unknown): string {
  try {
    work();
    return 'no error';
  } catch (error) {
    return (error as Error).message;
  }
}

const SETTINGS = {
  RELAY_DOMAIN: 'relay.test',
  RELAY_PORT: '8443',
  TLS_CERT: '/run/cert.pem',
  TLS_KEY: '/run/key.pem',
  RELAY_STORE: '/run/relay.db',
  RELAY_CLUSTER: 'usw2',
  RELAY_ALLOWLIST: '/run/allowlist',
  RELAY_TOKEN_KEY: '/run/token.key',
};

describe('the contract rules of the relay', () => {
  it('a tunnel id is the old 8-character form or the new 3-to-49 one', () => {
    deepStrictEqual(
      [
        'bcdfghjk',
        'my-tunnel',
        'a1b',
        'a'.repeat(49),
        'a'.repeat(50),
        'ab',
        '-abc',
        'abc-',
        'ABC',
      ].map(isTunnelId),
      [true, true, true, true, false, false, false, false, false],
    );
  });

  it('a tunnel name is empty or 3 to 49 characters, compared in lower case', () => {
    deepStrictEqual(
      ['', 'web', 'WEB', 'a'.repeat(49), 'a'.repeat(50), 'ab', 'a_b'].map(
        isTunnelName,
      ),
      [true, true, true, true, false, false, false],
    );
  });

  it('labels are at most 100 strings of 1 to 50 word characters, hyphens and equals signs', () => {
    deepStrictEqual(
      [
        areLabels(['a', 'b-c', 'd=e', 'x'.repeat(50)]),
        areLabels(['x'.repeat(51)]),
        areLabels(['']),
        areLabels(['a b']),
        areLabels([1]),
        areLabels(Array.from({length: MAX_LABELS}, () => 'a')),
        areLabels(Array.from({length: MAX_LABELS + 1}, () => 'a')),
      ],
      [true, false, false, false, false, true, false],
    );
  });

  it('a cluster id is three or four letters and one to three digits, or a named region', () => {
    deepStrictEqual(
      ['usw2', 'euw', 'asse', 'abc123', 'ab1', 'spike1', 'USW2'].map(
        isClusterId,
      ),
      [true, true, true, true, false, false, false],
    );
  });

  it('a description is at most 400 characters', () => {
    deepStrictEqual(MAX_DESCRIPTION, 400);
  });
});

describe('the answers of the relay', () => {
  it('a problem carries the title of its status and its detail', () => {
    deepStrictEqual(
      [
        [400, 401, 403, 404, 409, 500].map(
          status => (problem(status, 'why').body as {title: string}).title,
        ),
        problem(404, 'There is no such tunnel.'),
      ],
      [
        [
          'Bad Request',
          'Unauthorized',
          'Forbidden',
          'Not Found',
          'Conflict',
          'Error',
        ],
        {
          status: 404,
          body: {title: 'Not Found', detail: 'There is no such tunnel.'},
        },
      ],
    );
  });

  it('a success has a body when given one, and none otherwise', () => {
    deepStrictEqual(
      [success({answer: 1}), success()],
      [{status: 200, body: {answer: 1}}, {status: 200}],
    );
  });
});

describe('the settings of the relay', () => {
  it('reads every setting', () => {
    deepStrictEqual(configOf(SETTINGS), {
      domain: 'relay.test',
      port: 8443,
      certificateFile: '/run/cert.pem',
      keyFile: '/run/key.pem',
      storeFile: '/run/relay.db',
      clusterId: 'usw2',
      githubApi: 'https://api.github.com',
      allowlistFile: '/run/allowlist',
      tokenKeyFile: '/run/token.key',
    });
  });

  it('asks the GitHub API the settings name instead of the public one', () => {
    deepStrictEqual(
      configOf({...SETTINGS, RELAY_GITHUB_API: 'https://github.test'})
        .githubApi,
      'https://github.test',
    );
  });

  it('names a setting that is missing or empty', () => {
    const names = Object.keys(SETTINGS);
    deepStrictEqual(
      names.flatMap(name =>
        [undefined, ''].map(value =>
          messageOf(() => configOf({...SETTINGS, [name]: value})),
        ),
      ),
      names.flatMap(name => [`${name} is not set`, `${name} is not set`]),
    );
  });

  it('refuses a port that is not a port number', () => {
    for (const port of ['0', '65536', '1.5', 'https']) {
      throws(() => configOf({...SETTINGS, RELAY_PORT: port}), {
        message: 'RELAY_PORT is not a port number',
      });
    }
  });

  it("refuses a cluster id the contract doesn't allow", () => {
    throws(() => configOf({...SETTINGS, RELAY_CLUSTER: 'spike1'}), {
      message: "RELAY_CLUSTER does not match the contract's cluster id",
    });
  });
});
