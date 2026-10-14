/**
 * @fileoverview The server runtime (V7): starts the server on a host, or finds the one that runs, and gives back its
 * port and connection token. The start options are exactly the contract's list; what the settings said is checked here
 * before the host is asked anything.
 */

import type {ChannelFailure, HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {ServerPolicyRecord} from '../policy/record.ts';
import type {ScriptParameters} from '../scripts/bootstrap.ts';
import type {ResultBlock, ScriptStatus} from '../scripts/result-block.ts';
import {keptExtensions} from './extensions.ts';
import {runStep, type StepRun} from './run-step.ts';

/** The highest TCP port. */
const MAXIMUM_PORT = 65535;

/** The bind host that replaces a rejected one. */
const FALLBACK_BIND_HOST = '127.0.0.1';

/** What the settings and the caller say about one start. */
export interface RuntimeOptions {
  /** The bind host setting for the host, as written. */
  bindHost: string;
  /** The port range setting for the host, as written; empty for a random free port. */
  portRange: string;
  /** Whether the user has accepted the server's licence terms (never decided here). */
  licenceAccepted: boolean;
  /** Seconds of reconnection grace; 0 passes none, and a Windows host never gets one. */
  graceSeconds: number;
  /** The default extension entries, as written; entries of the wrong shape are dropped. */
  defaultExtensions: readonly string[];
  /** The polling interval of the file watcher in milliseconds, when the caller asks for it; 0 for none. */
  fileWatcherPollingMilliseconds: number;
  /** How many seconds the start waits for the server to report its port. */
  readySeconds: number;
  /** Whether the server listens on a socket in the host's temporary folder instead of a TCP port. */
  socketMode: boolean;
}

/** The server a start gave: where it listens, its process and its secret. */
export interface StartedServer {
  /** Where the server listens: a TCP port on the host's loopback, or a socket in the host's temporary folder. */
  endpoint: {kind: 'port'; port: number} | {kind: 'socket'; path: string};
  processId: number;
  /** The connection token. A secret: it must not reach a log. */
  connectionToken: string;
  /** Whether the server already ran, so that its start options did not apply to it. */
  reused: boolean;
}

/** What the start tells the caller without failing. */
export type StartNotice =
  | {
      kind: 'bindHostRejected';
      /** The bind host as the setting wrote it. */
      configured: string;
    }
  /** The policy runs the server's requirements helper and the installed server has none, so nothing was checked. */
  | {kind: 'requirementsHelperMissing'};

/** Why a launched server did not report a port, when the server says: its range had no free port, or it ended for CVE-2020-1416. */
type ServerStartCause = 'noFreePort' | 'cveTerminated';

/** The cause the host's facts name; any other value of the fact is ignored. */
function causeOf(
  serverFacts: Readonly<Record<string, string>>,
): ServerStartCause | undefined {
  const {failure} = serverFacts;
  return failure === 'noFreePort' || failure === 'cveTerminated'
    ? failure
    : undefined;
}

/** The most lines of the requirements helper's output the facts of a block carry. */
const MAXIMUM_PREREQUISITE_LINES = 20;

/**
 * The output of the server's requirements helper, from the facts `prerequisites.1`, `prerequisites.2`, … in numeric
 * order until the first one missing, joined by newlines; empty when the block carries none. It is the host's own text,
 * and the caller shows it unread (ADR-0010 rules 1 and 4).
 */
export function prerequisiteDetail(
  serverFacts: Readonly<Record<string, string>>,
): string {
  const lines: string[] = [];
  for (
    let position = 1;
    position <= MAXIMUM_PREREQUISITE_LINES;
    position += 1
  ) {
    const line = serverFacts[`prerequisites.${String(position)}`];
    if (line === undefined) {
      break;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** The path a script could not write, and the error text the failing command printed. */
export interface WriteFailure {
  path: string;
  error: string;
  /** Whether the host lock that could not be used was already in the temporary folder; only when the path is the lock file. */
  lockInTemporary?: boolean;
}

/** The write failure the facts of a `CreateInstallDirFailed` block name, when they name a path. */
function writeFailureOf(block: ResultBlock): WriteFailure | undefined {
  const failedPath = block.serverFacts.writeFailedPath;
  if (block.status !== 'CreateInstallDirFailed' || failedPath === undefined) {
    return undefined;
  }
  const failure = {
    path: failedPath,
    error: block.serverFacts.writeFailedError ?? '',
  };
  return block.serverFacts.lockPath === failedPath
    ? {
        ...failure,
        lockInTemporary: block.serverFacts.lockInTemporary === 'yes',
      }
    : failure;
}

/** The failure of a block whose status no step expects, with the write failure its facts name. */
export function scriptFailure(
  block: ResultBlock,
): Extract<StartFailure, {kind: 'scriptFailed'}> {
  const writeFailure = writeFailureOf(block);
  return {
    kind: 'scriptFailed',
    status: block.status,
    ...(writeFailure === undefined ? {} : {writeFailure}),
  };
}

/** The loop gave up: the last attempt's step, and how many attempts were made. */
export interface RetriesExhausted {
  kind: 'retriesExhausted';
  last: StepRun;
  attempts: number;
}

/** The retries-exhausted failure the last attempt's block describes: the lock file it reported, if any. */
export function exhaustedFailure(
  exhausted: RetriesExhausted,
): Extract<StartFailure, {kind: 'retriesExhausted'}> {
  const lockPath =
    exhausted.last.kind === 'result'
      ? exhausted.last.block.serverFacts.lockPath
      : undefined;
  return {
    kind: 'retriesExhausted',
    attempts: exhausted.attempts,
    ...(lockPath === undefined ? {} : {lockPath}),
  };
}

/** Why no server was started. */
export type StartFailure =
  | {kind: 'invalidPortRange'}
  | {kind: 'serverStart'; detail?: string; cause?: ServerStartCause}
  | {kind: 'prerequisitesMissing'; detail: string}
  | {kind: 'retriesExhausted'; attempts: number; lockPath?: string}
  | {
      kind: 'scriptFailed';
      status: ScriptStatus;
      writeFailure?: WriteFailure;
    }
  | {kind: 'unreadableServerFacts'}
  | {kind: 'noResultBlock'}
  | {kind: 'channelFailed'; failure: ChannelFailure};

/** The outcome of a start. */
export type StartOutcome =
  | {kind: 'started'; server: StartedServer; notices: readonly StartNotice[]}
  | {kind: 'failed'; failure: StartFailure};

/**
 * The host lock loop (V5): repeats a step that may answer `LockBusy` until it does not or the attempts are used up.
 * The caller supplies it, so the waits and the retry notices belong to the caller's surroundings.
 */
export type HostLockLoop = (
  step: () => Promise<StepRun>,
  cancellation: AbortSignal,
) => Promise<StepRun | RetriesExhausted>;

/** What the start needs from its surroundings. */
export interface RuntimeDependencies {
  lockLoop: HostLockLoop;
  logger: Logger;
}

/**
 * Whether the extension accepts a bind host: letters, digits, dots and hyphens, or a bracketed address, and never a
 * leading hyphen, because the value follows `--host` and would be read as a flag.
 */
export function isAcceptedBindHost(value: string): boolean {
  return (
    /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(value) ||
    /^\.[A-Za-z0-9.-]*$/.test(value) ||
    /^\[[A-Za-z0-9:]+\]$/.test(value)
  );
}

/**
 * What is wrong with a port range setting, as written: nothing for no entry, an empty one or `start-end` with both ends
 * in 1 to 65535 and the start not above the end; `reversed` when only the order is wrong; `malformed` for any other
 * string and for any value that is not a string.
 */
export function rangeProblem(
  entry: unknown,
): 'reversed' | 'malformed' | undefined {
  if (entry === undefined || entry === '') {
    return undefined;
  }
  const match = typeof entry === 'string' ? /^(\d+)-(\d+)$/.exec(entry) : null;
  if (match === null) {
    return 'malformed';
  }
  const [start, end] = [Number(match[1]), Number(match[2])];
  if (start < 1 || end > MAXIMUM_PORT || end < 1 || start > MAXIMUM_PORT) {
    return 'malformed';
  }
  return start > end ? 'reversed' : undefined;
}

function failed(
  failure: StartFailure,
): Extract<StartOutcome, {kind: 'failed'}> {
  return {kind: 'failed', failure};
}

/** Where a server listens, from the facts of its start: a socket path decides, else a usable port; else nothing. */
function endpointOf(
  serverFacts: Readonly<Record<string, string>>,
): StartedServer['endpoint'] | undefined {
  const {socketPath} = serverFacts;
  if (socketPath !== undefined) {
    return socketPath.startsWith('/')
      ? {kind: 'socket', path: socketPath}
      : undefined;
  }
  const port = Number(serverFacts.port);
  return Number.isInteger(port) && port >= 1 && port <= MAXIMUM_PORT
    ? {kind: 'port', port}
    : undefined;
}

/** The result block of a finished step, or the failed start that a step with none is. */
export function blockOfStart(
  stepRun: StepRun | RetriesExhausted,
):
  {block: ResultBlock} | {unfinished: Extract<StartOutcome, {kind: 'failed'}>} {
  if (stepRun.kind === 'retriesExhausted') {
    return {unfinished: failed(exhaustedFailure(stepRun))};
  }
  if (stepRun.kind === 'channelFailed') {
    return {
      unfinished: failed({kind: 'channelFailed', failure: stepRun.failure}),
    };
  }
  return stepRun.kind === 'noResultBlock'
    ? {unfinished: failed({kind: 'noResultBlock'})}
    : {block: stepRun.block};
}

/** The start outcome of a finished step run. */
function outcomeOf(
  stepRun: StepRun | RetriesExhausted,
  notices: readonly StartNotice[],
): StartOutcome {
  const read = blockOfStart(stepRun);
  if ('unfinished' in read) {
    return read.unfinished;
  }
  const {block} = read;
  if (block.status === 'Ok') {
    const endpoint = endpointOf(block.serverFacts);
    const processId = Number(block.serverFacts.pid);
    const connectionToken = block.serverFacts.token ?? '';
    const usable =
      endpoint !== undefined &&
      Number.isInteger(processId) &&
      processId > 1 &&
      connectionToken !== '';
    return usable
      ? {
          kind: 'started',
          server: {
            endpoint,
            processId,
            connectionToken,
            reused: block.serverFacts.reused === 'yes',
          },
          notices:
            block.serverFacts.prerequisitesHelper === 'missing'
              ? [...notices, {kind: 'requirementsHelperMissing'}]
              : notices,
        }
      : failed({kind: 'unreadableServerFacts'});
  }
  if (block.status === 'ServerFailedToStart') {
    const cause = causeOf(block.serverFacts);
    return failed(
      cause === undefined
        ? {kind: 'serverStart'}
        : {kind: 'serverStart', cause},
    );
  }
  if (block.status === 'LinuxPrereqs') {
    return failed({
      kind: 'prerequisitesMissing',
      detail: prerequisiteDetail(block.serverFacts),
    });
  }
  return failed(scriptFailure(block));
}

/**
 * Starts the server of an install, or reuses the one that runs, and reads its port. A range with a problem fails before the
 * host is asked anything; a rejected bind host is replaced by the loopback address, with a notice. The extra start
 * options of the policy go only when the policy allows them, and the server's own requirements helper runs before a
 * launch only under the `bundledHelper` policy.
 */
export async function startOrReuse(
  channel: HostChannel,
  base: ScriptParameters,
  options: RuntimeOptions,
  startPolicy: Pick<
    ServerPolicyRecord,
    'allowedExtraStartOptions' | 'extensionEntries' | 'requirementsCheck'
  >,
  dependencies: RuntimeDependencies,
  cancellation: AbortSignal,
): Promise<StartOutcome> {
  if (rangeProblem(options.portRange) !== undefined) {
    return failed({kind: 'invalidPortRange'});
  }
  const notices: StartNotice[] = [];
  let bindHost = options.bindHost;
  if (!isAcceptedBindHost(bindHost)) {
    notices.push({kind: 'bindHostRejected', configured: bindHost});
    bindHost = FALLBACK_BIND_HOST;
  }
  const extensions = keptExtensions(
    options.defaultExtensions,
    dependencies.logger,
    startPolicy.extensionEntries,
  );
  const windows = channel.platformHint() === 'windows';
  const parameters: ScriptParameters = {
    ...base,
    start: {
      ...base.start,
      bindHost,
      port: options.portRange === '' ? '0' : options.portRange,
      licenceAccepted: options.licenceAccepted,
      graceSeconds: windows ? 0 : options.graceSeconds,
      extensions,
      fileWatcherPollingMilliseconds:
        startPolicy.allowedExtraStartOptions.includes('fileWatcherPolling')
          ? options.fileWatcherPollingMilliseconds
          : 0,
      useHostProxy:
        startPolicy.allowedExtraStartOptions.includes('useHostProxy'),
      requirementsHelper: startPolicy.requirementsCheck === 'bundledHelper',
      readySeconds: options.readySeconds,
      socketMode: options.socketMode,
    },
  };
  const stepRun = await dependencies.lockLoop(
    () =>
      runStep(
        channel,
        {installMode: 'singleScript', step: 'start'},
        parameters,
        {cancellation},
      ),
    cancellation,
  );
  return outcomeOf(stepRun, notices);
}

/**
 * The TCP port the running server listens on, from what the start recorded; `none` when no server runs or when it
 * listens on a socket, which opens no URL. It never contacts the host.
 */
export function serverPort(
  started: StartedServer | undefined,
): number | 'none' {
  return started?.endpoint.kind === 'port' ? started.endpoint.port : 'none';
}
