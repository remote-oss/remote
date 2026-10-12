/**
 * @fileoverview Scripts run on a login terminal's `sh`, one at a time, as the helper runs them on its own session in
 * shared mode: the same runs, framed by the same markers, with the terminal's input and output in place of the
 * process's.
 */

import type {Scheduler} from 'lib-helper';
import type {SessionRun, SessionRunEnd} from '../connection-server/client.ts';
import type {SessionRunner} from '../connection-server/shared-channel.ts';
import {ShellRuns} from '../connection-server/shell-runs.ts';
import {LineSplitter} from '../process/line-splitter.ts';
import type {LoginTerminalSession} from './login-terminal.ts';

/** What a terminal runner is made of. */
export interface TerminalRunnerOptions {
  /** The install terminal, whose `sh` reads the commands; its output carries the runs' lines. */
  terminal: LoginTerminalSession;
  scheduler: Scheduler;
  /** A marker no script can guess and no earlier run used. */
  newMarker(): string;
}

/** Runs scripts on a login terminal's `sh`, one at a time, as the helper runs them on its session in shared mode. */
export class TerminalSessionRunner implements SessionRunner {
  private readonly runs: ShellRuns;
  private readonly scheduler: Scheduler;

  /** A runner on the terminal; the terminal's end ends every run. */
  constructor(options: TerminalRunnerOptions) {
    const {terminal} = options;
    this.scheduler = options.scheduler;
    this.runs = new ShellRuns({
      write: text => {
        terminal.send(text);
      },
      scheduler: options.scheduler,
      newMarker: () => options.newMarker(),
      onWedged: () => {
        terminal.dispose();
      },
    });
    const output = new LineSplitter(line => {
      this.runs.hear(line);
    });
    terminal.onOutput(text => {
      output.push(text);
    });
    terminal.onEnd(() => {
      output.flush();
      this.runs.end();
    });
  }

  /**
   * Runs the script in its turn and gives its lines to `onLine` until it has answered; the whole wait, the queue
   * included, is bounded by `waitMilliseconds`.
   */
  runOnSession(
    request: SessionRun,
    onLine: (line: string) => void,
    waitMilliseconds: number,
  ): Promise<SessionRunEnd> {
    return new Promise(answer => {
      let answered = false;
      function settle(end: SessionRunEnd): void {
        if (!answered) {
          answered = true;
          cancel();
          answer(end);
        }
      }
      const cancel = this.scheduler.setTimer(waitMilliseconds, () => {
        settle({kind: 'failed', reason: 'timeout', detail: 'no end in time'});
      });
      void this.runs
        .execute(request, line => {
          if (!answered) {
            onLine(line);
          }
        })
        .then(settle);
    });
  }
}
