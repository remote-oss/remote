/**
 * @fileoverview The further keys of an acceptance run: a key protected by the run's passphrase, a second key, a copy
 * of the second key whose file anyone may read, a certificate signed by the run's own authority, a key whose line on
 * the host refuses port forwarding, and a known-hosts file that pins a key the host doesn't have. The passphrase reaches `ssh-keygen` through an askpass script that reads it
 * from a file, so no command line ever holds it.
 */

import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {type CommandRunner, checked, runCommand} from './command-runner.ts';
import {newPassword} from './acceptance-run.ts';
import {type Started, startDetached} from './acceptance-plain.ts';

/** The principal the run's certificate is signed for: the host's certificate-only account. */
export const CERTIFIED_PRINCIPAL = 'harness-cert';

/** The alias whose host key has changed: its own known-hosts file pins another key under this name (`HostKeyAlias`). */
export const CHANGED_KEY_ALIAS = 'changedkey';

/** The known-hosts file of the changed-key alias in `runFolder`. */
export function changedKeyHostsFile(runFolder: string): string {
  return path.join(runFolder, `known_hosts_${CHANGED_KEY_ALIAS}`);
}

/** How many aliases of the passphrase key a run has besides `passkey`, named `passkey-1` and on: one for each row that needs a connection of its own. */
const PASSKEY_COPIES = 24;

/** The aliases that vary the passphrase key's configuration: the values of AddKeysToAgent, and the ways of having no usable key. */
export const PASSKEY_VARIANTS = [
  'passkey-add-yes',
  'passkey-ask-yes',
  'passkey-ask-no',
  'passkey-ask-escape',
  'passkey-add-confirm',
  'nokey-missing',
  'nokey-none',
  'nokey-nopubkey',
  'nokey-agent-only',
  'nokey-agent-none',
  'agent-other-file',
  'several-files',
  'certonly',
  'certonly-nocert',
  'certpass',
  'agent-var-set',
  'agent-var-unset',
] as const;

/** The names of the copies of the passphrase key's alias: `passkey-1` to the last. */
export function passkeyCopies(): string[] {
  return [...Array(PASSKEY_COPIES).keys()].map(
    index => `passkey-${String(index + 1)}`,
  );
}

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
  /** A key without a passphrase that the host does not accept. */
  unauthorisedKey: string;
  /** A second key without a passphrase. */
  secondKey: string;
  /** A copy of the second key with mode 0644, which ssh refuses to use. */
  looseKey: string;
  /** The key the certificate is for; its certificate is `<file>-cert.pub`. */
  certifiedKey: string;
  /** A key without a passphrase that the host accepts with `no-port-forwarding` on its line. */
  noForwardingKey: string;
  /** A key protected by the run's passphrase, with a certificate for the same principal at `<file>-cert.pub`. */
  certifiedPassphraseKey: string;
  /** The `docker run` arguments that give the host the further public keys and the authority. */
  hostArguments: string[];
}

/** The public part of a key file, from its `.pub` beside it. */
function publicKeyOf(file: string): string {
  return readFileSync(`${file}.pub`, 'utf8').trim();
}

/**
 * Fails unless the key `file` needs a passphrase: when it opens with an empty one, `ssh-keygen` did not use the run's
 * askpass and wrote the key unprotected.
 */
export function checkProtected(command: CommandRunner, file: string): void {
  if (command('ssh-keygen', ['-y', '-P', '', '-f', file]).status === 0) {
    throw new Error(
      `ssh-keygen wrote ${file} without the run's passphrase: it did not use the askpass`,
    );
  }
}

/**
 * Writes the script that prints the passphrase in `passphraseFile`, for `SSH_ASKPASS`, and gives its file: a shell
 * script, or on Windows (`platform`) a batch file, which OpenSSH for Windows starts.
 */
export function writeAskpass(
  runFolder: string,
  passphraseFile: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    const batch = path.join(runFolder, 'askpass-passphrase.cmd');
    writeFileSync(batch, `@type "${passphraseFile}"\r\n`);
    return batch;
  }
  const script = path.join(runFolder, 'askpass-passphrase');
  writeFileSync(script, `#!/bin/sh\ncat '${passphraseFile}'\n`, {mode: 0o700});
  return script;
}

/**
 * Makes a key protected by the passphrase that `askpass` prints, which never reaches a command line, and checks that
 * the key needs it.
 */
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
  checkProtected(command, file);
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
 * Lets anyone read the key file `file`, so that ssh refuses to use it: mode 0644, or on Windows (`platform`), whose
 * OpenSSH reads the file's access list instead of a mode, read access for Everyone (by its SID, which no language of
 * the system renames).
 */
export function loosenKey(
  command: CommandRunner,
  file: string,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === 'win32') {
    checked(command, 'icacls', [file, '/grant', '*S-1-1-0:R']);
  } else {
    chmodSync(file, 0o644);
  }
}

/**
 * Makes the run's further keys in `runFolder`. The host is to accept the passphrase key and the second key (so also its
 * loose copy) for its key accounts, the no-forwarding key for them with `no-port-forwarding`, and the certificate for
 * `harness-cert`.
 */
export function makeRunKeys(
  command: CommandRunner,
  runFolder: string,
): RunKeys {
  const passphraseFile = path.join(runFolder, 'passphrase');
  writeFileSync(passphraseFile, newPassword(), {mode: 0o600});
  const passphraseAskpass = writeAskpass(runFolder, passphraseFile);
  const passphraseKey = path.join(runFolder, 'id_passphrase');
  protectedKey(
    command,
    passphraseAskpass,
    passphraseKey,
    PASSPHRASE_KEY_COMMENT,
  );
  const strangerKey = path.join(runFolder, 'id_passphrase_stranger');
  protectedKey(command, passphraseAskpass, strangerKey, 'acceptance-stranger');
  const unauthorisedKey = path.join(runFolder, 'id_unauthorised');
  plainKey(command, unauthorisedKey, 'acceptance-unauthorised');
  const secondKey = path.join(runFolder, 'id_second');
  plainKey(command, secondKey, 'acceptance-second');
  const looseKey = path.join(runFolder, 'id_loose');
  copyFileSync(secondKey, looseKey);
  copyFileSync(`${secondKey}.pub`, `${looseKey}.pub`);
  loosenKey(command, looseKey);
  const authority = path.join(runFolder, 'ca');
  plainKey(command, authority, 'acceptance-ca');
  const certifiedKey = path.join(runFolder, 'id_certified');
  plainKey(command, certifiedKey, 'acceptance-certified');
  const noForwardingKey = path.join(runFolder, 'id_noportfwd');
  plainKey(command, noForwardingKey, 'acceptance-no-port-forwarding');
  // A key the host never has, pinned as the changed-key alias's host key, so ssh finds the host's own key changed.
  const pinnedKey = path.join(runFolder, 'changed_host_key');
  plainKey(command, pinnedKey, 'acceptance-changed-host');
  writeFileSync(
    changedKeyHostsFile(runFolder),
    `${CHANGED_KEY_ALIAS} ${publicKeyOf(pinnedKey)}\n`,
  );
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
  const certifiedPassphraseKey = path.join(runFolder, 'id_certpass');
  protectedKey(
    command,
    passphraseAskpass,
    certifiedPassphraseKey,
    'acceptance-certpass',
  );
  checked(command, 'ssh-keygen', [
    '-q',
    '-s',
    authority,
    '-I',
    'acceptance-passphrase',
    '-n',
    CERTIFIED_PRINCIPAL,
    `${certifiedPassphraseKey}.pub`,
  ]);
  return {
    passphraseKey,
    passphraseFile,
    passphraseAskpass,
    strangerKey,
    unauthorisedKey,
    secondKey,
    looseKey,
    certifiedKey,
    noForwardingKey,
    certifiedPassphraseKey,
    hostArguments: [
      '--env',
      `AUTHORIZED_KEYS_FURTHER=${[
        ...[passphraseKey, secondKey].map(publicKeyOf),
        `no-port-forwarding ${publicKeyOf(noForwardingKey)}`,
      ].join('\n')}`,
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

/**
 * Starts the run's own ssh-agent in the foreground on `socket`, with no way to ask the user. On Windows (`platform`)
 * the agent is the system's service, which the job starts and which keeps its keys between runs: the run empties it
 * with `ssh-add -D` at its start and at its end.
 */
export function startRunAgent(
  socket: string,
  platform: NodeJS.Platform = process.platform,
  command: CommandRunner = runCommand,
): Started {
  if (platform === 'win32') {
    checked(command, 'ssh-add', ['-D']);
    return {
      stop: () => {
        checked(command, 'ssh-add', ['-D']);
        return Promise.resolve();
      },
    };
  }
  return startDetached({
    file: 'ssh-agent',
    programArguments: ['-a', socket, '-D'],
    environment: agentEnvironment(process.env),
  });
}

/** The longest socket path the run uses: below the 104 bytes of the smallest `sun_path` among the platforms. */
export const SOCKET_PATH_LIMIT = 100;

/** The longest name an alias's control socket has: `cm-autoask-` and the 40 characters of `%C`, and the 17 that `ssh` adds while it binds. */
const LONGEST_CONTROL_SOCKET = 'cm-autoask-'.length + 40 + 17;

/**
 * The folder of the ControlMaster sockets of the run's aliases: the run's folder, or, when the longest socket name in
 * it would pass the limit of a Unix socket path, a short folder `shortFolder` makes (by default a new one under
 * `/tmp`). A runner's temporary folder and run id make a run folder too deep for it. On Windows (`platform`), which
 * has no ControlMaster alias, it is the run's folder.
 */
export function controlFolderOf(
  runFolder: string,
  shortFolder: () => string = () => mkdtempSync('/tmp/control-'),
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ||
    Buffer.byteLength(runFolder) + 1 + LONGEST_CONTROL_SOCKET <=
      SOCKET_PATH_LIMIT
    ? runFolder
    : shortFolder();
}

/** The named pipe of OpenSSH for Windows' agent, a service of the system rather than a program of the run. */
export const WINDOWS_AGENT_PIPE = '\\\\.\\pipe\\openssh-ssh-agent';

/**
 * Where the run's agent listens: `agent.sock` in the run's folder, or, when that path is too long for a Unix socket,
 * in a short folder `shortFolder` makes (by default a new one under `/tmp`). On Windows (`platform`) it is the agent
 * service's pipe.
 */
export function agentSocketPath(
  runFolder: string,
  shortFolder: () => string = () => mkdtempSync('/tmp/agent-'),
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform === 'win32') {
    return WINDOWS_AGENT_PIPE;
  }
  const inRunFolder = path.join(runFolder, 'agent.sock');
  return Buffer.byteLength(inRunFolder) <= SOCKET_PATH_LIMIT
    ? inRunFolder
    : path.join(shortFolder(), 'agent.sock');
}

/**
 * A path as the run's ssh_config writes it: as it is, or on Windows (`platform`) with forward slashes (`C:/…`), which
 * OpenSSH for Windows reads and its parser does not take for escapes.
 */
export function sshConfigPath(
  file: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? file.replaceAll('\\', '/') : file;
}
