/**
 * @fileoverview The further keys of an acceptance run: a key protected by the run's passphrase, a second key, a copy
 * of the second key whose file anyone may read, and a certificate signed by the run's own authority. The passphrase
 * reaches `ssh-keygen` through an askpass script that reads it from a file, so no command line ever holds it.
 */

import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {type CommandRunner, checked, newPassword} from './acceptance-run.ts';
import {type Started, startDetached} from './acceptance-plain.ts';

/** The principal the run's certificate is signed for: the host's certificate-only account. */
export const CERTIFIED_PRINCIPAL = 'harness-cert';

/** The comment of the passphrase key, which ssh shows when it offers to add the key to an agent. */
export const PASSPHRASE_KEY_COMMENT = 'acceptance-passphrase';

/** The keys a run made, by the role each plays, and what the host is given of them. */
export interface RunKeys {
  /** The key protected by the run's passphrase. */
  passphraseKey: string;
  /** The file holding the bare passphrase, mode 600. */
  passphraseFile: string;
  /** The script that prints the passphrase, for `SSH_ASKPASS`. */
  passphraseAskpass: string;
  /** A key protected by the same passphrase that the host does not accept. */
  strangerKey: string;
  /** A second key without a passphrase. */
  secondKey: string;
  /** A copy of the second key with mode 0644, which ssh refuses to use. */
  looseKey: string;
  /** The key the certificate is for; its certificate is `<file>-cert.pub`. */
  certifiedKey: string;
  /** The `docker run` arguments that give the host the further public keys and the authority. */
  hostArguments: string[];
}

/** The public part of a key file, from its `.pub` beside it. */
function publicKeyOf(file: string): string {
  return readFileSync(`${file}.pub`, 'utf8').trim();
}

/** Makes a key protected by the passphrase that `askpass` prints, which never reaches a command line. */
function protectedKey(
  command: CommandRunner,
  askpass: string,
  file: string,
  comment: string,
): void {
  checked(command, 'env', [
    `SSH_ASKPASS=${askpass}`,
    'SSH_ASKPASS_REQUIRE=force',
    'DISPLAY=',
    'ssh-keygen',
    '-q',
    '-t',
    'ed25519',
    '-C',
    comment,
    '-f',
    file,
  ]);
}

/** Makes a key without a passphrase. */
function plainKey(command: CommandRunner, file: string, comment: string): void {
  checked(command, 'ssh-keygen', [
    '-q',
    '-t',
    'ed25519',
    '-N',
    '',
    '-C',
    comment,
    '-f',
    file,
  ]);
}

/**
 * Makes the run's further keys in `runFolder`. The host is to accept the passphrase key and the second key (so also its
 * loose copy) for its key accounts, and the certificate for `harness-cert`.
 */
export function makeRunKeys(
  command: CommandRunner,
  runFolder: string,
): RunKeys {
  const passphraseFile = path.join(runFolder, 'passphrase');
  writeFileSync(passphraseFile, newPassword(), {mode: 0o600});
  const passphraseAskpass = path.join(runFolder, 'askpass-passphrase');
  writeFileSync(passphraseAskpass, `#!/bin/sh\ncat '${passphraseFile}'\n`, {
    mode: 0o700,
  });
  const passphraseKey = path.join(runFolder, 'id_passphrase');
  protectedKey(
    command,
    passphraseAskpass,
    passphraseKey,
    PASSPHRASE_KEY_COMMENT,
  );
  const strangerKey = path.join(runFolder, 'id_passphrase_stranger');
  protectedKey(command, passphraseAskpass, strangerKey, 'acceptance-stranger');
  const secondKey = path.join(runFolder, 'id_second');
  plainKey(command, secondKey, 'acceptance-second');
  const looseKey = path.join(runFolder, 'id_loose');
  copyFileSync(secondKey, looseKey);
  copyFileSync(`${secondKey}.pub`, `${looseKey}.pub`);
  chmodSync(looseKey, 0o644);
  const authority = path.join(runFolder, 'ca');
  plainKey(command, authority, 'acceptance-ca');
  const certifiedKey = path.join(runFolder, 'id_certified');
  plainKey(command, certifiedKey, 'acceptance-certified');
  checked(command, 'ssh-keygen', [
    '-q',
    '-s',
    authority,
    '-I',
    'acceptance',
    '-n',
    CERTIFIED_PRINCIPAL,
    `${certifiedKey}.pub`,
  ]);
  return {
    passphraseKey,
    passphraseFile,
    passphraseAskpass,
    strangerKey,
    secondKey,
    looseKey,
    certifiedKey,
    hostArguments: [
      '--env',
      `AUTHORIZED_KEYS_FURTHER=${[passphraseKey, secondKey].map(publicKeyOf).join('\n')}`,
      '--env',
      `CA_PUBLIC_KEY=${publicKeyOf(authority)}`,
    ],
  };
}

/** The variables an agent must not see: with none of them it has no way to ask, so a confirm-constrained key fails. */
const ASKING_VARIABLES: readonly string[] = [
  'SSH_ASKPASS',
  'SSH_ASKPASS_REQUIRE',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'SSH_AUTH_SOCK',
];

/** `environment` without the variables through which an agent could ask the user. */
export function agentEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) => !ASKING_VARIABLES.includes(name),
    ),
  );
}

/** Starts the run's own ssh-agent in the foreground on `socket`, with no way to ask the user. */
export function startRunAgent(socket: string): Started {
  return startDetached({
    file: 'ssh-agent',
    programArguments: ['-a', socket, '-D'],
    environment: agentEnvironment(process.env),
  });
}

/** The longest socket path the run uses: below the 104 bytes of the smallest `sun_path` among the platforms. */
export const SOCKET_PATH_LIMIT = 100;

/**
 * Where the run's agent listens: `agent.sock` in the run's folder, or, when that path is too long for a Unix socket,
 * in a short folder `shortFolder` makes (by default a new one under `/tmp`).
 */
export function agentSocketPath(
  runFolder: string,
  shortFolder: () => string = () => mkdtempSync('/tmp/agent-'),
): string {
  const inRunFolder = path.join(runFolder, 'agent.sock');
  return Buffer.byteLength(inRunFolder) <= SOCKET_PATH_LIMIT
    ? inRunFolder
    : path.join(shortFolder(), 'agent.sock');
}
