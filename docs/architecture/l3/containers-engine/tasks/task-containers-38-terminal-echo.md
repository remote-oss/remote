# Task card containers-38: one echo per run in the "Configuring..." terminal (the run's input mode through the stdin contract)

Issue: #TBD (release 1). Milestone 0.4. Size: M. Builder: `task:claude`.

**Design:** athena's ruling on the in-container double-echo follow-up of the #1019 review (decision record in the
`remote-oss/remote-containers#124` area; F-0415 7.E6 and AC-36). The run's input mode goes through the stdin
contract; the presenter echoes only the runs that don't echo.

## 1. The defect and the run's input mode

Per run, exactly one echo of a typed key is correct (F-0415 7.E6): either the run's reader echoes the input back
into the run's own output and the presenter must not, or nothing does and the presenter must. The presenter
currently always does its own, so any run whose reader also self-echoes shows the key twice.

The mode is a fact of the pinned CLI version (`@devcontainers/cli` 0.89.0, `[devcontainers-cli]`), measured against
its dist: the CLI's package.json holds no dependencies, `node-pty` is nowhere in the package tree (zero hits in
`pnpm-lock.yaml`), and its `loadNativeModule` is a plain `require` — so neither of the CLI's pty paths can load a
PTY, and both resolve to their plain-exec fallbacks:

- **Host-side runs (the `up` operation):** `initializeCommand` and the host-side `updateContentCommand` take the
  CLI's `ptyExec` path, which without `node-pty` is a plain `exec` whose stdin is the CLI's own stdin — a pipe in
  this extension's spawn. No TTY line discipline, no echo of its own; the presenter's echo is the only echo.
  The run's mode is `plain`.
- **In-container runs (the `run-user-commands` operation):** the five hooks (`onCreateCommand`,
  `updateContentCommand`, `postCreateCommand`, `postStartCommand`, `postAttachCommand`) take the `pty: true` path,
  which without `node-pty` is a plain `docker exec -i` — the CLI's `exec` factory adds `-t` only when the CLI's
  own stdin is a TTY, and this extension's spawn pipes it. The command's stdin in the container is therefore a
  pipe: no TTY driver, no echo of its own either. The run's mode is `echoed` — the mode that a run with a
  self-echoing reader takes, and the mode the in-container run has once a CLI bundles `node-pty` (the `pty: true`
  path then allocates a TTY for the command and its line discipline echoes the typed input back into the run's
  output). In the pinned CLI the `echoed` mode means the typed key is forwarded to the command without an echo;
  that is the actual behaviour the acceptance row pins, and the 7.E6 gap it leaves (in-container input has no
  echo in the pinned CLI) is reported on the issue, not hidden.

The mode is per operation in release 1: the two operations serve runs whose readers can't be told apart from
inside the operation, and a per command or per hook mode would be a CLI change. `readConfiguration` runs no
interactive commands and gets no `onStdin`.

## 2. The change

### 2.1 The contract (C3, `packages/remote-containers/src/cli/`)

`cli-host.ts`:

```ts
/** How a run's input is presented to its reader: a reader whose line discipline echoes the typed input back into
 * the run's own output (`echoed`), or nothing that does and the surface echoes the printable keys itself
 * (`plain`). */
export type StdinPresentation = 'echoed' | 'plain';

/** The writer for a run's stdin, with the run's input presentation. */
export type StdinOf = (write: (data: string) => void, presentation: StdinPresentation) => void;

/** The dev container CLI as a program. */
export interface CliHost {
  /**
   * Runs the CLI with `cliArguments`. An abort ends the CLI and its children, and the run then ends with status
   * null. `result` is the first line of stdout, when there was one. `onStdin`, when given, gets the writer for
   * the CLI's stdin once the CLI has started, with the run's input presentation (`presentation`, default
   * `plain`), which the surface uses to decide whether to echo the typed input itself.
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

`node-cli-host.ts`: `run` hands the guarded writer to `onStdin` as `onStdin(deliver, presentation ?? 'plain')`.
The CR-to-LF conversion and the end-guard are unchanged, and `node-cli-ports.ts` is untouched.

`cli-bridge.ts`: each of `up`, `runUserCommands` and `readConfiguration` (and `drive`) gains `presentation?:
StdinPresentation` after `onStdin?`, and `drive` passes it through to `host.run`.

`contracts.md`, the `CliHost` (C3) row:

> `run(arguments, onJsonLine, cancellation, onStdin?, presentation?) → {kind: 'ran', result, status}` or
> `{kind: 'spawnFailed', message}`; `onStdin`, when given, gets the writer for the CLI's stdin once the CLI has
> started, with the run's `StdinPresentation` — `echoed`: the run's reader echoes the typed input back into the
> run's own output, `plain`: nothing does, and the surface echoes the printable keys itself; the default is
> `plain` (amended 2026-10-15 on the in-container double-echo follow-up).

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
  // the terminal echoes the printable keys; an `echoed` run's reader echoes them into the run's own output, and
  // a second echo is wrong.
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
`presenter.attachStdin, 'echoed'` (the in-container run's reader is the one that echoes, once it has a TTY; in
the pinned CLI the key is forwarded without an echo — the row's job). No other call to the bridge gives an
`onStdin`.

## 3. Rows

### 3.1 Unit

- `node-cli-host.test.ts`:
  - `run` with `onStdin` and no presentation: `onStdin` gets the writer and `'plain'`;
  - `run` with `onStdin` and `'echoed'`: `onStdin` gets the writer and `'echoed'`;
  - without an `onStdin` nothing is handed to it and the existing writer rows (delivers, converts the CR, silent
    without an `onStdin`, stops after the process has ended) pass unchanged.
- `lifecycle-terminal.test.ts`:
  - `a plain run's key is echoed and forwarded` (the existing echo row, re-pointed at `attachStdin(writer, 'plain')`);
  - `an echoed run's key is forwarded without an echo`: after `attachStdin(writer, 'echoed')`, a printable key
    reaches the writer once and the terminal gains no text of the key (only the output the run itself sent);
  - the forward and the close-on-next-key after `ended()` hold for both presentations;
  - the existing rows that attach stdin are re-pointed at the two-argument form.
- `cli-bridge.test.ts`: `up`, `runUserCommands` and `readConfiguration` each hand their `presentation` to the
  host (a row per method), alongside the existing `onStdin` rows.
- `cli-contract.test.ts`, `connector.fixture.ts`, `container-lifecycle.test.ts` and `node-cli-ports.test.ts`: the
  fakes and fixtures gain the two-argument `onStdin`; a contract row asserts the lifecycle hands `'plain'` to
  `up` and `'echoed'` to `runUserCommands`, and that `readConfiguration` hands neither an `onStdin` nor a
  presentation.

### 3.2 Acceptance (`tests/acceptance/containers/initialize-input.test.ts`, or a sibling `lifecycle-echo.test.ts`
if the file gets too wide)

| # | Row |
|---|---|
| 7.E6 | **The host-side echo stands alone.** A devcontainer whose `initializeCommand` prints a prompt and `read`s an answer (the existing row's form); the launch types `Y` + Enter into the "Configuring..." terminal, and asserts the terminal text holds the typed `Y` exactly once — the run is `plain`, and in the pinned CLI the host-side run's reader is a pipe with no echo of its own — and the answer reached the command. The existing row's assertions stay. |
| 7.E6, the gap | **The in-container input arrives without an echo in the pinned CLI.** A devcontainer whose `postCreateCommand` prints a prompt and `read`s an answer into a file in the workspace; the launch types `Y` + Enter into the "Configuring..." terminal during the background run, and asserts the file holds the answer (the input arrived) and the terminal holds no text of the typed `Y`: the run is `echoed`, and in the pinned CLI the in-container run's reader is a `docker exec -i` pipe with no echo of its own, so the key is forwarded, not echoed. The row's comments report the 7.E6 gap (in-container input has no echo in the pinned CLI) on the issue, and the run's mode is re-verified when the CLI changes (3.3). |

### 3.3 The mapping is a fact of the pinned CLI version

The mode of each operation is measured against `@devcontainers/cli` 0.89.0. If a future CLI bundles `node-pty`,
the host-side runs start self-echoing (the `ptyExec` path allocates a PTY for the child and its line discipline
echoes the typed input), and `'plain'` for `up` becomes a double echo: the bump re-verifies `up`'s mode before
it lands. The in-container run is the other way around: it then takes the `pty: true` path with a TTY for the
command, and `'echoed'` is the mode that keeps its echo single.

## 4. Gates and review

Run all gates with the changed files at 100 %, and the containers launches. PR title: `remote-containers: the
"Configuring..." terminal echoes a run's input once (card containers-38, #TBD)`. Request athena only.
