/**
 * @fileoverview The tunnels run's relay stack: the relay image, the run's certificates, the stub identity service and
 * the relay on a Docker network of the run. The conformance run starts it before its first row, and so does the tunnels
 * launch before the editor; both remove it after their last.
 */

import {randomBytes} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {checked, type CommandRunner} from '../../tools/command-runner.ts';
import {startingAllowlist, startingTable} from './identities.ts';

const SUITE_FOLDER = import.meta.dirname;
const ROOT = path.join(SUITE_FOLDER, '..', '..');

/** The relay's image, built in the run from the relay package and never pushed. */
const RELAY_IMAGE = 'remote-oss-tunnel-relay:run';

/** Where the run's folder is mounted in both containers. */
const RUN_MOUNT = '/run-files';

/** Where the suite's folder is mounted, read-only, in the identity service's container. */
const SUITE_MOUNT = '/suite';

/** The relay's port: the clients' default for an `https` address. */
const RELAY_PORT = 443;

/** The identity service's port on the run's network. */
const IDENTITY_PORT = 8080;

/** The identity service's name on the run's network. */
const IDENTITY_ALIAS = 'identity';

/** The run's cluster id, one the contract allows. */
export const RUN_CLUSTER = 'usw2';

/** Each of the relay's limits in the run, low so the limit rows reach them cheaply. */
const RUN_LIMIT = '2';

/** The relay's line once it listens. */
const READY_LINE = 'the relay serves cp.';

/** How often the relay's output is read while the run waits for its ready line, in milliseconds. */
const READY_POLL_MILLISECONDS = 500;

/** What a run of the stack is called: its network, and the names of its two containers. */
export interface StackNames {
  network: string;
  relay: string;
  identity: string;
}

/** The names of the stack whose run folder is `folder`: its network is named after the folder. */
export function namesOf(folder: string): StackNames {
  const network = `tunnels-${path.basename(folder).toLowerCase()}`;
  return {
    network,
    relay: `${network}-relay`,
    identity: `${network}-identity`,
  };
}

/** The files of a run, in its folder. */
export interface RunFiles {
  caFile: string;
  certificateFile: string;
  keyFile: string;
  allowlistFile: string;
  identitiesFile: string;
  tokenKeyFile: string;
  storeFile: string;
}

/** The files of the run whose folder is `folder`. */
export function filesOf(folder: string): RunFiles {
  return {
    caFile: path.join(folder, 'ca.pem'),
    certificateFile: path.join(folder, 'relay.pem'),
    keyFile: path.join(folder, 'relay-key.pem'),
    allowlistFile: path.join(folder, 'allowlist'),
    identitiesFile: path.join(folder, 'identities.json'),
    tokenKeyFile: path.join(folder, 'token-key'),
    storeFile: path.join(folder, 'store.sqlite'),
  };
}

/** The names a relay for `domain` answers: its control plane, the domain itself, and every name under it. */
function relayNamesOf(domain: string): string[] {
  return [`cp.${domain}`, domain, `*.${domain}`];
}

/** The `openssl` options that make a new P-256 key with no passphrase. */
const KEY_OPTIONS = [
  '-newkey',
  'ec',
  '-pkeyopt',
  'ec_paramgen_curve:prime256v1',
  '-nodes',
];

/**
 * Makes the run's certificates in `folder`: a certificate authority of its own, and the relay's certificate for
 * `domain`'s names, signed by it. A client trusts the relay through the authority's file alone.
 */
export function makeRunCertificates(
  command: CommandRunner,
  folder: string,
  domain: string,
): void {
  const files = filesOf(folder);
  const authorityKey = path.join(folder, 'ca-key.pem');
  const request = path.join(folder, 'relay.csr');
  const extensions = path.join(folder, 'relay.ext');
  checked(command, 'openssl', [
    'req',
    '-x509',
    ...KEY_OPTIONS,
    '-keyout',
    authorityKey,
    '-out',
    files.caFile,
    '-days',
    '2',
    '-subj',
    '/CN=remote-oss tunnels run authority',
    '-addext',
    'basicConstraints=critical,CA:TRUE',
    '-addext',
    'keyUsage=critical,keyCertSign',
  ]);
  checked(command, 'openssl', [
    'req',
    ...KEY_OPTIONS,
    '-keyout',
    files.keyFile,
    '-out',
    request,
    '-subj',
    `/CN=cp.${domain}`,
  ]);
  writeFileSync(
    extensions,
    [
      `subjectAltName=${relayNamesOf(domain)
        .map(name => `DNS:${name}`)
        .join(',')}`,
      'basicConstraints=CA:FALSE',
      'keyUsage=digitalSignature',
      'extendedKeyUsage=serverAuth',
      '',
    ].join('\n'),
  );
  checked(command, 'openssl', [
    'x509',
    '-req',
    '-in',
    request,
    '-CA',
    files.caFile,
    '-CAkey',
    authorityKey,
    '-set_serial',
    '1',
    '-days',
    '2',
    '-extfile',
    extensions,
    '-out',
    files.certificateFile,
  ]);
}

/** Writes the run's starting allowlist, identity table and token key into `folder`. */
function writeRunFiles(folder: string): void {
  const files = filesOf(folder);
  writeFileSync(files.allowlistFile, startingAllowlist());
  writeFileSync(files.identitiesFile, JSON.stringify(startingTable()));
  writeFileSync(files.tokenKeyFile, randomBytes(32));
}

/** Where a run file is, seen from inside a container. */
function mounted(file: string): string {
  return path.posix.join(RUN_MOUNT, path.basename(file));
}

/** The relay's settings for a run of `domain` whose folder is `folder`, as `docker run -e` gives them. */
export function relayEnvironmentOf(domain: string, folder: string): string[] {
  const files = filesOf(folder);
  return [
    `RELAY_PORT=${String(RELAY_PORT)}`,
    `RELAY_DOMAIN=${domain}`,
    `RELAY_CLUSTER=${RUN_CLUSTER}`,
    `TLS_CERT=${mounted(files.certificateFile)}`,
    `TLS_KEY=${mounted(files.keyFile)}`,
    `RELAY_STORE=${mounted(files.storeFile)}`,
    `RELAY_GITHUB_API=http://${IDENTITY_ALIAS}:${String(IDENTITY_PORT)}`,
    `RELAY_ALLOWLIST=${mounted(files.allowlistFile)}`,
    `RELAY_TOKEN_KEY=${mounted(files.tokenKeyFile)}`,
    `RELAY_LIMIT_TUNNELS=${RUN_LIMIT}`,
    `RELAY_LIMIT_PORTS=${RUN_LIMIT}`,
    `RELAY_LIMIT_CLIENTS=${RUN_LIMIT}`,
  ].flatMap(setting => ['-e', setting]);
}

/** The options both containers share: detached, on the run's network, as `user`, with the run's folder mounted. */
function containerOptionsOf(
  names: StackNames,
  name: string,
  folder: string,
  user: string,
): string[] {
  return [
    'run',
    '--detach',
    '--name',
    name,
    '--network',
    names.network,
    '--user',
    user,
    '--volume',
    `${folder}:${RUN_MOUNT}`,
  ];
}

/** The `docker` arguments that start the identity service of a run whose folder is `folder`. */
export function identityArgumentsOf(
  names: StackNames,
  folder: string,
  user: string,
): string[] {
  return [
    ...containerOptionsOf(names, names.identity, folder, user),
    '--network-alias',
    IDENTITY_ALIAS,
    '--volume',
    `${SUITE_FOLDER}:${SUITE_MOUNT}:ro`,
    '-e',
    `STUB_IDENTITIES=${mounted(filesOf(folder).identitiesFile)}`,
    '-e',
    `STUB_PORT=${String(IDENTITY_PORT)}`,
    '--entrypoint',
    'node',
    RELAY_IMAGE,
    path.posix.join(SUITE_MOUNT, 'stub-identity.ts'),
  ];
}

/**
 * The `docker` arguments that start the relay of a run of `domain`: under its control-plane name and the domain on the
 * run's network, and, when `published`, on 127.0.0.1:443 of the runner for the editor there.
 */
export function relayArgumentsOf(
  names: StackNames,
  domain: string,
  folder: string,
  user: string,
  published: boolean,
): string[] {
  return [
    ...containerOptionsOf(names, names.relay, folder, user),
    '--network-alias',
    `cp.${domain}`,
    '--network-alias',
    domain,
    ...(published
      ? ['--publish', `127.0.0.1:${String(RELAY_PORT)}:${String(RELAY_PORT)}`]
      : []),
    ...relayEnvironmentOf(domain, folder),
    RELAY_IMAGE,
  ];
}

/** Builds the relay's image: the relay package deployed from the lockfile into `context`, under the suite's Dockerfile. */
export function buildRelayImage(command: CommandRunner, context: string): void {
  checked(command, 'pnpm', [
    '--dir',
    ROOT,
    '--filter',
    'tunnel-relay',
    'deploy',
    '--prod',
    '--legacy',
    context,
  ]);
  checked(command, 'docker', [
    'build',
    '--quiet',
    '--file',
    path.join(SUITE_FOLDER, 'relay.Dockerfile'),
    '--tag',
    RELAY_IMAGE,
    context,
  ]);
}

/** Whether `logs`, a container's output so far, holds the relay's ready line. */
export function isReady(logs: string): boolean {
  return logs.includes(READY_LINE);
}

/** Waits until the relay container `name` prints its ready line; throws with its output after `limit` milliseconds. */
async function awaitRelay(
  command: CommandRunner,
  name: string,
  limit: number,
): Promise<void> {
  const end = Date.now() + limit;
  for (;;) {
    const logs = checked(command, 'docker', ['logs', name]);
    if (isReady(logs)) {
      return;
    }
    if (Date.now() >= end) {
      throw new Error(
        `the relay printed no ready line in ${String(limit)} ms: ${logs}`,
      );
    }
    await pause(READY_POLL_MILLISECONDS);
  }
}

/** The `docker inspect` format that prints a container's address on `network`. */
function addressFormatOf(network: string): string {
  return `{{(index .NetworkSettings.Networks ${JSON.stringify(network)}).IPAddress}}`;
}

/** A started stack: what a row needs to reach the relay. */
export interface Stack {
  domain: string;
  names: StackNames;
  files: RunFiles;
  /** The relay's address on the run's network, which the runner reaches too, and its port there. */
  relayAddress: string;
  relayPort: number;
}

/** The options of a stack: its domain, its folder, whether the relay is published on the runner, and its ready wait. */
export interface StackOptions {
  domain: string;
  folder: string;
  published: boolean;
  readyMilliseconds: number;
}

/**
 * Starts the stack of a run: the image, the certificates and the run's files, the network, the identity service and
 * the relay, which it waits for. Both containers run as the runner's own user, so the run's files stay its own.
 */
export async function startStack(
  command: CommandRunner,
  options: StackOptions,
): Promise<Stack> {
  const {domain, folder, published} = options;
  const names = namesOf(folder);
  const user = `${String(process.getuid?.())}:${String(process.getgid?.())}`;
  buildRelayImage(command, path.join(folder, 'relay-image'));
  makeRunCertificates(command, folder, domain);
  writeRunFiles(folder);
  checked(command, 'docker', ['network', 'create', names.network]);
  checked(command, 'docker', identityArgumentsOf(names, folder, user));
  checked(
    command,
    'docker',
    relayArgumentsOf(names, domain, folder, user, published),
  );
  await awaitRelay(command, names.relay, options.readyMilliseconds);
  const relayAddress = checked(command, 'docker', [
    'inspect',
    '--format',
    addressFormatOf(names.network),
    names.relay,
  ]).trim();
  return {
    domain,
    names,
    files: filesOf(folder),
    relayAddress,
    relayPort: RELAY_PORT,
  };
}

/** Removes the stack whose names are `names`: both containers and the network, whichever of them exist. */
export function stopStack(command: CommandRunner, names: StackNames): void {
  checked(command, 'docker', ['rm', '--force', names.relay, names.identity]);
  checked(command, 'docker', ['network', 'rm', '--force', names.network]);
}
