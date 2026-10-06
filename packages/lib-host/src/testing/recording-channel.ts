/**
 * @fileoverview A host channel for tests: it replays scripted answers and records every call. No bundle imports
 * this module.
 */

import {
  failFrom,
  type ChannelFailure,
  type CopyOutcome,
  type CopyRequest,
  type HostChannel,
  type Interpreter,
  type OperationFailed,
  type PlatformHint,
  type ScriptInput,
  type ScriptOutcome,
  type ScriptRequest,
} from '../host-channel.ts';

/** An answer that ends in a failure of any kind. */
export interface FailingEnding {
  kind: 'fail';
  failure: ChannelFailure;
}

/** An answer that holds the call open until the caller cancels it, then ends it as cancelled. */
interface HeldEnding {
  kind: 'holdUntilCancelled';
}

/** How a scripted run ends. */
export type ScriptEnding =
  {kind: 'exit'; status: number} | FailingEnding | HeldEnding;

/** A scripted answer to one `runScript` call. */
export interface ScriptAnswer {
  interpreter: Interpreter;
  /** Whether this answer is for the given script text. */
  matches: (script: string) => boolean;
  /** The output lines in order, given as such or computed from the bytes the script read on its input. */
  lines: readonly string[] | ((input: Uint8Array) => readonly string[]);
  ending: ScriptEnding;
}

/** A scripted answer to one `copyToHost` call. */
export interface CopyAnswer {
  /** Whether this answer is for the given remote path. */
  matches: (remotePath: string) => boolean;
  ending: {kind: 'copied'} | FailingEnding | HeldEnding;
}

/** One call the channel received, in the order received. */
export type RecordedCall =
  | {operation: 'runScript'; request: ScriptRequest}
  | {operation: 'copyToHost'; request: CopyRequest};

/** What a recording channel answers. */
export interface RecordingSetup {
  identity: string;
  platformHint: PlatformHint;
  scripts?: readonly ScriptAnswer[];
  copies?: readonly CopyAnswer[];
  /** The client files a script can read as streamed input, by path. */
  localFiles?: ReadonlyMap<string, Uint8Array>;
  /** The host path of each client file the host reads directly; any other file has none. */
  hostPaths?: ReadonlyMap<string, string>;
}

function cancelledBy(signal: AbortSignal): OperationFailed {
  return failFrom('cancelled', signal.reason);
}

function untilCancelled(signal: AbortSignal): Promise<OperationFailed> {
  if (signal.aborted) {
    return Promise.resolve(cancelledBy(signal));
  }
  return new Promise(resolve => {
    signal.addEventListener(
      'abort',
      () => {
        resolve(cancelledBy(signal));
      },
      {once: true},
    );
  });
}

/** Removes and returns the first answer that fits; a call nothing fits is a mistake in the test's setup. */
function takeAnswer<T>(
  answers: T[],
  fits: (answer: T) => boolean,
  call: string,
): T {
  const position = answers.findIndex(fits);
  const answer = answers[position];
  if (answer === undefined) {
    throw new Error(`no scripted answer left for ${call}`);
  }
  answers.splice(position, 1);
  return answer;
}

/**
 * A channel that answers each call with the first unused answer that fits it. Each answer is used once; a call
 * cancelled before it starts, or whose input file does not exist, uses none.
 */
export class RecordingChannel implements HostChannel {
  /** Every call received, in order, cancelled and failed ones included. */
  readonly calls: RecordedCall[] = [];
  private readonly scriptAnswers: ScriptAnswer[];
  private readonly copyAnswers: CopyAnswer[];
  private readonly localFiles: ReadonlyMap<string, Uint8Array>;
  private readonly hostPaths: ReadonlyMap<string, string>;
  private readonly hostIdentity: string;
  private readonly hint: PlatformHint;

  /** A channel that gives the answers of `setup`, none of them used yet. */
  constructor(setup: RecordingSetup) {
    this.scriptAnswers = [...(setup.scripts ?? [])];
    this.copyAnswers = [...(setup.copies ?? [])];
    this.localFiles = setup.localFiles ?? new Map();
    this.hostPaths = setup.hostPaths ?? new Map();
    this.hostIdentity = setup.identity;
    this.hint = setup.platformHint;
  }

  /** Records the call, delivers the first fitting answer's lines and ends as that answer says. */
  async runScript(
    request: ScriptRequest,
    onLine: (line: string) => void,
  ): Promise<ScriptOutcome> {
    this.calls.push({operation: 'runScript', request});
    if (request.cancellation.aborted) {
      return cancelledBy(request.cancellation);
    }
    const input = this.inputBytes(request.input);
    if (!(input instanceof Uint8Array)) {
      return input;
    }
    const answer = takeAnswer(
      this.scriptAnswers,
      candidate =>
        candidate.interpreter === request.interpreter &&
        candidate.matches(request.script),
      `a ${request.interpreter} script: ${request.script}`,
    );
    const lines =
      typeof answer.lines === 'function' ? answer.lines(input) : answer.lines;
    for (const line of lines) {
      onLine(line);
    }
    const {ending} = answer;
    switch (ending.kind) {
      case 'exit':
        return {kind: 'exited', status: ending.status};
      case 'fail':
        return {kind: 'failed', failure: ending.failure};
      default:
        return untilCancelled(request.cancellation);
    }
  }

  /** Records the call and ends as the first fitting answer says. */
  async copyToHost(request: CopyRequest): Promise<CopyOutcome> {
    this.calls.push({operation: 'copyToHost', request});
    if (request.cancellation.aborted) {
      return cancelledBy(request.cancellation);
    }
    const {ending} = takeAnswer(
      this.copyAnswers,
      candidate => candidate.matches(request.remotePath),
      `a copy to ${request.remotePath}`,
    );
    switch (ending.kind) {
      case 'copied':
        return {kind: 'copied'};
      case 'fail':
        return {kind: 'failed', failure: ending.failure};
      default:
        return untilCancelled(request.cancellation);
    }
  }

  /** The identity of the setup. */
  identity(): string {
    return this.hostIdentity;
  }

  /** The platform hint of the setup. */
  platformHint(): PlatformHint {
    return this.hint;
  }

  /** The host path the setup gives for `localFile`, if any. */
  clientPathOnHost(localFile: string): Promise<string | undefined> {
    return Promise.resolve(this.hostPaths.get(localFile));
  }

  /** The bytes a script reads: the text's UTF-8, or the setup's file; a file the setup lacks fails the run. */
  private inputBytes(input: ScriptInput): Uint8Array | OperationFailed {
    if (input.kind === 'text') {
      return new TextEncoder().encode(input.text);
    }
    return (
      this.localFiles.get(input.localFile) ??
      failFrom('spawnFailed', `no such local file: ${input.localFile}`)
    );
  }
}
