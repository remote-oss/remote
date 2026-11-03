/**
 * @fileoverview The methods of the command-line program's control server that its exec server needs (`spawn`,
 * `sys_kill`, `get_env`, `net_connect` and the `fs_*` family), with the shapes of their parameters and results as
 * `[cli] cli/src/tunnels/control_server.rs` has them. A reply that does not have the method's shape is a failure.
 */

import type {ByteStream, CliControlFailure} from './control-types.ts';
import {isMap, type Reply} from './rpc.ts';

/** What a method that opens streams gives back: the streams at once, and its reply when the CLI has finished. */
export type StreamedCall =
  | {kind: 'started'; streams: ByteStream[]; reply: Promise<Reply | undefined>}
  | {kind: 'replied'; reply: Reply | undefined}
  | {kind: 'malformed'};

/** What the methods send through. */
export interface Caller {
  /** Sends a request and gives its reply, or nothing when the connection ended first. */
  request(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Reply | undefined>;
  /** Sends a request whose reply is preceded by `streamCount` duplex streams. */
  requestStreamed(
    method: string,
    params: Record<string, unknown>,
    streamCount: number,
  ): Promise<StreamedCall>;
}

/** The kind of a file system entry. */
export type CliFileKind = 'dir' | 'file' | 'link';

/** What `fs_stat` found. */
export interface CliFileStat {
  exists: boolean;
  size: number | undefined;
  type: CliFileKind | undefined;
}

/** One entry of `fs_readdir`. */
export interface CliDirectoryEntry {
  name: string;
  type: CliFileKind | undefined;
}

/** What `get_env` reports about the host the program runs on. */
export interface CliEnvironment {
  env: Record<string, string>;
  platform: string;
  release: string;
}

/** The parameters of `spawn`. */
export interface CliSpawnParams {
  command: string;
  argumentList: readonly string[];
  cwd?: string;
  /** Merged onto the program's own environment by the CLI. It goes in the method's own parameter, never in the argument list. */
  env?: Readonly<Record<string, string>>;
}

/** How a spawned process ended. */
export interface CliExit {
  exitCode: number;
  message: string;
}

/** The outcome of a call whose reply is only its success. */
export type CliDone = {kind: 'done'} | CliControlFailure;

/** A duplex stream a method opened, and how its call ended. */
export interface CliConnection {
  kind: 'connected';
  stream: ByteStream;
  /** Settles when the CLI has finished the call, which is after both ends have closed. */
  done: Promise<CliDone>;
}

/** A spawned process: its three streams and its exit. */
export interface CliSpawned {
  kind: 'spawned';
  stdin: ByteStream;
  stdout: ByteStream;
  stderr: ByteStream;
  exit: Promise<{kind: 'exited'; exit: CliExit} | CliControlFailure>;
}

/** The control server's methods that the exec server needs. */
export interface CliMethods {
  spawn(params: CliSpawnParams): Promise<CliSpawned | CliControlFailure>;
  sysKill(
    processId: number,
  ): Promise<{kind: 'killed'; success: boolean} | CliControlFailure>;
  getEnv(): Promise<
    {kind: 'environment'; environment: CliEnvironment} | CliControlFailure
  >;
  netConnect(
    host: string,
    port: number,
  ): Promise<CliConnection | CliControlFailure>;
  fsStat(
    path: string,
  ): Promise<{kind: 'stat'; stat: CliFileStat} | CliControlFailure>;
  /** The file's bytes arrive on the stream, which ends with the file. */
  fsRead(path: string): Promise<CliConnection | CliControlFailure>;
  /** The bytes sent on the stream become the file; closing the stream ends the write. */
  fsWrite(path: string): Promise<CliConnection | CliControlFailure>;
  /** Connects to a Unix socket or named pipe of the host. */
  fsConnect(path: string): Promise<CliConnection | CliControlFailure>;
  fsRm(path: string): Promise<CliDone>;
  fsMkdirp(path: string): Promise<CliDone>;
  fsRename(fromPath: string, toPath: string): Promise<CliDone>;
  fsReaddir(
    path: string,
  ): Promise<
    {kind: 'entries'; entries: CliDirectoryEntry[]} | CliControlFailure
  >;
}

/** The failure of a reply that is an error, or that ended with the connection. */
function failureOf(
  method: string,
  reply: Reply | undefined,
): CliControlFailure {
  return reply === undefined || reply.kind === 'result'
    ? {kind: 'closed'}
    : {kind: 'callFailed', method, message: reply.message};
}

/** The failure of a reply whose result is not what `method` returns. */
function malformed(method: string): CliControlFailure {
  return {kind: 'malformedReply', method};
}

/** The kind of a file system entry as the CLI names it, or nothing for an absent or unknown one. */
function kindOf(value: unknown): CliFileKind | undefined {
  return value === 'dir' || value === 'file' || value === 'link'
    ? value
    : undefined;
}

/** Whether `value` is absent or null, which the CLI sends for an option that is none. */
function isNone(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/** The stat a result carries, or nothing when it is not one. */
function statOf(result: unknown): CliFileStat | undefined {
  if (!isMap(result) || typeof result.exists !== 'boolean') {
    return undefined;
  }
  const {size, type} = result;
  if (!isNone(size) && typeof size !== 'number') {
    return undefined;
  }
  if (!isNone(type) && kindOf(type) === undefined) {
    return undefined;
  }
  return {exists: result.exists, size: size ?? undefined, type: kindOf(type)};
}

/** The entries a result carries, or nothing when it is not a listing. */
function entriesOf(result: unknown): CliDirectoryEntry[] | undefined {
  if (!isMap(result) || !Array.isArray(result.contents)) {
    return undefined;
  }
  const entries: CliDirectoryEntry[] = [];
  for (const item of result.contents as unknown[]) {
    if (!isMap(item) || typeof item.name !== 'string') {
      return undefined;
    }
    if (!isNone(item.type) && kindOf(item.type) === undefined) {
      return undefined;
    }
    entries.push({name: item.name, type: kindOf(item.type)});
  }
  return entries;
}

/** The environment a result carries, or nothing when it is not one. */
function environmentOf(result: unknown): CliEnvironment | undefined {
  if (
    !isMap(result) ||
    !isMap(result.env) ||
    typeof result.os_platform !== 'string' ||
    typeof result.os_release !== 'string'
  ) {
    return undefined;
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.env)) {
    if (typeof value !== 'string') {
      return undefined;
    }
    env[key] = value;
  }
  return {env, platform: result.os_platform, release: result.os_release};
}

/** The exit a result carries, or nothing when it is not one. */
function exitOf(result: unknown): CliExit | undefined {
  return isMap(result) &&
    typeof result.exit_code === 'number' &&
    typeof result.message === 'string'
    ? {exitCode: result.exit_code, message: result.message}
    : undefined;
}

/** The methods over `caller`. */
export function methodsOf(caller: Caller): CliMethods {
  /** A call whose result is an empty map. */
  async function emptyCall(
    method: string,
    params: Record<string, unknown>,
  ): Promise<CliDone> {
    const reply = await caller.request(method, params);
    if (reply?.kind !== 'result') {
      return failureOf(method, reply);
    }
    return isMap(reply.result) ? {kind: 'done'} : malformed(method);
  }

  /** What a streamed call's reply means when its result is an empty map. */
  async function doneOf(
    method: string,
    reply: Promise<Reply | undefined>,
  ): Promise<CliDone> {
    const settled = await reply;
    if (settled?.kind !== 'result') {
      return failureOf(method, settled);
    }
    return isMap(settled.result) ? {kind: 'done'} : malformed(method);
  }

  /** A call that opens one duplex stream. */
  async function connection(
    method: string,
    params: Record<string, unknown>,
  ): Promise<CliConnection | CliControlFailure> {
    const call = await caller.requestStreamed(method, params, 1);
    if (call.kind === 'malformed') {
      return malformed(method);
    }
    if (call.kind === 'replied') {
      return failureOf(method, call.reply);
    }
    const [stream] = call.streams as [ByteStream];
    return {kind: 'connected', stream, done: doneOf(method, call.reply)};
  }

  return {
    spawn: async params => {
      const call = await caller.requestStreamed(
        'spawn',
        {
          command: params.command,
          // eslint-disable-next-line id-denylist -- the CLI's name for the parameter
          args: [...params.argumentList],
          ...(params.cwd === undefined ? {} : {cwd: params.cwd}),
          env: {...params.env},
        },
        3,
      );
      if (call.kind === 'malformed') {
        return malformed('spawn');
      }
      if (call.kind === 'replied') {
        return failureOf('spawn', call.reply);
      }
      const [stdin, stdout, stderr] = call.streams as [
        ByteStream,
        ByteStream,
        ByteStream,
      ];
      return {
        kind: 'spawned',
        stdin,
        stdout,
        stderr,
        exit: call.reply.then(reply => {
          if (reply?.kind !== 'result') {
            return failureOf('spawn', reply);
          }
          const exit = exitOf(reply.result);
          return exit === undefined
            ? malformed('spawn')
            : {kind: 'exited', exit};
        }),
      };
    },
    sysKill: async processId => {
      // eslint-disable-next-line id-length -- the CLI's name for the parameter
      const reply = await caller.request('sys_kill', {pid: processId});
      if (reply?.kind !== 'result') {
        return failureOf('sys_kill', reply);
      }
      return isMap(reply.result) && typeof reply.result.success === 'boolean'
        ? {kind: 'killed', success: reply.result.success}
        : malformed('sys_kill');
    },
    getEnv: async () => {
      const reply = await caller.request('get_env', {});
      if (reply?.kind !== 'result') {
        return failureOf('get_env', reply);
      }
      const environment = environmentOf(reply.result);
      return environment === undefined
        ? malformed('get_env')
        : {kind: 'environment', environment};
    },
    netConnect: (host, port) => connection('net_connect', {host, port}),
    fsStat: async path => {
      const reply = await caller.request('fs_stat', {path});
      if (reply?.kind !== 'result') {
        return failureOf('fs_stat', reply);
      }
      const stat = statOf(reply.result);
      return stat === undefined ? malformed('fs_stat') : {kind: 'stat', stat};
    },
    fsRead: path => connection('fs_read', {path}),
    fsWrite: path => connection('fs_write', {path}),
    fsConnect: path => connection('fs_connect', {path}),
    fsRm: path => emptyCall('fs_rm', {path}),
    fsMkdirp: path => emptyCall('fs_mkdirp', {path}),
    fsRename: (fromPath, toPath) =>
      emptyCall('fs_rename', {from_path: fromPath, to_path: toPath}),
    fsReaddir: async path => {
      const reply = await caller.request('fs_readdir', {path});
      if (reply?.kind !== 'result') {
        return failureOf('fs_readdir', reply);
      }
      const entries = entriesOf(reply.result);
      return entries === undefined
        ? malformed('fs_readdir')
        : {kind: 'entries', entries};
    },
  };
}
