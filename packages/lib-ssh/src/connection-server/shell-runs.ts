/**
 * @fileoverview The scripts that run on the host through the shared `ssh` session. The session is started with no
 * command, so the remote login shell reads its commands from standard input; a run writes its commands there and
 * reads the script's output from standard output, up to a line that carries the run's own marker and the exit
 * status. One run is on the session at a time; the others wait their turn in the order they came.
 */

import type {Scheduler} from 'lib-helper';
import {type Interpreter, posixQuote} from 'lib-host';
import {base64Lines, environmentPrefix} from '../process/remote-program.ts';
import {powershellCommandsFor} from './powershell-session.ts';

const SESSION_ENDED: RunEnd = {
  kind: 'failed',
  reason: 'channelClosed',
  detail: 'the session ended',
};

/**
 * The host lock a run takes for the whole session: `open` has the session shell open descriptor 9 on `path` before the
 * run, so the script locks that descriptor and the lock lives as long as the shell does; `release` is a run of its own
 * that gives the descriptor up, and the file with it when the session held it.
 */
export interface SessionLock {
  path: string;
  action: 'open' | 'release';
}

/** The fact a script prints when it has locked the session shell's descriptor. */
export const SESSION_LOCK_TAKEN = 'server.lockHeld=yes';

/** What a run is asked to do. */
export interface ShellRun {
  script: string;
  /** Variables added to the script's environment; they reach it as words in front of its command. */
  environment: Readonly<Record<string, string>>;
  /** What the script reads on its standard input as base64; null for none (the script reads nothing). */
  inputBase64: string | null;
  /** How long the script may take once it has started, in milliseconds. */
  deadlineMilliseconds: number;
  /** The session-wide host lock of this run; absent for a run that takes none. */
  sessionLock?: SessionLock;
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
  /** What the session runs its scripts with: a POSIX `sh`, or the PowerShell loop of a Windows host. */
  interpreter: Interpreter;
}

/** A run that waits, or that is on the session. */
interface Queued {
  request: ShellRun;
  onLine: (line: string) => void;
  settle: (end: RunEnd) => void;
}

/** The line that has the session shell open descriptor 9 on `path`, unless it holds the lock already; a path it cannot open leaves the descriptor shut. */
function openLockLine(path: string): string {
  const quoted = posixQuote(path);
  return `[ -n "\${REMOTE_OSS_LOCK_HELD:-}" ] || { ( exec 9>>${quoted} ) 2>/dev/null && exec 9>>${quoted}; }`;
}

/** The line that records that the shell holds the lock and removes the file when the shell ends in order. */
function armLockLine(path: string): string {
  return `REMOTE_OSS_LOCK_HELD=1; trap ${posixQuote(`rm -f ${posixQuote(path)}`)} EXIT HUP`;
}

/** The commands that give the descriptor up, and the file only when the shell held the lock. */
function releaseLockCommands(path: string): string {
  return `exec 9>&-; [ -z "\${REMOTE_OSS_LOCK_HELD:-}" ] || rm -f ${posixQuote(path)}; unset REMOTE_OSS_LOCK_HELD; trap - EXIT HUP`;
}

/** The commands of one run: the start marker, the script with its input, and the end marker with the status. */
export function commandsFor(marker: string, request: ShellRun): string {
  const {sessionLock} = request;
  const opening =
    sessionLock?.action === 'open' ? `${openLockLine(sessionLock.path)}\n` : '';
  const start = `printf '%s%s\\n' ${posixQuote(`${marker}:st`)} 'art'`;
  // Only the run that takes the lock keeps the descriptor: a process another run leaves behind must not hold the lock.
  const closing = sessionLock?.action === 'open' ? '' : ' 9>&-';
  const script = `${environmentPrefix(request.environment)}sh -c ${posixQuote(request.script)}${closing}`;
  const body =
    sessionLock?.action === 'release'
      ? releaseLockCommands(sessionLock.path)
      : request.inputBase64 === null
        ? `${script} </dev/null`
        : [
            `base64 -d <<'${marker}_input' | ${script}`,
            ...base64Lines(request.inputBase64),
            `${marker}_input`,
          ].join('\n');
  const end = `printf '%s%s %s\\n' ${posixQuote(`${marker}:e`)} 'nd' "$?"`;
  return `${opening}${start}\n${body}\n${end}\n`;
}

/** The runs of one session. */
export class ShellRuns {
  private readonly options: ShellRunsOptions;
  private readonly waiting: Queued[] = [];
  private active:
    | {
        queued: Queued;
        marker: string;
        started: boolean;
        taken: boolean;
        cancel: () => void;
      }
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
      active.taken ||= line === SESSION_LOCK_TAKEN;
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
    this.active = {queued, marker, started: false, taken: false, cancel};
    this.options.write(
      this.options.interpreter === 'powershell'
        ? powershellCommandsFor(marker, queued.request)
        : commandsFor(marker, queued.request),
    );
  }

  private finish(end: RunEnd): void {
    const {active} = this;
    if (active === undefined) {
      return;
    }
    active.cancel();
    this.active = undefined;
    const {sessionLock} = active.queued.request;
    if (active.taken && sessionLock !== undefined) {
      // Written before the next run, so no run can reopen the descriptor between the script's lock and this line.
      this.options.write(`${armLockLine(sessionLock.path)}\n`);
    }
    active.queued.settle(end);
    this.startNext();
  }
}
