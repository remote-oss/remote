/**
 * @fileoverview S10, the host channel over SSH: lib-host's channel implemented with the `ssh` and `scp` clients. A
 * script runs as `sh` on the host through one `ssh` run; a file is copied by one `scp` run. Every failure is a value
 * of lib-host's closed set, with the client's message as detail; nothing is retried here.
 */

import {
  type ChannelFailureKind,
  type CopyOutcome,
  type CopyRequest,
  failFrom,
  type HostChannel,
  type OperationFailed,
  type PlatformHint,
  type ScriptOutcome,
  type ScriptRequest,
} from 'lib-host';
import type {Scheduler} from 'lib-helper';
import {buildInvocation, type SshRequest} from '../arguments/invocation.ts';
import {LineSplitter} from './line-splitter.ts';
import type {LocalFiles} from './node-files.ts';
import type {ProcessSpawner} from './ports.ts';
import {planScript} from './remote-program.ts';
import {type SshSession, spawnSession} from './session.ts';

/** The exit status with which `ssh` and `scp` report that the connection itself failed. */
const CONNECTION_FAILED_STATUS = 255;

/** How much of the client's standard error is kept for a failure's detail, in characters. */
const ERROR_TEXT_LIMIT = 2000;

/** What every run of this channel shares: the target, the settings and the client programs. */
export type RunBase = Omit<
  SshRequest,
  'purpose' | 'forwards' | 'remoteProgram'
>;

/** What the channel needs from its surroundings. */
export interface SshHostChannelOptions {
  /** The host string as the user wrote it: the channel's identity. */
  hostString: string;
  /** The remote side's operating system as far as the connection is known to be. */
  platform: PlatformHint;
  base: RunBase;
  spawner: ProcessSpawner;
  editorEnvironment: Readonly<Record<string, string | undefined>>;
  askpassEnvironment: Readonly<Record<string, string>>;
  files: LocalFiles;
  scheduler: Scheduler;
  /** How long one run may take, in milliseconds; absent when only the caller's cancellation ends it. */
  timeoutMilliseconds?: number;
}

/** How a supervised run ended. */
type Ending =
  | {kind: 'exit'; status: number | undefined}
  | {kind: 'cancelled'}
  | {kind: 'timeout'};

/** The host channel over the `ssh` and `scp` clients. */
export class SshHostChannel implements HostChannel {
  private readonly options: SshHostChannelOptions;

  /** A channel to one host. */
  constructor(options: SshHostChannelOptions) {
    this.options = options;
  }

  /** The host string, as written. */
  identity(): string {
    return this.options.hostString;
  }

  /** The platform the connection is known to be. */
  platformHint(): PlatformHint {
    return this.options.platform;
  }

  /** Runs a script as `sh` on the host and delivers its output lines before the outcome. */
  async runScript(
    request: ScriptRequest,
    onLine: (line: string) => void,
  ): Promise<ScriptOutcome> {
    const {cancellation} = request;
    if (cancellation.aborted) {
      return failFrom('cancelled', 'cancelled before the run');
    }
    const plan = planScript(request);
    if (plan.kind === 'refused') {
      return failFrom('spawnFailed', plan.reason);
    }
    if (
      request.input.kind === 'file' &&
      !(await this.options.files.exists(request.input.localFile))
    ) {
      return failFrom(
        'spawnFailed',
        `no such local file: ${request.input.localFile}`,
      );
    }
    const invocation = buildInvocation({
      ...this.options.base,
      purpose: 'oneShot',
      remoteProgram: plan.remoteProgram,
    });
    const spawned = await spawnSession(
      this.options.spawner,
      invocation,
      this.options.askpassEnvironment,
      this.options.editorEnvironment,
    );
    if (spawned.kind === 'failed') {
      return failFrom('spawnFailed', spawned.detail);
    }
    const {session} = spawned;
    let delivering = true;
    const lines = new LineSplitter(line => {
      if (delivering && !cancellation.aborted) {
        onLine(line);
      }
    });
    session.onOutput(piece => {
      lines.push(piece);
    });
    const errorText = this.collectError(session);
    void this.feed(session, plan.input);
    const ending = await this.supervise(session, cancellation);
    if (ending.kind !== 'exit') {
      delivering = false;
      return this.interrupted(ending);
    }
    lines.flush();
    if (ending.status === undefined) {
      return failFrom('channelClosed', `ssh ended by a signal${errorText()}`);
    }
    return ending.status === CONNECTION_FAILED_STATUS
      ? failFrom(
          'channelClosed',
          `ssh could not keep the connection${errorText()}`,
        )
      : {kind: 'exited', status: ending.status};
  }

  /** Copies a local file to the host with `scp`. */
  async copyToHost(request: CopyRequest): Promise<CopyOutcome> {
    const {cancellation} = request;
    if (cancellation.aborted) {
      return failFrom('cancelled', 'cancelled before the copy');
    }
    const invocation = buildInvocation({
      ...this.options.base,
      purpose: 'copy',
      copy: {localFile: request.localFile, remotePath: request.remotePath},
    });
    const spawned = await spawnSession(
      this.options.spawner,
      invocation,
      this.options.askpassEnvironment,
      this.options.editorEnvironment,
    );
    if (spawned.kind === 'failed') {
      const kind: ChannelFailureKind =
        spawned.failure === 'clientVanished' ? 'copyToolMissing' : 'copyFailed';
      return failFrom(kind, spawned.detail);
    }
    const {session} = spawned;
    const errorText = this.collectError(session);
    session.endInput();
    const ending = await this.supervise(session, cancellation);
    if (ending.kind !== 'exit') {
      return this.interrupted(ending);
    }
    if (ending.status === 0) {
      return {kind: 'copied'};
    }
    return ending.status === CONNECTION_FAILED_STATUS
      ? failFrom(
          'channelClosed',
          `scp could not keep the connection${errorText()}`,
        )
      : failFrom('copyFailed', `scp failed${errorText()}`);
  }

  private interrupted(
    ending: Exclude<Ending, {kind: 'exit'}>,
  ): OperationFailed {
    return ending.kind === 'cancelled'
      ? failFrom('cancelled', 'cancelled by the caller')
      : failFrom(
          'timeout',
          `no end within ${String(this.options.timeoutMilliseconds)} ms`,
        );
  }

  /** Keeps the tail of the client's standard error; the returned function gives it as the end of a message. */
  private collectError(session: SshSession): () => string {
    let kept = '';
    session.onError(piece => {
      kept = (kept + piece).slice(-ERROR_TEXT_LIMIT);
    });
    return () => (kept.trim() === '' ? '' : `: ${kept.trim()}`);
  }

  /** Sends the script, or the input, to the client's standard input and closes it. Errors show in the exit. */
  private async feed(
    session: SshSession,
    input: ScriptRequest['input'],
  ): Promise<void> {
    try {
      if (input.kind === 'text') {
        await session.write(input.text);
      } else {
        for await (const piece of this.options.files.read(input.localFile)) {
          await session.write(piece);
        }
      }
    } catch {
      // A file that cannot be read ends the input early; the client's exit reports what that cost.
    }
    session.endInput();
  }

  /** Waits for the run to end, to be cancelled or to run out of time; the latter two kill the client. */
  private supervise(
    session: SshSession,
    cancellation: AbortSignal,
  ): Promise<Ending> {
    return new Promise(resolve => {
      let cancelTimer: (() => void) | undefined;
      let settled = false;
      function settle(ending: Ending): void {
        if (settled) {
          return;
        }
        settled = true;
        cancelTimer?.();
        cancellation.removeEventListener('abort', onAbort);
        if (ending.kind !== 'exit') {
          session.kill();
        }
        resolve(ending);
      }
      function onAbort(): void {
        settle({kind: 'cancelled'});
      }
      cancellation.addEventListener('abort', onAbort, {once: true});
      if (cancellation.aborted) {
        onAbort();
        return;
      }
      if (this.options.timeoutMilliseconds !== undefined) {
        cancelTimer = this.options.scheduler.setTimer(
          this.options.timeoutMilliseconds,
          () => {
            settle({kind: 'timeout'});
          },
        );
      }
      void session.exit().then(status => {
        settle({kind: 'exit', status});
      });
    });
  }
}
