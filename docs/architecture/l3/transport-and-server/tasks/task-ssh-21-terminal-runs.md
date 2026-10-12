# Task card ssh-21: script runs over the login terminal (terminal mode T4, second part)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, T4). In terminal mode the probe, install and start run
over the install terminal's one `sh` session, as they run over the helper's session in shared mode. lib-ssh's
`ShellRuns` already runs scripts over one long-lived `sh`, framed by markers; card ssh-20 (#344) made those markers
safe against the terminal's echo. This card is the runner that drives `ShellRuns` over a login terminal (card ssh-18,
#341), so `SharedSessionChannel` can run its scripts on it unchanged. Reviewing coder: `remote-coding-worker-1`.

Depends on #341 (ssh-18, merged) and #344 (ssh-20). Start after both are on main.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/terminal/terminal-runs.ts` | new: `TerminalSessionRunner` (section 2) |
| `packages/lib-ssh/src/index.ts` | export `TerminalSessionRunner` and its options type |
| `packages/lib-ssh/test/unit/terminal-runs.test.ts` | new |

Nothing else. Nothing calls it yet; T5 does.

## 2. Contract

```ts
import type {Scheduler} from 'lib-helper';
import type {SessionRunner} from '../connection-server/shared-channel.ts';
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
  constructor(options: TerminalRunnerOptions);
  runOnSession(
    run: SessionRun,
    onLine: (line: string) => void,
    waitMilliseconds: number,
  ): Promise<SessionRunEnd>;
}
```

Built exactly as `ConnectionHandler` builds its runs (`connection-server/handler.ts`, the `ShellRuns` it makes for the
helper's session), with the terminal in place of the process:

- One `ShellRuns` with `write: text => terminal.send(text)`, the given `scheduler` and `newMarker`, and
  `onWedged: () => terminal.dispose()` (a run past its deadline means the shell can't be trusted; ending the
  terminal ends the connection, as F-2308 BR-7 says the install terminal carries it). `ShellRuns` settles the run as
  `timeout` **before** it calls `onWedged`, so that run answers `timeout`; the end the disposal then causes finds no
  run in progress, and fails only the queued ones as `channelClosed`.
- The terminal's output (plain text, card ssh-18) goes through one `LineSplitter` into `runs.hear`.
- `terminal.onEnd` → the splitter's `flush()`, then `runs.end()`: a run in progress and the queued ones fail as
  `channelClosed` (`ShellRuns`'s own "the session ended").
- `runOnSession(run, onLine, waitMilliseconds)`:
  - calls `runs.execute({script, inputBase64, deadlineMilliseconds}, line => …)` and answers its `RunEnd` as the
    `SessionRunEnd` (`RunEnd`'s reasons, `channelClosed` and `timeout`, are both `ScriptFailureReason`s);
  - bounds the whole wait (the queue included) by `waitMilliseconds` through the scheduler, as the lease's request
    bound does in shared mode: past it, it answers `{kind: 'failed', reason: 'timeout', detail: 'no end in time'}`
    (the shared mode's text, `client.ts` `runOnSession`);
  - delivers `onLine` only until it has answered: lines the run produces after a timeout answer are dropped, as the
    shared client drops its line listener on any answer.

## 3. Test table

One assertion per `it`; the cite starts the name. The terminal is `RecordingTerminals` from
`lib-ssh/testing/recording-terminal` (card ssh-18): a test writes the shell's output with `write` and reads what was
sent from `sent`. The scheduler is the fake of the existing `shell-runs.test.ts`. `newMarker` gives `m1`, `m2`, … .

| Cite | Given | Expected |
|---|---|---|
| contracts §S10 | a run of `echo hello` | `sent` is `[commandsFor('m1', run)]` |
| contracts §S10 | the terminal then writes `m1:start\nhello\nm1:end 0\n` | `onLine` got `['hello']`, and the run answered `{kind: 'ended', status: 0}` |
| brief T4, #299 | the terminal first writes back every sent command line (the echo), then `m1:start\nhello\nm1:end 3\n` | `onLine` got `['hello']`, and the answer is `ended` with status 3 |
| brief T4 | the output arrives split in odd pieces (`m1:st`, `art\nhel`, `lo\nm1:end 0\n`) | `onLine` got `['hello']`, answer `ended` 0 |
| contracts §S10 | two runs asked at once | the second's commands are sent only after the first's end line |
| contracts §S10 | the terminal ends (`end(0)`) during a run | the run answers `{kind: 'failed', reason: 'channelClosed', detail: 'the session ended'}` |
| contracts §S10 | a run asked after the terminal ended | answers `channelClosed` at once, nothing sent |
| contracts §S10 | the terminal ends with a queued second run | the second also answers `channelClosed` |
| F-2308 BR-7 | a run past its deadline (the fake scheduler fires it) | the terminal was disposed (`disposed` true) |
| F-2308 BR-7 | the same | the run answers `{kind: 'failed', reason: 'timeout', …}` |
| contracts §S10 | `waitMilliseconds` passes while an earlier run still holds the session | the waiting run answers `{kind: 'failed', reason: 'timeout', detail: 'no end in time'}` |
| contracts §S10 | the same, and the earlier run then ends and the waiting one's lines arrive | the timed-out run's `onLine` got nothing after its answer |
| #299 | the terminal's output carries ssh's own lines (`debug1: …`) before and between runs | they reach no run's `onLine` |

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: script runs over the login terminal (card ssh-21, terminal mode T4)`.

## 6. Open rows

None.
