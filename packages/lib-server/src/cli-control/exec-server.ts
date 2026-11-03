/**
 * @fileoverview The exec server that an extension gets from `workspace.getRemoteExecServer`, over the command-line
 * program's control connection: each member of the structural type below maps to one control method. A call that does
 * not go through throws an `ExecServerFailure` that carries the control failure. Core asks the resolver for an exec
 * server again on every resolve attempt (`[oss] extHostExtensionService.ts`, `$resolveAuthority` and
 * `getRemoteExecServer`), so the adapter does not reconnect: after the connection is lost every use fails, and the
 * window's reload brings a new connection.
 */

import type {CliControl} from './client.ts';
import type {
  CliConnection,
  CliFileKind,
  CliSpawnParams,
} from './control-methods.ts';
import type {ByteStream, CliControlFailure} from './control-types.ts';

/** The error a member of the exec server throws when its control call does not go through. */
export class ExecServerFailure extends Error {
  readonly failure: CliControlFailure;

  /** Wraps the failure of a control call. */
  constructor(failure: CliControlFailure) {
    super(describeFailure(failure));
    this.name = 'ExecServerFailure';
    this.failure = failure;
  }
}

/** The text of a control failure, for the error that carries it. */
function describeFailure(failure: CliControlFailure): string {
  if (failure.kind === 'closed') {
    return 'the control connection to the command-line program is closed';
  }
  if (failure.kind === 'callFailed') {
    return `${failure.method} failed: ${failure.message}`;
  }
  if (failure.kind === 'malformedReply') {
    return `the reply to ${failure.method} is not what it returns`;
  }
  if (failure.kind === 'challengeRefused') {
    return `the challenge was refused: ${failure.message}`;
  }
  return `serve failed: ${failure.message}`;
}

/** What an event of the exec server hands back to stop listening. */
export interface ExecDisposable {
  dispose(): void;
}

/** A stream the host sends bytes on, mirroring `[oss] vscode.proposed.resolvers.d.ts` `ReadStream`. */
export interface ExecReadStream {
  readonly onDidReceiveMessage: (
    listener: (data: Uint8Array) => void,
  ) => ExecDisposable;
  /** Settles when the host ends the stream. */
  readonly onEnd: Promise<void>;
}

/** A stream the extension sends bytes on, mirroring `[oss] vscode.proposed.resolvers.d.ts` `WriteStream`. */
export interface ExecWriteStream {
  write(data: Uint8Array): void;
  end(): void;
}

/** How a spawned process ended, mirroring `[oss] vscode.proposed.resolvers.d.ts` `ProcessExit`. */
export interface ExecProcessExit {
  readonly status: number;
  readonly message?: string;
}

/** A spawned process, mirroring `[oss] vscode.proposed.resolvers.d.ts` `SpawnedCommand`. */
export interface ExecSpawnedCommand {
  readonly stdin: ExecWriteStream;
  readonly stdout: ExecReadStream;
  readonly stderr: ExecReadStream;
  readonly onExit: Promise<ExecProcessExit>;
}

/** The environment of the host, mirroring `[oss] vscode.proposed.resolvers.d.ts` `ExecEnvironment`. */
export interface ExecEnvironment {
  readonly env: Record<string, string>;
  readonly osPlatform: string;
  readonly osRelease: string;
}

/** The options of a spawn, mirroring `[oss] vscode.proposed.resolvers.d.ts` `ExecServerSpawnOptions`. */
export interface ExecSpawnOptions {
  readonly env?: Record<string, string>;
  readonly cwd?: string;
}

/** A duplex connection and how it ended, mirroring the result of `tcpConnect` and `fs.connect` in the same file. */
export interface ExecConnection {
  readonly stream: ExecReadStream & ExecWriteStream;
  /** Settles when both ends have closed. */
  readonly done: Promise<void>;
}

/** The kinds of `vscode.FileType` that a directory entry or a stat can have. */
export const EXEC_FILE_TYPE = {
  unknown: 0,
  file: 1,
  directory: 2,
  symbolicLink: 64,
} as const;

/** The metadata of a file, mirroring `vscode.FileStat`; the control server reports neither time. */
export interface ExecFileStat {
  readonly type: number;
  readonly ctime: number;
  readonly mtime: number;
  readonly size: number;
}

/** One entry of a directory, mirroring `[oss] vscode.proposed.resolvers.d.ts` `DirectoryEntry`. */
export interface ExecDirectoryEntry {
  readonly type: number;
  readonly name: string;
}

/** The file system of the host, mirroring `[oss] vscode.proposed.resolvers.d.ts` `RemoteFileSystem`. */
export interface ExecFileSystem {
  stat(path: string): Promise<ExecFileStat>;
  mkdirp(path: string): Promise<void>;
  rm(path: string): Promise<void>;
  read(path: string): Promise<ExecReadStream>;
  write(path: string): Promise<{stream: ExecWriteStream; done: Promise<void>}>;
  connect(path: string): Promise<ExecConnection>;
  rename(fromPath: string, toPath: string): Promise<void>;
  readdir(path: string): Promise<ExecDirectoryEntry[]>;
}

/** The members of `[oss] vscode.proposed.resolvers.d.ts` `ExecServer` that the families use. */
export interface ExecServer {
  spawn(
    command: string,
    argumentList: string[],
    options?: ExecSpawnOptions,
  ): Promise<ExecSpawnedCommand>;
  env(): Promise<ExecEnvironment>;
  kill(processId: number): Promise<void>;
  tcpConnect(host: string, port: number): Promise<ExecConnection>;
  readonly fs: ExecFileSystem;
}

/** The `vscode.FileType` of each kind the control server names. */
const FILE_TYPES: Readonly<Record<CliFileKind, number>> = {
  file: EXEC_FILE_TYPE.file,
  // eslint-disable-next-line id-length -- the control server's name for the kind
  dir: EXEC_FILE_TYPE.directory,
  link: EXEC_FILE_TYPE.symbolicLink,
};

/** The `vscode.FileType` of a kind the control server names, unknown when it names none. */
function fileTypeOf(kind: CliFileKind | undefined): number {
  return kind === undefined ? EXEC_FILE_TYPE.unknown : FILE_TYPES[kind];
}

/** The kinds of the failures of a control call. */
const FAILURE_KINDS: readonly string[] = [
  'challengeRefused',
  'serveFailed',
  'closed',
  'callFailed',
  'malformedReply',
] satisfies ReadonlyArray<CliControlFailure['kind']>;

/** Whether `outcome` is the failure of a control call. */
function isFailure(outcome: {kind: string}): outcome is CliControlFailure {
  return FAILURE_KINDS.includes(outcome.kind);
}

/** The outcome of a control call, or its failure thrown. */
function succeeded<Outcome extends {kind: string}>(
  outcome: Outcome | CliControlFailure,
): Outcome {
  if (isFailure(outcome)) {
    throw new ExecServerFailure(outcome);
  }
  return outcome;
}

/** `promise`, marked as handled, so that a rejection nobody asked about does not end the process. */
function handled<Value>(promise: Promise<Value>): Promise<Value> {
  promise.catch(() => undefined);
  return promise;
}

/** The read side of `stream`: its bytes to the listeners, and its end as a promise. */
function readSideOf(stream: ByteStream): ExecReadStream {
  const listeners = new Set<(data: Uint8Array) => void>();
  let started = false;
  return {
    onDidReceiveMessage: listener => {
      listeners.add(listener);
      if (!started) {
        started = true;
        stream.onData(chunk => {
          for (const each of listeners) {
            each(chunk);
          }
        });
      }
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    onEnd: new Promise<void>(resolve => {
      stream.onClose(resolve);
    }),
  };
}

/** The write side of `stream`. */
function writeSideOf(stream: ByteStream): ExecWriteStream {
  return {
    write: data => {
      stream.send(data);
    },
    end: () => {
      stream.close();
    },
  };
}

/** A promise for how a connection's call ended, which rejects with the failure if it did not go through. */
function finishedOf(connection: CliConnection): Promise<void> {
  return handled(
    connection.done.then(outcome => {
      succeeded(outcome);
    }),
  );
}

/** A duplex connection over one stream. */
function duplexOf(connection: CliConnection): ExecConnection {
  return {
    stream: {
      ...readSideOf(connection.stream),
      ...writeSideOf(connection.stream),
    },
    done: finishedOf(connection),
  };
}

/** The exec server over `control`, which has been authenticated. */
export function execServerOf(control: CliControl): ExecServer {
  return {
    spawn: async (command, argumentList, options) => {
      const params: CliSpawnParams = {
        command,
        argumentList,
        ...(options?.cwd === undefined ? {} : {cwd: options.cwd}),
        ...(options?.env === undefined ? {} : {env: options.env}),
      };
      const spawned = succeeded(await control.spawn(params));
      return {
        stdin: writeSideOf(spawned.stdin),
        stdout: readSideOf(spawned.stdout),
        stderr: readSideOf(spawned.stderr),
        onExit: handled(
          spawned.exit.then(outcome => {
            const {exit} = succeeded(outcome);
            return {status: exit.exitCode, message: exit.message};
          }),
        ),
      };
    },
    env: async () => {
      const {environment} = succeeded(await control.getEnv());
      return {
        env: environment.env,
        osPlatform: environment.platform,
        osRelease: environment.release,
      };
    },
    kill: async processId => {
      succeeded(await control.sysKill(processId));
    },
    tcpConnect: async (host, port) =>
      duplexOf(succeeded(await control.netConnect(host, port))),
    // eslint-disable-next-line id-length -- the editor's name for the member
    fs: {
      stat: async path => {
        const {stat} = succeeded(await control.fsStat(path));
        if (!stat.exists) {
          throw new ExecServerFailure({
            kind: 'callFailed',
            method: 'fs_stat',
            message: 'file not found',
          });
        }
        return {
          type: fileTypeOf(stat.type),
          ctime: 0,
          mtime: 0,
          size: stat.size ?? 0,
        };
      },
      mkdirp: async path => {
        succeeded(await control.fsMkdirp(path));
      },
      // eslint-disable-next-line id-length -- the editor's name for the member
      rm: async path => {
        succeeded(await control.fsRm(path));
      },
      read: async path => {
        const connection = succeeded(await control.fsRead(path));
        const reading = readSideOf(connection.stream);
        // A read that fails after it began ends the stream; its reason is the call's, so it rejects `onEnd` as well.
        return {
          onDidReceiveMessage: reading.onDidReceiveMessage,
          onEnd: handled(reading.onEnd.then(() => finishedOf(connection))),
        };
      },
      write: async path => {
        const connection = succeeded(await control.fsWrite(path));
        return {
          stream: writeSideOf(connection.stream),
          done: finishedOf(connection),
        };
      },
      connect: async path => duplexOf(succeeded(await control.fsConnect(path))),
      rename: async (fromPath, toPath) => {
        succeeded(await control.fsRename(fromPath, toPath));
      },
      readdir: async path => {
        const {entries} = succeeded(await control.fsReaddir(path));
        return entries.map(entry => ({
          type: fileTypeOf(entry.type),
          name: entry.name,
        }));
      },
    },
  };
}
