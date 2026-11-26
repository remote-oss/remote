/**
 * @fileoverview The agent as a service: a systemd user unit written under the user's own configuration folder and
 * started with `systemctl --user`. It needs no root and never runs `sudo`, and it offers no way to keep the machine
 * awake. Every program it starts goes through one runner, with an argument list.
 */

import {randomBytes} from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {TUNNEL_AGENT_NAME} from 'lib-identifiers';
import type {Output} from './output.ts';

/** How a program the runner started ended. */
export type ProgramOutcome =
  | {kind: 'exited'; status: number; stdout: string; stderr: string}
  | {kind: 'failedToStart'; message: string};

/** Starts `program` with `programArguments`, never through a shell, and waits for it to end. */
type ProgramRunner = (
  program: string,
  programArguments: readonly string[],
) => Promise<ProgramOutcome>;

/** What a service command needs of its surroundings. */
export interface ServicePorts {
  runner: ProgramRunner;
  output: Output;
  /** The user's home folder. */
  home: string;
  /** The user's `XDG_CONFIG_HOME`, when the environment sets it to a folder. */
  configHome?: string;
  /** The user's login name. */
  user: string;
  /** The absolute path of the launcher the unit starts. */
  launcher: string;
}

/** The mode of the unit file: readable by every user, written by its own. */
const UNIT_FILE_MODE = 0o644;

/** The unit's file name, made from the agent's name. */
export const UNIT_NAME = `${TUNNEL_AGENT_NAME}.service`;

/** The folder the user's own systemd units live in. */
export function unitFolderOf(
  ports: Pick<ServicePorts, 'home' | 'configHome'>,
): string {
  const configHome =
    ports.configHome === undefined || ports.configHome === ''
      ? path.join(ports.home, '.config')
      : ports.configHome;
  return path.join(configHome, 'systemd', 'user');
}

/** `value` as one word of an `ExecStart` line in double quotes, with the characters systemd reads in it written twice. */
function quotedWord(value: string): string {
  return `"${value.replace(/[\\"%$]/gu, character =>
    character === '"' || character === '\\'
      ? `\\${character}`
      : character + character,
  )}"`;
}

/**
 * The text of the unit that starts `launcher`. A user's systemd manager has no `network-online.target`, so the unit
 * names none, and `Restart=always` carries the retry; the launcher takes no argument, so the unit holds no secret.
 */
export function unitTextOf(launcher: string): string {
  return [
    '[Unit]',
    'Description=Remote tunnel host agent',
    'StartLimitIntervalSec=0',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${quotedWord(launcher)}`,
    'Restart=always',
    'RestartSec=10',
    'UMask=0077',
    'NoNewPrivileges=true',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/** The line printed when the user's services stop with their last session. */
const LINGER_LINE =
  'The service runs only while you are logged in. Run "loginctl enable-linger" to keep it running after you log out.';

/** The text of `file`, or undefined when there is none. */
function textOf(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (caught) {
    if ((caught as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw caught;
  }
}

/** Writes `text` as `file`, whole, through a temporary file renamed over it. */
function writeUnitFile(file: string, text: string): void {
  mkdirSync(path.dirname(file), {recursive: true});
  const temporary = `${file}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(temporary, text, {mode: UNIT_FILE_MODE});
  chmodSync(temporary, UNIT_FILE_MODE);
  renameSync(temporary, file);
}

/** What a `systemctl --user` step of the command said when it went wrong, in the user's words. */
function failureOf(outcome: ProgramOutcome): string | undefined {
  if (outcome.kind === 'failedToStart') {
    return `could not start the program: ${outcome.message}`;
  }
  return outcome.status === 0
    ? undefined
    : outcome.stderr.trim() ||
        outcome.stdout.trim() ||
        `it ended with status ${String(outcome.status)}`;
}

/** Runs `systemctl --user` with `words`, and gives what went wrong, or undefined. */
async function systemctl(
  ports: ServicePorts,
  words: readonly string[],
): Promise<string | undefined> {
  const failure = failureOf(
    await ports.runner('systemctl', ['--user', ...words]),
  );
  return failure === undefined
    ? undefined
    : `systemctl --user ${words.join(' ')}: ${failure}`;
}

/** Installs the service and starts it; the exit status of the command. */
export async function installService(ports: ServicePorts): Promise<number> {
  const file = path.join(unitFolderOf(ports), UNIT_NAME);
  const before = textOf(file);
  writeUnitFile(file, unitTextOf(ports.launcher));
  const failure =
    (await systemctl(ports, ['daemon-reload'])) ??
    (await systemctl(ports, ['enable', '--now', UNIT_NAME]));
  if (failure !== undefined) {
    if (before === undefined) {
      rmSync(file, {force: true});
    } else {
      writeUnitFile(file, before);
    }
    ports.output.stderr(`tunnel-agent service install: ${failure}\n`);
    return 1;
  }
  ports.output.stdout(`Installed and started ${UNIT_NAME}.\n`);
  const linger = await ports.runner('loginctl', [
    'show-user',
    ports.user,
    '-p',
    'Linger',
  ]);
  if (linger.kind === 'exited' && linger.stdout.trim() === 'Linger=no') {
    ports.output.stdout(`${LINGER_LINE}\n`);
  }
  return 0;
}

/** Stops the service and removes its unit; the exit status of the command. */
export async function uninstallService(ports: ServicePorts): Promise<number> {
  const file = path.join(unitFolderOf(ports), UNIT_NAME);
  if (textOf(file) === undefined) {
    ports.output.stdout(`${UNIT_NAME} is not installed.\n`);
    return 0;
  }
  let failure = await systemctl(ports, ['disable', '--now', UNIT_NAME]);
  if (failure === undefined) {
    rmSync(file, {force: true});
    failure = await systemctl(ports, ['daemon-reload']);
  }
  if (failure !== undefined) {
    ports.output.stderr(`tunnel-agent service uninstall: ${failure}\n`);
    return 1;
  }
  ports.output.stdout(`Stopped and removed ${UNIT_NAME}.\n`);
  return 0;
}
