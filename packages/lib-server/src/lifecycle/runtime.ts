/**
 * @fileoverview The server runtime (V7): starts the server on a host, or finds the one that runs, and gives back its
 * port and connection token. The start options are exactly the contract's list; what the settings said is checked here
 * before the host is asked anything.
 */

import type {ChannelFailure, HostChannel} from 'lib-host';
import type {Logger} from 'lib-log';
import type {ExtraStartOption} from '../policy/record.ts';
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
export interface StartNotice {
  kind: 'bindHostRejected';
  /** The bind host as the setting wrote it. */
  configured: string;
}

/** Why no server was started. */
export type StartFailure =
  | {kind: 'invalidPortRange'}
  | {kind: 'serverStart'; detail?: string}
  | {kind: 'prerequisitesMissing'}
  | {kind: 'retriesExhausted'}
  | {kind: 'scriptFailed'; status: ScriptStatus}
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
) => Promise<StepRun | 'retriesExhausted'>;

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

/** Whether a range has its start above its end; any other string is handed to the host as written. */
export function isReversedRange(range: string): boolean {
  const match = /^(\d+)-(\d+)$/.exec(range);
  return match !== null && Number(match[1]) > Number(match[2]);
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
  stepRun: StepRun | 'retriesExhausted',
):
  {block: ResultBlock} | {unfinished: Extract<StartOutcome, {kind: 'failed'}>} {
  if (stepRun === 'retriesExhausted') {
    return {unfinished: failed({kind: 'retriesExhausted'})};
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
  stepRun: StepRun | 'retriesExhausted',
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
          notices,
        }
      : failed({kind: 'unreadableServerFacts'});
  }
  if (block.status === 'ServerFailedToStart') {
    return failed({kind: 'serverStart'});
  }
  if (block.status === 'LinuxPrereqs') {
    return failed({kind: 'prerequisitesMissing'});
  }
  return failed({kind: 'scriptFailed', status: block.status});
}

/**
 * Starts the server of an install, or reuses the one that runs, and reads its port. A reversed range fails before the
 * host is asked anything; a rejected bind host is replaced by the loopback address, with a notice. The extra start
 * option of the policy goes only when the policy allows it.
 */
export async function startOrReuse(
  channel: HostChannel,
  base: ScriptParameters,
  options: RuntimeOptions,
  allowedExtraOptions: readonly ExtraStartOption[],
  dependencies: RuntimeDependencies,
  cancellation: AbortSignal,
): Promise<StartOutcome> {
  if (isReversedRange(options.portRange)) {
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
      fileWatcherPollingMilliseconds: allowedExtraOptions.includes(
        'fileWatcherPolling',
      )
        ? options.fileWatcherPollingMilliseconds
        : 0,
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
