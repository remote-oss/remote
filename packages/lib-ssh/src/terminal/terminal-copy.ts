/**
 * @fileoverview The window's `scp` in a hidden login terminal: the copy of one file to the host runs where the editor's
 * workspace-trust gate applies, its questions are read from the terminal's output and shown to the user, and it ends
 * as the process copy does, with the same kinds of failure. Mirrors the install terminal's connection step.
 */

import type {Scheduler} from 'lib-helper';
import {type CopyOutcome, type CopyRequest, failFrom} from 'lib-host';
import type {Invocation} from '../arguments/invocation.ts';
import {logLinesOf} from '../diagnostics/classify.ts';
import {
  ConnectWait,
  type ConnectWaitSettings,
  connectWaitMilliseconds,
} from '../process/connect-wait.ts';
import {LineSplitter} from '../process/line-splitter.ts';
import type {
  LoginTerminals,
  TerminalEnd,
  TerminalLogin,
} from './login-terminal.ts';
import {followLoginOutput} from './login-output.ts';
import {PromptReader} from './prompt-reader.ts';

/** The exit status `scp` gives when it could not keep its connection. */
const CONNECTION_FAILED_STATUS = 255;

/** How many raw lines are kept to find a failure's cause, and how many of the cause's lines are told. */
const KEPT_LINES = 200;
const TOLD_LINES = 20;

/** Copies one file to the host. */
export type Copier = (request: CopyRequest) => Promise<CopyOutcome>;

/** What a terminal copier is made of. */
export interface TerminalCopierOptions {
  terminals: LoginTerminals;
  scheduler: Scheduler;
  /** The `scp` invocation of a copy. */
  invocationFor(copy: {localFile: string; remotePath: string}): Invocation;
  /** The connect wait's settings for this connect. */
  connectWait(): ConnectWaitSettings;
  /** Shows the copy login's questions and answers them in the terminal. */
  attachQuestions(login: TerminalLogin): {
    onQuestion(text: string): void;
    dispose(): void;
  };
  /** `remote.SSH.showLoginTerminal`, read once per copy; false keeps the terminal hidden. */
  revealLoginTerminals(): boolean;
}

/** How a copy that did not reach its end ended, from what the terminal said. */
function endOutcome(end: TerminalEnd, cause: string): CopyOutcome {
  if (end.code === 0) {
    return {kind: 'copied'};
  }
  if (end.code === CONNECTION_FAILED_STATUS) {
    return failFrom(
      'channelClosed',
      `scp could not keep the connection${cause}`,
    );
  }
  if (end.code !== undefined) {
    return failFrom('copyFailed', `scp failed${cause}`);
  }
  return !end.hadOutput && end.reason !== 'user'
    ? failFrom(
        'cancelled',
        'the terminal did not start: the workspace was not trusted',
      )
    : failFrom('cancelled', 'the copy terminal was closed');
}

/** Makes the copier that runs `scp` in a hidden login terminal. */
export function terminalCopierOf(options: TerminalCopierOptions): Copier {
  return request => {
    const {cancellation} = request;
    if (cancellation.aborted) {
      return Promise.resolve(
        failFrom('cancelled', 'cancelled before the copy'),
      );
    }
    const terminal = options.terminals.open(
      options.invocationFor({
        localFile: request.localFile,
        remotePath: request.remotePath,
      }),
      'Copy VS Code Server',
      options.revealLoginTerminals(),
    );
    return new Promise<CopyOutcome>(resolve => {
      const lines: string[] = [];
      const waitSettings = options.connectWait();
      let finished = false;
      let ended = false;
      const asking: {
        questions?: {onQuestion(text: string): void; dispose(): void};
      } = {};

      function takeDown(): void {
        wait.stop();
        reader.stop();
        asking.questions?.dispose();
        cancellation.removeEventListener('abort', onAbort);
      }

      function settle(outcome: CopyOutcome): void {
        if (finished) {
          return;
        }
        finished = true;
        takeDown();
        if (!ended) {
          terminal.dispose();
        }
        resolve(outcome);
      }

      function onAbort(): void {
        settle(failFrom('cancelled', 'cancelled by the caller'));
      }

      function timedOut(): void {
        settle(failFrom('timeout', 'the copy login did not finish'));
      }

      const wait = new ConnectWait(waitSettings, options.scheduler, timedOut);
      const reader = new PromptReader(
        options.scheduler,
        connectWaitMilliseconds(waitSettings),
        {
          onQuestion: text => {
            asking.questions?.onQuestion(text);
          },
          onUnreachable: timedOut,
        },
      );
      asking.questions = options.attachQuestions({terminal, reader});
      const splitter = new LineSplitter(line => {
        lines.push(line);
        if (lines.length > KEPT_LINES) {
          lines.shift();
        }
      });
      followLoginOutput(terminal, {
        isFinished: () => finished,
        onFirstOutput: () => {
          wait.stop();
        },
        reader,
        lines: splitter,
      });
      terminal.onEnd(end => {
        ended = true;
        splitter.flush();
        const told = logLinesOf(lines).slice(-TOLD_LINES).join('\n');
        settle(endOutcome(end, told === '' ? '' : `: ${told}`));
      });
      cancellation.addEventListener('abort', onAbort);
      wait.start();
    });
  };
}
