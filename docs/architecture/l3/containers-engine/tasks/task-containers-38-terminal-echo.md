# Task card containers-38: one echo per run in the "Configuring..." terminal (the PTY's echo already happens)

Issue: #TBD (release 1). Milestone 0.4. Size: M. Builder: `task:claude`.

**Design:** athena's ruling on the in-container double echo (the follow-up of the #1019 review; decision
record in the `remote-oss/remote-containers#124` area, F-0415 7.E6 and AC-36). The run's input mode goes through
the stdin contract; the presenter echoes only the runs that don't echo.

## 1. The defect

The five in-container hooks (`onCreateCommand`, `updateContentCommand`, `postCreateCommand`, `postStartCommand`,
`postAttachCommand`) run through the CLI's `remotePtyExec` (pinned CLI 0.89.0: the in-container runner is called with
`pty: true`), and `initializeCommand` runs through `ptyExec` on the host (its runner's `print` is `continuous` for
the plain command). `ptyExec` is `node-pty`'s `spawn` when it loads, and a plain `exec` whose stdin is the CLI's
stdin only when it doesn't. With `node-pty`, a key typed into the run's terminal is forwarded to the process's
PTY master; the process's own TTY line discipline echoes it back into the PTY output, the CLI carries that output
into the run's event, and the presenter's echo of the same key renders it a second time. The run is measured:
one echo is correct (F-0415 7.E6), and the presenter currently always does its own.

In release 1 the two input modes sit on different `CliBridge` operations, so the mode is knowable without a CLI
change:

- `up` (host-side): `initializeCommand` (PTY), and the host-side `updateContentCommand` (PTY, `print` `continuous`).
  Its own echo is the only echo.
- `run-user-commands` (in-container): the five hooks (PTY, `print` `end`), through which the echo arrives with the
  run's own output. (The `node-pty`-missing fallback, an `exec` whose stdin is the CLI's stdin, has no echo and needs the
  presenter's; its echo is row 3's, and the `readConfiguration` run runs no interactive commands.)

So the mode is per operation, not per command.

## 2. The change

### 2.1 The contract (C3, `packages/remote-containers/src/cli/`)

`node-cli-ports.ts`:

```ts
/** How a run's input is presented to its reader: a PTY's line discipline echoes the typed input back into the
 * run's own output (`echoed`), or nothing does and the surface must echo it (`plain`). */
export type StdinPresentation = 'echoed' | 'plain';

/** What the host asks of the system. */
export interface NodeCliPorts {
  spawn(
    program: string,
    programArguments: readonly string[],
    options: {
      shell: false;
      detached: true;
      stdio: ['pipe', 'pipe', 'pipe'];
      stdinPresentation: StdinPresentation;
      env: Readonly<Record<string, string | undefined>>;
    },
  ): Promise<CliSpawn>;
  // killGroup unchanged
}
```

`systemCliPorts` passes `stdinPresentation` to `spawn` untouched (it reaches no real API; the port documents the
mode of the child's stdin, which on the system ports is the CLI's own).

`cli-host.ts`:

```ts
/** The writer for a run's stdin, and how its input is presented to its reader. */
export interface StdinOf {
  (write: (data: string) => void, presentation: StdinPresentation): void;
}

/** The dev container CLI as a program. */
export interface CliHost {
  /**
   * Runs the CLI with `cliArguments`. An abort ends the CLI and its children, and the run then ends with status
   * null. `result` is the first line of stdout, when there was one. `onStdin`, when given, gets the writer for the
   * CLI's stdin once the CLI has started, with the run's input presentation, which the surface uses to decide
   * whether to echo the typed input itself.
   */
  run(
    cliArguments: readonly string[],
    onLine: (line: CliLine) => void,
    cancellation: AbortSignal,
    onStdin?: StdinOf,
    presentation?: StdinPresentation,
  ): Promise<CliRun>;
}
```

`node-cli-host.ts`: `run` passes `stdinPresentation: presentation ?? 'plain'` in the `ports.spawn` options, and
hands the guarded writer to `onStdin` as `onStdin(deliver, presentation ?? 'plain')`. The CR-to-LF conversion and
the end-guard are unchanged.

`cli-bridge.ts`: each of `up`, `runUserCommands` and `readConfiguration` (and `drive`) gains `presentation?:
StdinPresentation` after `onStdin?`, and `drive` passes it through to `host.run`.

`contracts.md`, the `CliHost` (C3) row:

> `run(arguments, onJsonLine, cancellation, onStdin?, presentation?) → {kind: 'ran', result, status}` or
> `{kind: 'spawnFailed', message}`; `onStdin`, when given, gets the writer for the CLI's stdin once the CLI has
> started, with the run's `StdinPresentation` (`echoed`: the PTY's line discipline echoes the typed input back
> into the run's own output; `plain`: nothing does, and the surface echoes the printable keys itself); the default
> is `plain` (amended 2026-10-15 on the in-container double-echo follow-up).

`docs/architecture/l3/containers-engine/tasks/` — nothing; this card is the record.

### 2.2 The presenter (C7, `packages/remote-containers/src/surfaces/lifecycle-terminal.ts`, the contract in
`lifecycle/container-lifecycle.ts`)

`container-lifecycle.ts`:

```ts
/** A CLI run has started with its stdin; the run's terminal takes the writer and the run's input presentation,
 * which decides whether the terminal echoes the typed keys itself or lets the run's own echo stand. */
attachStdin(write: (data: string) => void, presentation: StdinPresentation): void;
```

`lifecycle-terminal.ts`: `Run` gains `presentation: StdinPresentation` (`newRun` starts it at `'plain'`), and the
input handler echoes only when the run is `plain`:

```ts
data => {
  if (own.finished) {
    own.open?.close();
    own.open = undefined;
    return;
  }
  // A key of the run: a `plain` run has no reader to echo its input (the CLI's child reads it from a pipe), so
  // the terminal echoes the printable keys; an `echoed` run's PTY line discipline already echoes them into the
  // run's own output, and a second echo is wrong.
  if (own.presentation === 'plain') {
    for (const character of data) {
      const code = character.codePointAt(0);
      if (code !== undefined && code >= 0x20 && code !== 0x7f) {
        own.open?.write(character);
      }
    }
  }
  own.stdin?.(data);
}
```

and `attachStdin: (write, presentation) => { current().stdin = write; current().presentation = presentation; }`.

`container-lifecycle.ts`, the lifecycle's own wiring: `bridge.up` is handed
`presenter.attachStdin, 'plain'` (the host-side run's own echo is the only echo), and `bridge.runUserCommands`
`presenter.attachStdin, 'echoed'` (the in-container hook's PTY echoes). No other call to the bridge gives an
`onStdin`.

## 3. Rows

### 3.1 Unit

- `node-cli-host.test.ts`:
  - `the run's input presentation goes to the host's ports`: `run` with `onStdin` and no presentation — the
    `spawn` options hold `stdinPresentation: 'plain'`, and `onStdin` gets the writer and `'plain'`;
  - `run` with `onStdin` and `'echoed'` — the `spawn` options hold `'echoed'`, and `onStdin` gets the writer and
    `'echoed'`;
  - without an `onStdin` the options still hold `stdinPresentation: 'plain'` (the mode travels with the spawn,
    whatever the surface wants);
  - the existing rows (the writer delivers, converts the CR, is silent without an `onStdin`, stops after the
    process has ended) pass unchanged.
- `lifecycle-terminal.test.ts`:
  - `a plain run's key is echoed and forwarded` (the existing echo row, re-pointed at `attachStdin(writer, 'plain')`);
  - `an echoed run's key is forwarded without a second echo`: after `attachStdin(writer, 'echoed')`, a printable key
    reaches the writer once and the terminal holds no new text (only the output the run itself sent);
  - the forward and the close-on-next-key after `ended()` hold for both presentations;
  - the existing rows that attach stdin are re-pointed at the two-argument form.
- `cli-bridge.test.ts`: `up`, `runUserCommands` and `readConfiguration` each hand their `presentation` to the host
  (a row per method), alongside the existing `onStdin` rows.
- `cli-contract.test.ts`, `connector.fixture.ts`, `container-lifecycle.test.ts` and `node-cli-ports.test.ts`: the
  fakes and fixtures gain `stdinPresentation` in the `spawn` options and the two-argument `onStdin`; a
  contract row asserts the lifecycle hands `'plain'` to `up` and `'echoed'` to `runUserCommands`, and that
  `readConfiguration` hands neither.

### 3.2 Acceptance (`tests/acceptance/containers/initialize-input.test.ts`, or a sibling `lifecycle-echo.test.ts`
if the file gets too wide)

| # | Row |
|---|---|
| 7.E6 | **The host-side echo stands alone.** A devcontainer whose `initializeCommand` prints a prompt and `read`s an answer (the existing row's form); the launch types `Y` + Enter into the "Configuring..." terminal, and asserts the terminal text holds the answer exactly once — the typed `Y` and the command's own `answered: Y` each appear once, never twice. The existing row's assertions (the answer reached the command) stay. |
| 7.E6 | **The in-container echo stands alone.** A devcontainer whose `postCreateCommand` prints a prompt and `read`s an answer into a file in the workspace; the launch types `Y` + Enter into the "Configuring..." terminal during the background run, and asserts the terminal text holds the typed `Y` exactly once and the file holds the answer. (The row's hook is `postCreateCommand`, the first of the five to run.) |
| 7.E6 | **The fallback still echoes.** The same `postCreateCommand` row, with `node-pty` unavailable to the CLI's `ptyExec` in the launch's dev container image, asserts the typed `Y` appears exactly once and the answer lands: the fallback's `exec` has no echo, so only the presenter's does. |

Row 3 is the row that keeps the fallback honest, and it pins a known gap: in release 1 the mode is per operation,
not per command, so the `node-pty`-missing fallback (the in-container hook whose `ptyExec` is an `exec` with the
CLI's stdin as its stdin, and no echo) runs as `'echoed'`, and its input arrives without an echo. The card ships
`'echoed'` for `runUserCommands` because the PTY is the mode the operation exists to serve, and the fallback is
reported, not hidden: the row's assertion is written against the fallback the image gives it, and if the harness
cannot make `node-pty` unavailable to the CLI, the row is dropped and the gap is reported on the issue. A per
command or per hook mode is a CLI change and out of scope here.

## 4. Gates and review

Run all gates with the changed files at 100 %, and the containers launches. PR title: `remote-containers: the
"Configuring..." terminal echoes a run's input once (card containers-38, #TBD)`. Request athena only.
