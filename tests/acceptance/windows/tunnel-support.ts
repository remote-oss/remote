import {execFileSync} from 'node:child_process';
import {connect, createServer, type Server} from 'node:net';
import {
  acceptedPasswords,
  appendScript,
  connectedWithin,
  onHost,
  openWindow,
  windowEvents,
  readUserSettings,
  recordLines,
  restoreUserSettings,
  userSettings,
} from './harness.ts';
import {password} from './maintenance.ts';

/** A listening socket of the runner, with the program that holds it. */
export interface Listener {
  address: string;
  port: number;
  program: string;
}

/**
 * The listening TCP sockets of the runner held by `ssh` or by the editor, as `ss -ltnp` lists them. The editor is told by
 * the program name `codium…`, which is the VSCodium these rows run in.
 */
export function listeners(): Listener[] {
  return execFileSync('ss', ['-ltnp'])
    .toString()
    .split('\n')
    .slice(1)
    .flatMap((line): Listener[] => {
      const columns = line.trim().split(/\s+/);
      const local = columns[3] ?? '';
      const program = /users:\(\("([^"]+)"/.exec(line)?.[1];
      if (program === undefined || !/^(ssh|codium)/.test(program)) {
        return [];
      }
      const colon = local.lastIndexOf(':');
      return [
        {
          address: local.slice(0, colon).replace(/^\[|\]$/g, ''),
          port: Number(local.slice(colon + 1)),
          program: program.startsWith('ssh') ? 'ssh' : 'editor',
        },
      ];
    });
}

/** The listeners of `after` that `before` did not hold, by port. */
export function addedSince(
  before: readonly Listener[],
  after: readonly Listener[],
): Listener[] {
  const ports = new Set(before.map(each => each.port));
  return after.filter(each => !ports.has(each.port));
}

/** What a connect of one window showed and cost. */
export interface Connected {
  /** The password questions the window was asked and answered. */
  prompts: number;
  /** The password logins the host counted since the window began to connect. */
  logins: number;
  /** The surfaces and questions of the window's record, in order. */
  sequence: string[];
  /** The listeners the connect added on the runner. */
  added: Listener[];
}

/** The hosts whose platform the rows store, so that terminal mode asks no pick. */
const LINUX_ALIASES = [
  'harness',
  'password',
  'noforward',
  'nosocket',
  'noall',
  'fwd-clearall',
  'fwd-exit',
  'fwd-busy-exit',
  'fwd-dynamic-exit',
];

/** The settings of the rows: the platform of the hosts is stored, so that terminal mode asks no pick. */
export const PLATFORMS = {
  'remote.SSH.remotePlatform': Object.fromEntries(
    LINUX_ALIASES.map(alias => [alias, 'linux']),
  ),
};

/**
 * Opens window `name` on `alias` under `settings`, answers its password questions, waits until it is connected and
 * gives what the connect showed and cost. The settings are put back afterwards by the caller through `restoreUserSettings`.
 */
export async function connectedWith(
  name: string,
  alias: string,
  settings: Readonly<Record<string, unknown>>,
): Promise<Connected> {
  await userSettings({...PLATFORMS, ...settings});
  const before = listeners();
  const logins = await acceptedPasswords();
  appendScript([1, 2, 3].map(() => ({...password(), window: name})));
  await openWindow(alias, name);
  await connectedWithin(name, 90_000);
  await new Promise(resolve => setTimeout(resolve, 2000));
  return {
    prompts: recordLines('maskedInput', name).filter(
      line => line.answer === '<supplied>',
    ).length,
    logins: (await acceptedPasswords()) - logins,
    sequence: recordLines(undefined, name).map(
      line => `${line.surface}:${line.question}`,
    ),
    added: addedSince(before, listeners()),
  };
}

/** Runs `rowBody` with the user settings as they were at its start put back after it. */
export async function keepingSettings(
  rowBody: () => Promise<void>,
): Promise<void> {
  const saved = readUserSettings();
  try {
    await rowBody();
  } finally {
    restoreUserSettings(saved);
  }
}

/** Listeners of the runner on `ports` that accept connections and close them, with the means to let the ports go. */
export interface HeldPorts {
  release(): Promise<void>;
}

/** Holds each of `ports` on `address` with a listener that accepts connections. */
export async function holdPorts(
  ports: readonly number[],
  address: string,
): Promise<HeldPorts> {
  const servers = await Promise.all(
    ports.map(
      port =>
        new Promise<Server>((resolve, reject) => {
          const server = createServer(socket => socket.destroy());
          server.once('error', reject);
          server.listen(port, address, () => {
            resolve(server);
          });
        }),
    ),
  );
  return {
    release: async () => {
      await Promise.all(
        servers.map(
          server =>
            new Promise<void>(resolve =>
              server.close(() => {
                resolve();
              }),
            ),
        ),
      );
    },
  };
}

/** The port on the host that the listener answers on. */
export const REMOTE_PORT = 8631;

/** What the listener says to a connection. */
export const GREETING = 'forwarded-8631';

/** The script on the host that greets a connection. */
const GREETER = '/tmp/c79-greeter.sh';

/** The greeting a connection to the local `port` is given, over 127.0.0.1. */
export function greetedAt(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1');
    socket.once('data', (chunk: Buffer) => {
      resolve(chunk.toString('utf8').trim());
      socket.destroy();
    });
    socket.on('error', reject);
  });
}

/** The local port a `forwarded` event of window `name` names. */
export function forwardedPortOf(name: string): number {
  const address = windowEvents(name).find(
    each => each.event === 'forwarded',
  )?.localAddress;
  if (address === undefined) {
    throw new Error('the window reported no forwarded port');
  }
  return typeof address === 'string'
    ? Number(address.slice(address.lastIndexOf(':') + 1))
    : address.port;
}

/** Starts the listener on the host that greets each connection to its port. */
export async function startGreeter(): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `printf '#!/bin/sh\\necho ${GREETING}\\nsleep 30\\n' > ${GREETER} && chmod 755 ${GREETER}; nohup nc -lk -p ${String(REMOTE_PORT)} -s 127.0.0.1 -e ${GREETER} >/dev/null 2>&1 &`,
  );
}

/** Stops the greeter of the host. */
export async function stopGreeter(): Promise<void> {
  await onHost(
    'sh',
    '-c',
    `pkill -f "[n]c -lk -p ${String(REMOTE_PORT)}" || true; pkill -f "[c]79-greeter" || true`,
  );
}
