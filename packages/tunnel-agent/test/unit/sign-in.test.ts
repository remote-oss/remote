import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type HttpAnswer,
  type HttpRequest,
  signIn,
  type SignInPorts,
} from '../../src/sign-in.ts';
import {stateFolderOf} from '../../src/state.ts';

const CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const TOKEN = 'gho_secret_token_value';

/** One scripted answer of GitHub, or the failure of the request. */
type Scripted = {status: number; json: unknown} | Error;

/** The device code GitHub gives for a code that lives `expiresIn` seconds and is polled every `interval`. */
function deviceCode(expiresIn = 900, interval = 5): Scripted {
  return {
    status: 200,
    json: {
      device_code: 'device-1',
      user_code: 'WDJB-MJHT',
      expires_in: expiresIn,
      interval,
    },
  };
}

/** What a sign-in did: its status, the lines it printed and complained, the sleeps, the requests and the credential. */
interface Outcome {
  status: number;
  printed: string[];
  complained: string[];
  sleeps: number[];
  requests: Array<{url: string; request: HttpRequest}>;
  credential: string | undefined;
  modes: [string, string] | undefined;
}

/**
 * Runs a sign-in over GitHub answers scripted per address, in order (the last one repeats), a clock that each sleep
 * advances, and `input` as the standard input's lines.
 */
async function signInOver(
  script: Record<string, Scripted[]>,
  fromStandardInput: boolean,
  input?: string,
): Promise<Outcome> {
  const home = mkdtempSync(path.join(tmpdir(), 'sign-in-'));
  const stateFolder = stateFolderOf(home);
  const outcome: Outcome = {
    status: -1,
    printed: [],
    complained: [],
    sleeps: [],
    requests: [],
    credential: undefined,
    modes: undefined,
  };
  const counts = new Map<string, number>();
  let clock = 0;
  const ports: SignInPorts = {
    fetch: (url, request) => {
      outcome.requests.push({url, request});
      const scripted = script[url] ?? [];
      const index = counts.get(url) ?? 0;
      counts.set(url, index + 1);
      const answer = scripted[Math.min(index, scripted.length - 1)];
      if (answer === undefined || answer instanceof Error) {
        return Promise.reject(answer ?? new Error(`no answer for ${url}`));
      }
      const given: HttpAnswer = {
        status: answer.status,
        json: () => Promise.resolve(answer.json),
      };
      return Promise.resolve(given);
    },
    sleep: milliseconds => {
      outcome.sleeps.push(milliseconds);
      clock += milliseconds;
      return Promise.resolve();
    },
    now: () => clock,
    readLine: () => Promise.resolve(input),
    print: line => outcome.printed.push(line),
    complain: line => outcome.complained.push(line),
    stateFolder,
    clientId: 'client-1',
  };
  try {
    outcome.status = await signIn(ports, fromStandardInput);
    try {
      outcome.credential = readFileSync(
        path.join(stateFolder, 'credential'),
        'utf8',
      );
      outcome.modes = [
        (statSync(stateFolder).mode & 0o777).toString(8),
        (statSync(path.join(stateFolder, 'credential')).mode & 0o777).toString(
          8,
        ),
      ];
    } catch {
      outcome.credential = undefined;
    }
  } finally {
    rmSync(home, {recursive: true, force: true});
  }
  return outcome;
}

/** Whether any line the sign-in wrote holds the token. */
function leaks(outcome: Outcome): boolean {
  return [...outcome.printed, ...outcome.complained].some(line =>
    line.includes(TOKEN),
  );
}

const SIGNED_IN: Scripted = {status: 200, json: {login: 'octocat'}};

describe('tunnel-agent login', () => {
  it('signs in by the device flow: it shows the code and the address, waits at the interval through a pending answer, checks the token, keeps it at the user-only modes and says who signed in', async () => {
    const outcome = await signInOver(
      {
        [CODE_URL]: [deviceCode()],
        [TOKEN_URL]: [
          {status: 200, json: {error: 'authorization_pending'}},
          {status: 200, json: {access_token: TOKEN}},
        ],
        [USER_URL]: [SIGNED_IN],
      },
      false,
    );
    deepStrictEqual(
      [
        outcome.status,
        outcome.printed,
        outcome.complained,
        outcome.sleeps,
        outcome.credential,
        outcome.modes,
        leaks(outcome),
      ],
      [
        0,
        [
          'Your code: WDJB-MJHT',
          'Enter it at https://github.com/login/device',
          'signed in as octocat',
        ],
        [],
        [5000, 5000],
        `${TOKEN}\n`,
        ['700', '600'],
        false,
      ],
    );
  });

  it('asks GitHub for the code with the app’s id and the read:user scope, polls with the device code and the device grant, and checks the token with the bearer header', async () => {
    const outcome = await signInOver(
      {
        [CODE_URL]: [deviceCode()],
        [TOKEN_URL]: [{status: 200, json: {access_token: TOKEN}}],
        [USER_URL]: [SIGNED_IN],
      },
      false,
    );
    deepStrictEqual(
      outcome.requests.map(({url, request}) => [
        url,
        request.method,
        request.body,
        request.headers.authorization,
      ]),
      [
        [CODE_URL, 'POST', 'client_id=client-1&scope=read%3Auser', undefined],
        [
          TOKEN_URL,
          'POST',
          'client_id=client-1&device_code=device-1&grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code',
          undefined,
        ],
        [USER_URL, 'GET', undefined, `Bearer ${TOKEN}`],
      ],
    );
  });

  it('lengthens each wait by five seconds when GitHub says slow_down', async () => {
    const outcome = await signInOver(
      {
        [CODE_URL]: [deviceCode()],
        [TOKEN_URL]: [
          {status: 200, json: {error: 'slow_down'}},
          {status: 200, json: {error: 'slow_down'}},
          {status: 200, json: {access_token: TOKEN}},
        ],
        [USER_URL]: [SIGNED_IN],
      },
      false,
    );
    deepStrictEqual(outcome.sleeps, [5000, 10000, 15000]);
  });

  it('ends a code that expires, by the error and by the clock, each with its own line and status 1, keeping nothing', async () => {
    const byError = await signInOver(
      {
        [CODE_URL]: [deviceCode()],
        [TOKEN_URL]: [{status: 200, json: {error: 'expired_token'}}],
      },
      false,
    );
    const byClock = await signInOver(
      {
        [CODE_URL]: [deviceCode(10, 5)],
        [TOKEN_URL]: [{status: 200, json: {error: 'authorization_pending'}}],
      },
      false,
    );
    deepStrictEqual(
      [byError, byClock].map(outcome => [
        outcome.status,
        outcome.complained,
        outcome.credential,
        outcome.sleeps,
      ]),
      [
        [
          1,
          ['tunnel-agent login: the code expired before it was entered'],
          undefined,
          [5000],
        ],
        [
          1,
          ['tunnel-agent login: the code expired before it was entered'],
          undefined,
          [5000, 5000],
        ],
      ],
    );
  });

  it('ends a denied sign-in, an error GitHub names that the agent does not know, and an answer with neither token nor error, each with its own line and status 1', async () => {
    const outcomes = await Promise.all(
      [
        {error: 'access_denied'},
        {error: 'incorrect_client_credentials'},
        {},
      ].map(json =>
        signInOver(
          {
            [CODE_URL]: [deviceCode()],
            [TOKEN_URL]: [{status: 502, json}],
          },
          false,
        ),
      ),
    );
    deepStrictEqual(
      outcomes.map(outcome => [outcome.status, outcome.complained]),
      [
        [1, ['tunnel-agent login: the sign-in was denied on GitHub']],
        [
          1,
          [
            'tunnel-agent login: GitHub answered incorrect_client_credentials to the sign-in',
          ],
        ],
        [1, ['tunnel-agent login: GitHub answered status 502 to the sign-in']],
      ],
    );
  });

  it('fails when GitHub gives no device code: a refusal, an answer without the fields, and an answer that is no object', async () => {
    const outcomes = await Promise.all(
      [
        {status: 400, json: {error: 'device_flow_disabled'}},
        {status: 200, json: {user_code: 'X'}},
        {status: 200, json: null},
      ].map(answer => signInOver({[CODE_URL]: [answer]}, false)),
    );
    deepStrictEqual(
      outcomes.map(outcome => [outcome.status, outcome.complained]),
      [
        [1, ['tunnel-agent login: GitHub gave no device code (status 400)']],
        [1, ['tunnel-agent login: GitHub gave no device code (status 200)']],
        [1, ['tunnel-agent login: GitHub gave no device code (status 200)']],
      ],
    );
  });

  it('signs in with the first line of the standard input with --token-stdin, trimmed, and shows nothing of the token', async () => {
    const outcome = await signInOver(
      {[USER_URL]: [SIGNED_IN]},
      true,
      `  ${TOKEN}  `,
    );
    deepStrictEqual(
      [
        outcome.status,
        outcome.printed,
        outcome.credential,
        outcome.requests.map(({url}) => url),
        leaks(outcome),
      ],
      [0, ['signed in as octocat'], `${TOKEN}\n`, [USER_URL], false],
    );
  });

  it('fails --token-stdin with no token on standard input, for an empty line and for an input with no line, keeping nothing', async () => {
    const outcomes = await Promise.all(
      ['   ', undefined].map(input => signInOver({}, true, input)),
    );
    deepStrictEqual(
      outcomes.map(outcome => [
        outcome.status,
        outcome.complained,
        outcome.credential,
        outcome.requests.length,
      ]),
      [
        [1, ['tunnel-agent login: no token on standard input'], undefined, 0],
        [1, ['tunnel-agent login: no token on standard input'], undefined, 0],
      ],
    );
  });

  it('keeps nothing when GitHub refuses the token, and says so without the token', async () => {
    const outcome = await signInOver(
      {[USER_URL]: [{status: 401, json: {message: 'Bad credentials'}}]},
      true,
      TOKEN,
    );
    deepStrictEqual(
      [outcome.status, outcome.complained, outcome.credential, leaks(outcome)],
      [1, ['tunnel-agent login: GitHub refused the token'], undefined, false],
    );
  });

  it('keeps nothing when GitHub answers the check with another status, or with no login', async () => {
    const outcomes = await Promise.all(
      [
        {status: 500, json: {}},
        {status: 200, json: {name: 'no login'}},
      ].map(answer => signInOver({[USER_URL]: [answer]}, true, TOKEN)),
    );
    deepStrictEqual(
      outcomes.map(outcome => [
        outcome.status,
        outcome.complained,
        outcome.credential,
      ]),
      [
        [
          1,
          ['tunnel-agent login: GitHub did not name the account (status 500)'],
          undefined,
        ],
        [
          1,
          ['tunnel-agent login: GitHub did not name the account (status 200)'],
          undefined,
        ],
      ],
    );
  });

  it('fails with a line of its own when a request cannot reach GitHub, naming the failure and nothing secret', async () => {
    const outcome = await signInOver(
      {[USER_URL]: [new Error('getaddrinfo ENOTFOUND api.github.com')]},
      true,
      TOKEN,
    );
    deepStrictEqual(
      [outcome.status, outcome.complained, outcome.credential, leaks(outcome)],
      [
        1,
        [
          'tunnel-agent login: could not reach GitHub: getaddrinfo ENOTFOUND api.github.com',
        ],
        undefined,
        false,
      ],
    );
  });
});
