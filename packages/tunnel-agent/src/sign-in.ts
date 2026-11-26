/**
 * @fileoverview `tunnel-agent login`: signs the host in with GitHub, by the device flow or with a token read from the
 * standard input, checks the token against GitHub, and keeps it as the agent's credential. The token goes to GitHub
 * and to the credential file only; it is never printed.
 */

import {writeStateFile} from './state.ts';

/** What a request to GitHub is made of. */
export interface HttpRequest {
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** The part of an answer that the sign-in reads. */
export interface HttpAnswer {
  status: number;
  json(): Promise<unknown>;
}

/** The one way the sign-in reaches GitHub; the agent passes the platform's `fetch`. */
type HttpFetch = (
  url: string,
  request: HttpRequest,
) => Promise<HttpAnswer>;

/** What a sign-in runs on. */
export interface SignInPorts {
  fetch: HttpFetch;
  /** Waits `milliseconds`. */
  sleep(milliseconds: number): Promise<void>;
  /** The time in milliseconds. */
  now(): number;
  /** One line of the standard input, without its line end; undefined when it holds none. */
  readLine(): Promise<string | undefined>;
  /** Writes one line to the standard output. */
  print(line: string): void;
  /** Writes one line to the standard error. */
  complain(line: string): void;
  /** The agent's state folder. */
  stateFolder: string;
  /** The public id of the GitHub app the agent signs in with. */
  clientId: string;
}

/** Where the device flow asks for a code. */
const DEVICE_CODE_URL = 'https://github.com/login/device/code';

/** Where the device flow polls for the token. */
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';

/** The address the user opens to enter the code. */
const VERIFICATION_URL = 'https://github.com/login/device';

/** The account the token signs in. */
const USER_URL = 'https://api.github.com/user';

/** The scope the agent asks for: the account's login name. */
const SCOPE = 'read:user';

/** How much longer GitHub's `slow_down` makes each wait, in seconds. */
const SLOW_DOWN_SECONDS = 5;

/** The grant type of the device flow's token request. */
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** The headers every request carries: GitHub refuses a request with no user agent. */
const JSON_HEADERS = {
  accept: 'application/json',
  'user-agent': 'tunnel-agent',
};

/** The exit status of a sign-in that did not sign in. */
const FAILED = 1;

/** The fields of a JSON answer that is an object, else none. */
function fieldsOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

/** A form body of `fields`. */
function formOf(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

/** The text `value` holds when it is a text that is not empty. */
function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** The seconds `value` holds when it is a positive number. */
function secondsOf(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/** What GitHub says to start the device flow. */
interface DeviceCode {
  deviceCode: string;
  userCode: string;
  expiresInSeconds: number;
  intervalSeconds: number;
}

/** The device code GitHub gave, or why it gave none. */
async function requestDeviceCode(
  ports: SignInPorts,
): Promise<DeviceCode | string> {
  const answer = await ports.fetch(DEVICE_CODE_URL, {
    method: 'POST',
    headers: {
      ...JSON_HEADERS,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: formOf({client_id: ports.clientId, scope: SCOPE}),
  });
  const fields = fieldsOf(await answer.json());
  const deviceCode = textOf(fields.device_code);
  const userCode = textOf(fields.user_code);
  const expiresInSeconds = secondsOf(fields.expires_in);
  const intervalSeconds = secondsOf(fields.interval);
  if (
    answer.status !== 200 ||
    deviceCode === undefined ||
    userCode === undefined ||
    expiresInSeconds === undefined ||
    intervalSeconds === undefined
  ) {
    return `GitHub gave no device code (status ${String(answer.status)})`;
  }
  return {deviceCode, userCode, expiresInSeconds, intervalSeconds};
}

/** How the device flow ended: the token, or the line that says why not. */
type DeviceOutcome = {token: string} | {failure: string};

/** Polls GitHub for the token of `code` until it is given, refused, or the code expires. */
async function pollForToken(
  ports: SignInPorts,
  code: DeviceCode,
): Promise<DeviceOutcome> {
  const deadline = ports.now() + code.expiresInSeconds * 1000;
  let intervalSeconds = code.intervalSeconds;
  while (ports.now() < deadline) {
    await ports.sleep(intervalSeconds * 1000);
    const answer = await ports.fetch(ACCESS_TOKEN_URL, {
      method: 'POST',
      headers: {
        ...JSON_HEADERS,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: formOf({
        client_id: ports.clientId,
        device_code: code.deviceCode,
        grant_type: DEVICE_GRANT,
      }),
    });
    const fields = fieldsOf(await answer.json());
    const token = textOf(fields.access_token);
    if (token !== undefined) {
      return {token};
    }
    const error = textOf(fields.error);
    if (error === 'slow_down') {
      intervalSeconds += SLOW_DOWN_SECONDS;
    } else if (error === 'expired_token') {
      return {failure: 'the code expired before it was entered'};
    } else if (error === 'access_denied') {
      return {failure: 'the sign-in was denied on GitHub'};
    } else if (error !== 'authorization_pending') {
      return {
        failure: `GitHub answered ${error ?? `status ${String(answer.status)}`} to the sign-in`,
      };
    }
  }
  return {failure: 'the code expired before it was entered'};
}

/** The token the device flow gave, or why it gave none; the code and the address it shows go to the output. */
async function tokenByDeviceFlow(ports: SignInPorts): Promise<DeviceOutcome> {
  const code = await requestDeviceCode(ports);
  if (typeof code === 'string') {
    return {failure: code};
  }
  ports.print(`Your code: ${code.userCode}`);
  ports.print(`Enter it at ${VERIFICATION_URL}`);
  return pollForToken(ports, code);
}

/** The token on the first line of the standard input, or the line that says why there is none. */
async function tokenFromInput(ports: SignInPorts): Promise<DeviceOutcome> {
  const token = (await ports.readLine())?.trim();
  return token === undefined || token === ''
    ? {failure: 'no token on standard input'}
    : {token};
}

/** The login GitHub gives the token, or the line that says why not; nothing is kept. */
async function loginOf(
  ports: SignInPorts,
  token: string,
): Promise<{login: string} | {failure: string}> {
  const answer = await ports.fetch(USER_URL, {
    method: 'GET',
    headers: {...JSON_HEADERS, authorization: `Bearer ${token}`},
  });
  if (answer.status === 401) {
    return {failure: 'GitHub refused the token'};
  }
  const login = textOf(fieldsOf(await answer.json()).login);
  return answer.status === 200 && login !== undefined
    ? {login}
    : {
        failure: `GitHub did not name the account (status ${String(answer.status)})`,
      };
}

/**
 * Signs in, by the device flow or by the token on the standard input, checks the token against GitHub and keeps it
 * as the credential, at the agent's user-only mode. Gives the exit status; a failure says why on the standard error
 * and keeps nothing.
 */
export async function signIn(
  ports: SignInPorts,
  fromStandardInput: boolean,
): Promise<number> {
  try {
    const obtained = await (fromStandardInput
      ? tokenFromInput(ports)
      : tokenByDeviceFlow(ports));
    if ('failure' in obtained) {
      ports.complain(`tunnel-agent login: ${obtained.failure}`);
      return FAILED;
    }
    const checked = await loginOf(ports, obtained.token);
    if ('failure' in checked) {
      ports.complain(`tunnel-agent login: ${checked.failure}`);
      return FAILED;
    }
    writeStateFile(ports.stateFolder, 'credential', `${obtained.token}\n`);
    ports.print(`signed in as ${checked.login}`);
    return 0;
  } catch (caught) {
    // A request that failed to reach GitHub, or an answer that was not JSON: the message names neither token nor code.
    ports.complain(
      `tunnel-agent login: could not reach GitHub: ${(caught as Error).message}`,
    );
    return FAILED;
  }
}
