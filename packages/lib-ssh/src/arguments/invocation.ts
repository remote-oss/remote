/**
 * @fileoverview Builds the program and argument list for every `ssh` and `scp` run. Arguments are handed to the
 * process one by one and are never quoted for a shell. The only options added are those listed here; everything
 * else comes from the user's own configuration, which `ssh` reads itself.
 */

import type {EffectiveOptions} from '../config/effective.ts';
import type {ClientPlatform} from '../config/platform.ts';
import {posixQuote} from '../process/remote-program.ts';
import type {SshTarget} from './target.ts';

/** What an `ssh` run is for; a `copy` run uses `scp`. */
export type SshPurpose = 'connection' | 'tunnel' | 'oneShot';

/** The settings a run depends on, read once for the attempt. */
export interface InvocationSettings {
  /** The configuration file setting as written; empty when unset. */
  configFile: string;
  /** The connect timeout setting, in seconds. */
  connectTimeout: number;
  /** The pseudo-terminal setting, judged by truthiness. */
  permitPtyAllocation: unknown;
  /** Whether the host's `RemoteCommand` may run for this connection. */
  remoteCommandInEffect: boolean;
}

/** A forward a run opens on the local side. */
export type Forward =
  | {kind: 'dynamic'; localPort: number}
  | {kind: 'local'; localPort: number; remotePort: number}
  | {kind: 'socket'; localPort: number; socketPath: string};

/** A file copied to the host by a `copy` run. */
export interface CopyRequest {
  localFile: string;
  remotePath: string;
}

/** What every run needs. */
interface RequestBase {
  target: SshTarget;
  settings: InvocationSettings;
  /** The options OpenSSH computes for the target. */
  effective: EffectiveOptions;
  /** The `ssh` and `scp` programs the client check accepted. */
  programs: {sshProgram: string; scpProgram: string};
  /** The editor's home folder, against which a leading `~/` of the configuration file expands. */
  homeFolder: string;
  /** The client platform, which decides the separator of an expanded path. */
  platform: ClientPlatform;
}

/** An `ssh` run. */
export interface SshRequest extends RequestBase {
  purpose: SshPurpose;
  forwards?: Forward[];
  /** The command run on the host: the command of a `oneShot` run, or `sh` for a connection in terminal mode. */
  remoteProgram?: string;
  /** Whether the user's own forwards are dropped on this run: the install run when dynamic forwarding is off. */
  clearUserForwards?: boolean;
}

/** An `scp` run that copies one file to the target. */
export interface CopyRunRequest extends RequestBase {
  purpose: 'copy';
  copy: CopyRequest;
}

/** Everything one run needs. */
export type InvocationRequest = SshRequest | CopyRunRequest;

/** A program with its arguments and the environment variables added to the editor's own. */
export interface Invocation {
  program: string;
  arguments: string[];
  environment: Record<string, string>;
}

/** The loopback address every forward listens on and targets. */
const LOOPBACK = '127.0.0.1';

/** The line the tunnel run prints once its forwards are set up, as the host's own output. */
export const TUNNEL_SUCCESS_LINE =
  'Connected to SSH Host - Please do not close this terminal';

/** What the tunnel run runs on the host: the line that says it is up, then a wait that holds the forward. */
export const TUNNEL_COMMAND = `echo ${posixQuote(TUNNEL_SUCCESS_LINE)}; exec sleep 2147483647`;

/**
 * The invocation for a request whose target has passed `validateTarget`. The host and the user are separate
 * arguments; `-F` carries the expanded configuration file when one is set.
 */
export function buildInvocation(request: InvocationRequest): Invocation {
  const common = configFileArguments({
    configFile: request.settings.configFile,
    homeFolder: request.homeFolder,
    platform: request.platform,
  });
  if (request.purpose === 'copy') {
    return copyInvocation(request, common);
  }
  const argumentList = [...common];
  if (
    request.purpose === 'connection' &&
    !request.settings.permitPtyAllocation
  ) {
    argumentList.push('-T');
  }
  argumentList.push('-v');
  if (request.effective.connectTimeout === undefined) {
    argumentList.push(
      '-o',
      `ConnectTimeout=${String(request.settings.connectTimeout)}`,
    );
  }
  if (
    request.effective.remoteCommand !== undefined &&
    !request.settings.remoteCommandInEffect
  ) {
    argumentList.push('-o', 'RemoteCommand=none');
  }
  if (request.clearUserForwards) {
    if ((request.forwards ?? []).length > 0) {
      throw new Error(
        "clearUserForwards would also clear the run's own forwards",
      );
    }
    if (request.purpose === 'connection') {
      argumentList.push('-o', 'ClearAllForwardings=yes');
    }
  }
  for (const forward of request.forwards ?? []) {
    argumentList.push(...forwardArguments(forward));
  }
  argumentList.push(...targetArguments(request.target));
  if (request.purpose === 'tunnel') {
    argumentList.push(TUNNEL_COMMAND);
  } else if (request.remoteProgram !== undefined) {
    argumentList.push(request.remoteProgram);
  }
  return {
    program: request.programs.sshProgram,
    arguments: argumentList,
    environment: {},
  };
}

/** What a query for the options OpenSSH computes for a target needs. */
export interface OptionsQueryRequest {
  target: SshTarget;
  /** The configuration file setting as written; empty when unset. */
  configFile: string;
  /** The `ssh` program the client check accepted. */
  sshProgram: string;
  /** The editor's home folder, against which a leading `~/` of the configuration file expands. */
  homeFolder: string;
  /** The client platform, which decides the separator of an expanded path. */
  platform: ClientPlatform;
}

/**
 * The target as `ssh` is given it: the user with `-l`, the port with `-p`, then `--` and the host, so a host is never
 * read as an option. The options query passes it the same way, since a configuration's `Match user` or `Match` on the
 * port can change what OpenSSH computes.
 */
function targetArguments(target: SshTarget): string[] {
  const argumentList: string[] = [];
  if (target.user !== undefined && target.user !== '') {
    argumentList.push('-l', target.user);
  }
  if (target.port !== undefined) {
    argumentList.push('-p', String(target.port));
  }
  argumentList.push('--', target.host);
  return argumentList;
}

/** The `ssh -G` run that prints the options OpenSSH computes for the target, read by `parseEffectiveOptions`. */
export function buildOptionsQuery(request: OptionsQueryRequest): Invocation {
  return {
    program: request.sshProgram,
    arguments: [
      ...configFileArguments(request),
      '-G',
      ...targetArguments(request.target),
    ],
    environment: {},
  };
}

/** `-F <file>` with a leading `~/` expanded against the home folder, or nothing when no file is configured. */
function configFileArguments(
  setting: Pick<OptionsQueryRequest, 'configFile' | 'homeFolder' | 'platform'>,
): string[] {
  if (setting.configFile === '') {
    return [];
  }
  return [
    '-F',
    expandHome(setting.configFile, setting.homeFolder, setting.platform),
  ];
}

/**
 * A path with a leading `~/` (or `~\` on Windows), or a lone `~`, with the home folder in place of the `~`, joined
 * with the platform's separator; any other path unchanged.
 */
export function expandHome(
  file: string,
  homeFolder: string,
  platform: ClientPlatform,
): string {
  if (file === '~') {
    return homeFolder;
  }
  const windows = platform === 'windows';
  if (file.startsWith('~/') || (windows && file.startsWith('~\\'))) {
    return `${homeFolder}${windows ? '\\' : '/'}${file.slice(2)}`;
  }
  return file;
}

/** The `-D` or `-L` arguments of one forward. */
function forwardArguments(forward: Forward): string[] {
  const localPort = String(forward.localPort);
  if (forward.kind === 'dynamic') {
    return ['-D', `${LOOPBACK}:${localPort}`];
  }
  if (forward.kind === 'local') {
    return [
      '-L',
      `${LOOPBACK}:${localPort}:${LOOPBACK}:${String(forward.remotePort)}`,
    ];
  }
  return ['-L', `${LOOPBACK}:${localPort}:${forward.socketPath}`];
}

/**
 * The `scp` run: the same configuration file, then the source and the destination on the target, which reaches the
 * host through its configuration entry. An IPv6 address is bracketed so that its colons are not read as the path's.
 */
function copyInvocation(request: CopyRunRequest, common: string[]): Invocation {
  const host = request.target.host.includes(':')
    ? `[${request.target.host}]`
    : request.target.host;
  const argumentList = [
    ...common,
    '--',
    request.copy.localFile,
    `${host}:${request.copy.remotePath}`,
  ];
  return {
    program: request.programs.scpProgram,
    arguments: argumentList,
    environment: {},
  };
}
