/**
 * @fileoverview The scripts that run on the host through the shared `ssh` session. The session is started with no
 * command, so the remote login shell reads its commands from standard input; a run writes its commands there and
 * reads the script's output from standard output, up to a line that carries the run's own marker and the exit
 * status. One run is on the session at a time; the others wait their turn in the order they came.
 */

import type {Scheduler} from 'lib-helper';
import {posixQuote} from '../process/remote-program.ts';

/** The characters of base64 text on one line of the input. */
const BASE64_LINE_LENGTH = 76;

const SESSION_ENDED: RunEnd = {
  kind: 'failed',
  reason: 'channelClosed',
  detail: 'the session ended',
};

/** What a run is asked to do. */
export interface ShellRun {
  script: string;
  /** What the script reads on its standard input as base64; null for none (the script reads nothing). */
  inputBase64: string | null;
  /** How long the script may take once it has started, in milliseconds. */
  deadlineMilliseconds: number;
}

/** How a run ended: the script's exit status, or why there is none. */
export type RunEnd =
  | {kind: 'ended'; status: number}
  | {kind: 'failed'; reason: 'channelClosed' | 'timeout'; detail: string};

/** What the runs need from the session and from their surroundings. */
export interface ShellRunsOptions {
  /** Writes commands to the session's standard input. */
  write(text: string): void;
  scheduler: Scheduler;
  /** A marker no script can guess and no earlier run used. */
  newMarker(): string;
  /** A run went past its deadline: the session cannot be trusted with another and has to end. */
  onWedged(): void;
}

/** A run that waits, or that is on the session. */
interface Queued {
  request: ShellRun;
  onLine: (line: string) => void;
  settle: (end: RunEnd) => void;
}

/** The commands of one run: the start marker, the script with its input, and the end marker with the status. */
export function commandsFor(marker: string, request: ShellRun): string {
  const start = `printf '%s\\n' ${posixQuote(`${marker}:start`)}`;
  const script = posixQuote(request.script);
  const body =
    request.inputBase64 === null
      ? `sh -c ${script} </dev/null`
      : [
          `base64 -d <<'${marker}_input' | sh -c ${script}`,
          ...(request.inputBase64.match(
            new RegExp(`.{1,${String(BASE64_LINE_LENGTH)}}`, 'gu'),
          ) ?? []),
          `${marker}_input`,
        ].join('\n');
  const end = `printf '%s %s\\n' ${posixQuote(`${marker}:end`)} "$?"`;
  return `${start}\n${body}\n${end}\n`;
}

/** The runs of one session. */
export class ShellRuns {
  private readonly options: ShellRunsOptions;
  private readonly waiting: Queued[] = [];
  private active:
    | {queued: Queued; marker: string; started: boolean; cancel: () => void}
    | undefined;
  private over = false;

  /** Runs on a session after its login. */
  constructor(options: ShellRunsOptions) {
    this.options = options;
  }

  /** Runs a script in its turn; `onLine` receives each line it writes, before the end is known. */
  execute(request: ShellRun, onLine: (line: string) => void): Promise<RunEnd> {
    return new Promise(settle => {
      if (this.over) {
        settle({
          kind: 'failed',
          reason: 'channelClosed',
          detail: 'the session ended',
        });
        return;
      }
      this.waiting.push({request, onLine, settle});
      this.startNext();
    });
  }

  /** A line of the session's standard output. */
  hear(line: string): void {
    const {active} = this;
    if (active === undefined) {
      return;
    }
    const startMark = `${active.marker}:start`;
    const endMark = `${active.marker}:end `;
    if (!active.started) {
      active.started = line.includes(startMark);
      return;
    }
    const endAt = line.indexOf(endMark);
    if (endAt < 0) {
      active.queued.onLine(line);
      return;
    }
    // The last words of a script that wrote no line end are in front of the marker.
    if (endAt > 0) {
      active.queued.onLine(line.slice(0, endAt));
    }
    this.finish({
      kind: 'ended',
      status: Number(line.slice(endAt + endMark.length)),
    });
  }

  /** The session ended: the run on it and the runs behind it fail, and no run is accepted any more. */
  end(): void {
    this.over = true;
    if (this.active !== undefined) {
      this.finish(SESSION_ENDED);
    }
    for (const queued of this.waiting.splice(0)) {
      queued.settle(SESSION_ENDED);
    }
  }

  private startNext(): void {
    if (this.active !== undefined || this.over) {
      return;
    }
    const queued = this.waiting.shift();
    if (queued === undefined) {
      return;
    }
    const marker = this.options.newMarker();
    const cancel = this.options.scheduler.setTimer(
      queued.request.deadlineMilliseconds,
      () => {
        // The session may hold a script that never ends, so it takes no further run.
        this.over = true;
        this.finish({
          kind: 'failed',
          reason: 'timeout',
          detail: `no end within ${String(queued.request.deadlineMilliseconds)} ms`,
        });
        this.options.onWedged();
      },
    );
    this.active = {queued, marker, started: false, cancel};
    this.options.write(commandsFor(marker, queued.request));
  }

  private finish(end: RunEnd): void {
    const {active} = this;
    if (active === undefined) {
      return;
    }
    active.cancel();
    this.active = undefined;
    active.queued.settle(end);
    this.startNext();
  }
}
