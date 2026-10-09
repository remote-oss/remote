/**
 * @fileoverview S10 over the shared connection: lib-host's channel whose scripts run on the helper's own `ssh`
 * session, one login for all of them. `copyToHost` is the one exception and runs `scp` as a login of its own through
 * the channel it is given.
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
import type {LocalFiles} from '../process/node-files.ts';
import {scriptText} from '../process/remote-program.ts';
import type {SessionRun, SessionRunEnd} from './client.ts';

/** The session a channel runs its scripts on. */
export interface SessionRunner {
  runOnSession(
    run: SessionRun,
    onLine: (line: string) => void,
    waitMilliseconds: number,
  ): Promise<SessionRunEnd>;
}

/** What the channel needs. */
export interface SharedSessionChannelOptions {
  session: SessionRunner;
  /**
   * The direct channel to the same host: it copies, with a login of its own, and it names the host and its platform
   * for this channel too.
   */
  direct: Pick<HostChannel, 'copyToHost' | 'identity' | 'platformHint'>;
  files: LocalFiles;
  /** How long a script may take once it has started, in milliseconds. */
  runDeadlineMilliseconds: number;
  /** How long a caller waits for a script to end, the wait for earlier scripts included, in milliseconds. */
  runWaitMilliseconds: number;
  /** The most bytes of input a script may be given: the input travels in the session's commands. */
  maximumInputBytes: number;
}

/**
 * The most bytes one script can have: it travels as one argument of `sh -c`, and the system refuses an argument of
 * 128 KiB or more (E2BIG), which the session would not report on the output it carries.
 */
export const EXEC_ARGUMENT_LIMIT_BYTES = 128 * 1024;

/** The failure kind of a script that did not end on the session. */
function failureKind(reason: string): ChannelFailureKind {
  return reason === 'timeout' ? 'timeout' : 'channelClosed';
}

/** The host channel over the shared `ssh` session. */
export class SharedSessionChannel implements HostChannel {
  private readonly options: SharedSessionChannelOptions;

  /** A channel over a session. */
  constructor(options: SharedSessionChannelOptions) {
    this.options = options;
  }

  /** The host string, as written. */
  identity(): string {
    return this.options.direct.identity();
  }

  /** The platform the connection is known to be. */
  platformHint(): PlatformHint {
    return this.options.direct.platformHint();
  }

  /** Copies a file with a login of its own. */
  copyToHost(request: CopyRequest): Promise<CopyOutcome> {
    return this.options.direct.copyToHost(request);
  }

  /** Runs a script on the session. Cancelling ends the wait; a script already started finishes on the host. */
  async runScript(
    request: ScriptRequest,
    onLine: (line: string) => void,
  ): Promise<ScriptOutcome> {
    const script = scriptText(request);
    if (script.kind === 'refused') {
      return failFrom('spawnFailed', script.reason);
    }
    if (request.cancellation.aborted) {
      return failFrom('cancelled', 'cancelled before the run');
    }
    const scriptBytes = Buffer.byteLength(script.text, 'utf8');
    if (scriptBytes >= EXEC_ARGUMENT_LIMIT_BYTES) {
      return failFrom(
        'spawnFailed',
        `the script is ${String(scriptBytes)} bytes, and the shared session runs a script of fewer than ${String(EXEC_ARGUMENT_LIMIT_BYTES)}`,
      );
    }
    const input = await this.inputOf(request.input);
    if ('failed' in input) {
      return input.failed;
    }
    let delivering = true;
    const ending = await this.untilCancelled(
      this.options.session.runOnSession(
        {
          script: script.text,
          inputBase64: input.base64,
          deadlineMilliseconds: this.options.runDeadlineMilliseconds,
        },
        line => {
          if (delivering) {
            onLine(line);
          }
        },
        this.options.runWaitMilliseconds,
      ),
      request.cancellation,
    );
    delivering = false;
    if (ending === 'cancelled') {
      return failFrom('cancelled', 'cancelled by the caller');
    }
    return ending.kind === 'ended'
      ? {kind: 'exited', status: ending.status}
      : failFrom(failureKind(ending.reason), ending.detail);
  }

  /** The input as base64 (null for none), or the failure that stops the run before it starts. */
  private async inputOf(
    input: ScriptRequest['input'],
  ): Promise<{base64: string | null} | {failed: OperationFailed}> {
    if (input.kind === 'text') {
      return {
        base64:
          input.text === ''
            ? null
            : Buffer.from(input.text, 'utf8').toString('base64'),
      };
    }
    if (!(await this.options.files.exists(input.localFile))) {
      return {
        failed: failFrom(
          'spawnFailed',
          `no such local file: ${input.localFile}`,
        ),
      };
    }
    const pieces: Uint8Array[] = [];
    let size = 0;
    for await (const piece of this.options.files.read(input.localFile)) {
      size += piece.length;
      if (size > this.options.maximumInputBytes) {
        return {
          failed: failFrom(
            'spawnFailed',
            `${input.localFile} is larger than the ${String(this.options.maximumInputBytes)} bytes a script can be given over the shared session; copy it with scp instead`,
          ),
        };
      }
      pieces.push(piece);
    }
    return {base64: Buffer.concat(pieces).toString('base64')};
  }

  /** The end of the run, or `cancelled` as soon as the caller cancels. */
  private untilCancelled(
    pending: Promise<SessionRunEnd>,
    cancellation: AbortSignal,
  ): Promise<SessionRunEnd | 'cancelled'> {
    return new Promise(resolve => {
      function onAbort(): void {
        resolve('cancelled');
      }
      cancellation.addEventListener('abort', onAbort, {once: true});
      void pending.then(end => {
        cancellation.removeEventListener('abort', onAbort);
        resolve(end);
      });
    });
  }
}
