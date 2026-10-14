# Task card containers-20: the "Configuring..." terminal and S085

Issue: #941. Milestone 0.4, containers release 1. Size: M–L. Builder: `task:claude`.

**Builds after:** containers-15 (#893, the lifecycle rows' configurations) and #918 (its acceptance helpers).

Sources:
- athena's answers on #737 (the comment after 6177739542): the owner, the Start/Stop format, Ctrl+C, S085, S153, and
  the rows to include;
- F-0415 (remote-oss/remote-containers#32): 3.4 (S153), 5.0 step 10, 5.1, 7.E1–7.E3, 7.E6, 7.E7, BR-8, AC-6, AC-11,
  AC-33 to AC-38, AC-41;
- F-0408 (#27): S085 and S086;
- ADR-0010 rules 2 and 4: event text is shown, never matched.

**Measured** (pinned CLI 0.89.0, `up --skip-non-blocking-commands` then `run-user-commands`, `--log-format json`):
- every lifecycle event has `channel: "postCreate"`, `initializeCommand` (on the host, during `up`) included;
- **`raw`**: output chunks, with the CLI's own ANSI. Its bold `Running the <property> from devcontainer.json...`
  lines, and for an object form `Running <entry> of <property>...` plus the entry's output in one event when the
  entry ends;
- **`start` / `stop`**: `text` (`Run in container: …` or `Run: …`), `timestamp`, and `startTimestamp` on `stop`;
- **`text`**: the red, bold failure line `<property> from devcontainer.json failed with exit code <n>. Skipping any
  further user-provided commands.`;
- **`progress`**: `Running <property>...` with a status. It isn't rendered.
- **Nothing to run** (themis on #942): `run-user-commands` on a container with no lifecycle property, or on a reload
  where every marker is satisfied and `postAttachCommand` is unset, ends in about 0.2 s with no event on `postCreate`.

## 1. The design

### 1.1 C3: the events keep what the terminal needs (`cli-lines.ts`, `cli-raw-lines.ts`)

`CliEvent`'s `log` variant gains three fields, read from the JSON line:

```ts
/** The CLI's event type: `raw` output, a `start` or `stop` of a step, or a `text` line; `text` for anything else. */
type: 'raw' | 'start' | 'stop' | 'text';
/** The CLI's own time of the event, in epoch milliseconds; none for a line that isn't JSON. */
timestamp: number | undefined;
/** For a `stop`: when its step started, in epoch milliseconds. */
startTimestamp: number | undefined;
```

- A non-JSON line is `type: 'text'`, with both times `undefined`.
- **The raw hold** (`cli-raw-lines.ts`) joins chunks per channel, as now. A joined event keeps the **first** chunk's
  `timestamp`.
- Existing consumers only read `kind`, `level`, `text` and `channel`, so they don't change.

### 1.2 C7: the `LifecyclePresenter` port (`container-lifecycle.ts`; athena's item 1)

```ts
/** What C7 shows of a run's lifecycle commands; C10 hands it in, and `extension.ts` implements it over the editor. */
export interface LifecyclePresenter {
  /** One event of channel `postCreate`, in order; the first `raw` or `start` opens the terminal. */
  output(event: Extract<CliEvent, {kind: 'log'}>, runStart: number): void;
  /** `run-user-commands` has started; S085 shows on the first `output` after it. */
  backgroundStarted(): void;
  /** The run has ended: S085 hides, and an open terminal writes S153 and closes on the next key. */
  ended(): void;
}
```

- `lifecycleFor(engine, cli)` becomes `lifecycleFor(engine, cli, presenter)`. `connector.ts` passes the dependency
  `lifecyclePresenter` it gains.
- **`runStart`** is `clock()` when `prepare` began (C7 gains `clock: () => number` through its dependencies): "since
  the run began", F-0415 AC-35.
- **In `prepare` and `startBackground`,** each `onCliEvent` is also given to `presenter.output` when `event.kind ===
  'log' && event.channel === 'postCreate'`. Progress events never are. The log keeps every event, as now.
- **`backgroundStarted()`** is called right before `runUserCommands`.
- **The background run** is the one `startBackground` began, with its own `AbortController`. A later `startBackground`
  aborts the one before it, as now, and so does `stopBackground()`.
- **`ended()`** is called:
  - when the background run's `runUserCommands` settles with `done` or with any failure, and that run wasn't aborted;
  - by `stopBackground()` (a window torn down), once, and only if a background run started and hasn't ended;
  - when `up` fails with `lifecycleFailed` for any hook other than `initializeCommand` (AC-41: the terminal behind
    F-0410's dialog ends with S153).
- **`ended()` is never called:**
  - when an aborted run settles, whatever its result. Its `cancelled` (or late `done`) never ends the run that
    replaced it, and `stopBackground()` has already ended it;
  - for an `initializeCommand` failure (AC-41's second half: no failure line and no S153);
  - for a cancelled `prepare`;
  - for any other failed `up`. The spec is silent here. The terminal keeps what it wrote and takes no key, the user
    closes it with the terminal's own close button, and F-0410's dialog reports the failure.

### 1.3 The text (`src/lifecycle/lifecycle-text.ts`, new, pure)

```ts
/** What the terminal writes for one `postCreate` event; `runStart` in epoch milliseconds. */
export function lifecycleTextOf(event: Extract<CliEvent, {kind: 'log'}>, runStart: number): string;
```

| `type` | Written |
|---|---|
| `raw`, `text` | the text with each lone `\n` turned into `\r\n` (a pseudoterminal needs both), and otherwise unchanged: its ANSI passes through |
| `start` | `GREY + '[' + n + ' ms] ' + RESET + GREEN + 'Start' + RESET + ': ' + text + '\r\n'` |
| `stop` | `GREY + '[' + n + ' ms] Stop (' + d + ' ms)' + RESET + ': ' + text + '\r\n'` |

- `n = timestamp - runStart` and `d = timestamp - startTimestamp`. A missing time gives `0`.
- `GREY = '\x1b[90m'`, `GREEN = '\x1b[32m'`, `RESET = '\x1b[0m'`. The spec's "muted grey-brown" depends on the theme,
  and 90 is the terminal's own muted colour.
- The words `Start` and `Stop` and the `[<n> ms]` form are the CLI's text-log format (athena's item 2). They aren't
  reference strings, so they get no S-id and no translation.

### 1.4 The presenter (`src/surfaces/lifecycle-terminal.ts`, new, over ports; the adapters in `extension.ts`)

```ts
export interface TerminalPort {
  /** Creates and shows the terminal named `name`, focused; `onInput` gets each key; `onClosed` fires when the user closes it. */
  open(name: string, onInput: (data: string) => void, onClosed: () => void): {write(text: string): void; close(): void};
}
export interface StatusProgressPort {
  /** Shows `title` as window progress (core's `status.progress`) until the returned function is called. */
  show(title: string): () => void;
}
export function lifecyclePresenterOf(terminal: TerminalPort, progress: StatusProgressPort, translate: Translate): LifecyclePresenter;
```

- **Opening is lazy** (athena's item 5): on the first `output` of type `raw` or `start`, and only once per run. Events
  before that (a `text` or `stop` alone can't come first) are buffered and written on open.
- **The user closes it while commands run** (AC-37): it isn't reopened. Later events are dropped from it (the log
  still has them), and S085 stays until `ended()`.
- **Input:** ignored before `ended()`, Ctrl+C included (athena's item 3). After `ended()`, the first input of any
  kind closes the terminal (AC-33).
- **`ended()`:** hides S085 if it shows, then, if the terminal is open, writes `'\r\n' + BOLD + S153 + RESET`
  (`BOLD = '\x1b[1m'`).
- **`backgroundStarted()`** only records that the background began. S085 shows on the first `output` after it, once,
  and stays until `ended()`. The events of `up` come before it and don't count. A background with nothing to run
  sends no `output` (see Measured), so it shows no S085. A second `backgroundStarted()` before `ended()` (a
  replaced run) changes nothing.
- **Runs** (themis on #948): the presenter keeps its state per run, not per extension host. A run begins with the first
  `output` or `backgroundStarted()` after `ended()` (or the first ever), with its own lazy open, input rule and
  closed-by-user flag. The previous run's terminal, if it still waits for its key, keeps waiting and closes on that
  key. A cancelled run gets no `ended()`, so the next connect's events go on in the same run.

**The adapters (`extension.ts`):**
- `open`: `window.createTerminal({name, pty, isTransient: true})`, where the `pty` is a `Pseudoterminal` with an
  `onDidWrite` emitter (buffered until `open` is called), `handleInput` → `onInput`, `close` → `onClosed`. Then
  `terminal.show(false)`, so it takes focus. `isTransient` is for AC-35 ("not listed by Switch Active Terminal"); §5
  open row 1 measures it.
- `show`: `window.withProgress({location: ProgressLocation.Window, title}, () => <a promise the returned function
  resolves>)`. That's core's `status.progress` entry, which F-0408 3.4 observes for S085.

### 1.5 The strings (`LIFECYCLE_TEMPLATES` in `lifecycle-terminal.ts`, and the l10n bundles)

| Id | English template |
|---|---|
| S086 | `Configuring...` |
| S085 | `Configuring Dev Container (show log)` |
| S153 | `Done. Press any key to close the terminal.` |

S085 is plain text in window progress, which takes no link. The "show log" words stay verbatim, and core's progress
entry opens nothing. athena's "with S085's link" (item 4) is answered by §5 open row 2: report whether window progress
can carry the command.

### 1.6 `components.md`

C7's row gains, in "Uses": "a `LifecyclePresenter` port (the "Configuring..." terminal and S085), which C10 hands it and
`extension.ts` implements". athena asked for this in the card's PR.

## 2. Files

| File | What |
|---|---|
| `src/cli/cli-lines.ts`, `src/cli/cli-raw-lines.ts` | §1.1 |
| `src/lifecycle/container-lifecycle.ts`, `src/lifecycle/lifecycle-text.ts` (new) | §1.2, §1.3 |
| `src/surfaces/lifecycle-terminal.ts` (new) | §1.4, §1.5 |
| `src/connect/connector.ts`, `src/extension.ts` | the dependency and the adapters |
| `l10n/bundle.l10n*.json` | §1.5 |
| `docs/architecture/l3/containers-engine/components.md` | §1.6 |
| tests | §3 |

## 3. Rows

### 3.1 Unit

| Name | Expected |
|---|---|
| `F-0415 5.1: an event keeps its type and times through the raw hold` | `cli-lines`: a `stop` line gives `type: 'stop'` and both times; two `raw` chunks of one line join with the first chunk's `timestamp`; a non-JSON line is `text` with no times |
| `F-0415 AC-35: the six hooks' Start and Stop lines in order, with n since the run began and d in parentheses` | `lifecycleTextOf` over a recorded event sequence of all six hooks (the fixture `test/fixtures/lifecycle-events.jsonl`, recorded with the pinned CLI as the measurement above was): the exact strings |
| `F-0415 AC-11: a failing hook's red text line passes through unchanged` | the `text` event's text, with `\r\n` |
| `F-0415 5.1: raw output keeps its ANSI and gets \r\n` | `'a\nb\r\n'` → `'a\r\nb\r\n'` |
| `F-0415 AC-35: no events, no terminal and no S085` | `backgroundStarted()` then `ended()`, with no `output`: `open` and `show` never called |
| `F-0415 AC-35: the terminal opens on the first raw or start, once, and writes what came before` | the order of `open` and `write` |
| `F-0415 7.E6 (release 1): Ctrl+C and other keys are ignored while commands run` | `onInput('\x03')`, `onInput('a')` before `ended()`: no `close`, nothing written |
| `F-0415 AC-33: a key after S153 closes the terminal` | `ended()` writes S153 in bold; the next `onInput` calls `close` |
| `F-0415 AC-6, AC-38: S085 shows from the background's first output until the run ends` | `backgroundStarted()` alone: no `show`; then one `output`: `show(S085)` once; a second `output`: no second `show`; `ended()` → its stop called; never `ended()` (AC-38): still shown |
| `F-0415 5.0 step 10: an output of up shows no S085` | an `output` before `backgroundStarted()`: `open` called, `show` not |
| `F-0415 5.0 step 10: a run after an ended run opens its own terminal` | run 1 `ended()` and waits for its key; run 2's first `raw`: a second `open`; a key in run 1's terminal closes it alone. The same after run 1's terminal was closed by the user (`onClosed()`) |
| `F-0415 AC-37: a terminal the user closed isn't reopened` | `onClosed()`, then more events: no second `open`; S085 still shown until `ended()` |
| `F-0415 AC-41: an onCreateCommand failure in up ends the run with S153; an initializeCommand failure doesn't` | `container-lifecycle` with a failing `up` of each kind: `ended()` called, or not |
| `F-0415 5.0 step 10: no ended() for a cancelled or otherwise failed up` | `container-lifecycle`: `up` gives `cancelled`, then (another lifecycle) a failure that isn't `lifecycleFailed`: no `ended()` |
| `F-0415 AC-6: run-user-commands' done ends the run` | `container-lifecycle`: `backgroundStarted()` before `runUserCommands`, `ended()` once after it gives `done` |
| `F-0415 AC-11: a failed run-user-commands ends the run` | `lifecycleFailed` of `postCreateCommand`, then (another lifecycle) a `failed`: `ended()` once each |
| `F-0415 7.E6: stopBackground() ends a started run once` | started: `ended()` once, and the run's `cancelled` settle adds none; `stopBackground()` before any background: none; after the run ended: no second |
| `F-0415 5.0 step 10: a replaced run's settle doesn't end its replacement` | two `prepare`s on one lifecycle; the first run settles `cancelled` after the second began: no `ended()`; the second's `done`: `ended()` once |
| `F-0415 AC-35: runStart is the clock at the start of prepare` | the clock gives 1000 when `prepare` begins and later values after: every `output` gets `runStart` 1000, in `up` and in the background |
| `F-0415 BR-8: only channel postCreate reaches the presenter` | `container-lifecycle`: a `Run: docker …` event with no channel isn't passed |

### 3.2 Acceptance (`tests/acceptance/containers/configuring.test.ts`, the containers launch)

Renderer helpers, beside `notifications`:
- `terminalText(name)`: the active terminal's visible rows (`.xterm-rows` text, joined by `\n`);
- `terminalTabs(name)`: the terminal tab names;
- `statusProgress(name)`: the text of the `status.progress` entry, or `undefined`.
- `pressKey(name, key)`: a key event sent to the focused terminal's textarea.
- `remoteIndicator(name)`: the text of the status bar entry `status.host` (core's "Opening Remote..." while it
  resolves, [oss] `src/vs/workbench/contrib/remote/browser/remoteIndicator.ts`).
- `terminalFocused(name)`: whether the focused element is inside the active terminal's `.xterm`.
- `switchTerminalItems(name)`: runs `workbench.action.quickOpenTerm` ("Terminal: Switch Active Terminal"), gives the
  quick pick's row labels, then Escape.

| # | Configuration | Assertions |
|---|---|---|
| C1 | all six hooks, fast, as in the measurement above | while connecting, a terminal tab `Configuring...` is open. After connecting, its text has, in order, the six `Running the <property>…` lines and each command's output; every Start/Stop line matches `^\[\d+ ms\] (Start\|Stop \(\d+ ms\)): `; the last line is S153 (AC-35, AC-6) |
| C2 | `postCreateCommand: "sleep 8; exit 3"` | while it sleeps, `statusProgress` is S085; afterwards the red line `postCreateCommand from devcontainer.json failed with exit code 3. Skipping any further user-provided commands.` then S153, no notification, and S085 gone (AC-11, AC-6) |
| C3 | C1's, after S153 | `pressKey(name, 'a')` closes the tab (AC-33) |
| C4 | no lifecycle property | for 10 s after connecting: no `Configuring...` tab and no S085 (AC-35's last clause; the background still runs and sends nothing) |
| C5 | `onCreateCommand: "echo create"`, `updateContentCommand: "echo update; sleep 20"` (default `waitFor`) | while `remoteIndicator` still reads `Opening Remote...`: the `Configuring...` tab is open, `terminalFocused` is true, and its text has `create` and `update` with their Start lines. After connecting, `switchTerminalItems` doesn't list `Configuring...` (AC-35) |

## 4. Catalogue

- `acceptance`: F-0415 AC-6, AC-11 (the terminal half), AC-33, and AC-35 once C1, C4 and C5 all pass. If C5's
  Switch Active Terminal check hits open row 1, AC-35 stays `todo` and the report names that clause.
- `unit`: AC-37, AC-38 (the S085 half), AC-41.
- `deferred`: AC-36, with athena's reason "no interrupt API in the pinned CLI's `run-user-commands`; a fake CLI line is
  refused".
- AC-34 stays `todo`: its 20 s object form makes a slow row. Its unit half (the entry's block written when it ends)
  is the CLI's own, which we pass through.

## 5. Gates, review and open rows

Run all gates, the containers launch, and the VSCodium run. The PR title is `remote-containers: the "Configuring..."
terminal and S085, from the CLI's postCreate channel (card containers-20, #941)`. Request athena only; hermes assigns
the peer.

**Open rows (stop and report on #941):**
1. **`isTransient` doesn't keep the terminal out of "Terminal: Switch Active Terminal"** (C5's last check). Report what
   lists it. `hideFromUser` isn't the answer, since the terminal must show.
2. **S085's link.** Window progress takes plain text. Report whether core's `status.progress` entry, when clicked, can
   run `revealLogTerminal`. If it can't, athena decides between this form and a status bar item of our own.
3. **The CLI's `raw` events arrive with `\r\n` already** in some places (the `Running …` lines do). Make sure no row
   gets `\r\r\n`. The conversion is "lone `\n` only".
