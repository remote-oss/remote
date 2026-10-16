# Task card containers-39: lifecycle commands run in a real terminal, through the editor's `node-pty` (ADR-0011)

Issue: #1027. Milestone 0.4, containers release 1. Size: M. Builder: `task:local`. Every change and every row is
spelled out below; if something on main doesn't match what this card says, stop and report on #1027 (§8).

**Build after** containers-38 (#1021, PR #1023) and #1024 are on main. They are, at 3900212d.

Sources:
- ADR-0011 (`docs/adr/0011-lifecycle-runs-in-a-terminal.md`), decisions 1–7 and its Check. This card is the one ADR-0011's
  Consequences name ("the card that implements this");
- dike's three notes on the ADR's review (remote#1026): the CR stays raw on a pty run (§3.3), the marker names which
  copy was loaded (§3.1), the 7.E6 echo rows run against the pty's echo (§6);
- ADR-0009 (the CLI bridge, mechanism 1 and deviation 3), ADR-0010 (markers);
- F-0415 (remote-oss/remote-containers#32) 7.E6, AC-36; remote-oss/remote-containers#126;
- card containers-38 §1 and §3.3; card containers-04 ("Output split across events").

## 0. Where this card stands on the terminal work of #1019–#1026

The six PRs are on main and this card builds on all of them. What each one left, and what this card does with it:

| PR | What it put on main | This card |
|---|---|---|
| #1019 | the CLI's stdin is a pipe (`stdio: ['pipe', …]`, `SpawnedCli.stdin`); `onStdin` hands a writer; the host turns CR into LF; the presenter echoes keys | keeps the pipe and the writer; the CR→LF becomes `plain`-only (§3.3); the writer is handed when the marker arrives, not right after the spawn (§3.3) |
| #1022 | the presenter's own line editing for a pipe: backspace pops the line, a lone Escape goes raw, an Escape sequence (forward delete) is swallowed; the `line-editing` row types `ab`, Backspace, Delete, Enter and expects `answered: a` | the editing stays for `plain` runs. On an `echoed` run the pty's line discipline edits: backspace works (measured: the pty echoes `\b \b`), but forward delete's `\x1b[3~` is **not** a canonical-mode editing key and reaches the command as typed (measured: `read -r` gets `a\x1b[3~`). The `line-editing` row changes (§6) |
| #1020, #1023 | `StdinPresentation` (`echoed` \| `plain`) through `CliHost.run`, the bridge and the lifecycle's wiring, both operations `'plain'`; the presenter forwards raw on `echoed`; card containers-38 §3.3 names the flip | the flip happens here: the host decides the mode from the marker, the `presentation` parameter goes away from `run` and the bridge (§3.3, §3.4), the wiring's two `'plain'` go away (§3.5), §3.3 of the card is rewritten (§3.8). The presenter's `echoed` branch is used as built |
| #1024 | the 50 ms idle release of a held `raw` tail, so a prompt with no newline shows | unchanged and needed: a pty's echo of one key is a `raw` chunk with no newline, and shows through that release. The echo rows therefore see the typed key about 50 ms after the keystroke, which §6's amended helper waits for |
| #1026 | ADR-0011 | the decisions this card implements; dike's three notes are §3.1 (`from`), §3.3 (CR raw) and §6 (the echo rows) |

Nothing in these PRs is reverted. The presenter's `plain` path, the raw hold and the scrubbing all stay as they are
and are exercised by the existing rows on the platforms that stay `plain`.

## 1. What this card builds

1. **The preload loads the editor's `node-pty` into the CLI's process, for the CLI alone** (ADR-0011 decisions 1–3):
   `src/programs/cli-preload.ts` installs a `module.registerHooks` resolve hook for the one specifier `node-pty`,
   which falls back to `<appRoot>/node_modules.asar/node-pty` when the default resolution fails. No environment
   variable is set.
2. **The preload says what it did, in a marker line** (decision 4, ADR-0010): one JSON line on stderr before the CLI
   runs. C3 reads it and gives each run its `StdinPresentation`: `echoed` when loaded, `plain` otherwise.
3. **A pty run's keys go through raw** (dike's note 1): the CR-to-LF conversion of `node-cli-host.ts` applies to
   `plain` runs only.
4. **The terminal's size reaches the CLI** (decision 5): `--terminal-rows` and `--terminal-columns`, from the
   "Configuring..." terminal's size when the run starts.
5. **Linux only** (decision 6): the hook installs on `linux`; every other platform stays `plain`.
6. **The rows**: the preload rows, C3's rows, the lifecycle wiring, and the 7.E6 acceptance rows re-pointed at the
   pty's own echo, plus `read -s`, `read -p` and Ctrl+C rows.

## 2. What was measured (Linux, VS Code 1.139.1 (04c0d99f4f) / Electron 43.6 / Node 24.20, the pinned CLI 0.89.0, Docker 29)

All measured on this card's draft, with a preload equal to §3.1 and the CLI driven as `node-cli-host.ts` drives it
(`ELECTRON_RUN_AS_NODE=1`, stdin piped, `--log-format json`):

- `module.registerHooks` exists in the editor's Node (24.20) and in our Node 24. A resolve hook for `node-pty` that
  falls back to `<appRoot>/node_modules.asar/node-pty` loads it under `ELECTRON_RUN_AS_NODE`: the native `pty.node`
  is read from `node_modules.asar.unpacked`. Decision 3's "may add the folder to the module search instead" is not
  needed.
- With the preload, `initializeCommand` runs on `/dev/pts/N`: `read -s -p "code > "` shows its prompt, the typed
  `s3cret\r` prints nothing, and the command gets the value. `postCreateCommand` runs through `docker exec -it`:
  `tty` gives `/dev/pts/0` in the container, `read -p` shows its prompt and the pty echoes the typed `bob` once,
  as a `raw` event of channel `postCreate` with `\r\n` endings.
- A user `NODE_PATH` set in the editor's environment is seen unchanged by `initializeCommand` (`NP=/tmp/.../userpath`),
  and the container's command sees none. The preload sets nothing.
- The CLI reads `NODE_PATH` entries before the plain `require`. With a user `NODE_PATH` that holds a `node-pty`, the
  CLI's own load takes that copy, while the preload's hook only runs when the default resolution fails. Both are
  pty implementations, so the echo mode is the same (dike's note 2). The marker therefore names the copy that *the
  preload* resolved (`from: 'editor'` or `from: 'default'`, §3.1), and C3 reads only `loaded`.
- Ctrl+C (`\x03`) written to the CLI's stdin during a `postCreateCommand` that sleeps: the pty prints `^C`, the
  command's Stop line follows at once, then the CLI's own bold `postCreateCommand from devcontainer.json
  interrupted.` as a `raw` event, and `postStartCommand` runs after it. That is F-0415 7.E6's Ctrl+C half, and
  this card takes it (§6, row c5).
- `--terminal-rows` and `--terminal-columns` are accepted by `up`, `run-user-commands` and `read-configuration`
  (each implies the other). The CLI passes them to `node-pty` as `rows`/`cols`.
- Without the preload's hook (or on a platform where it doesn't install), the CLI's `require('node-pty')` fails as
  today and both runs use pipes: the existing behaviour, byte for byte.

## 3. The changes

### 3.1 `src/programs/cli-preload.ts` (the preload)

Replace the file's body with the following. It bundles on its own (tools/build.ts, `src/programs/*.ts`), so it may
import Node modules but nothing of `src/`.

```ts
/**
 * @fileoverview Runs inside the dev container CLI's own process, before its code. Two jobs: Electron reads
 * `ELECTRON_RUN_AS_NODE` once, at start, so the CLI's children must not inherit it; and the CLI's lifecycle commands
 * get a real terminal when the CLI can load `node-pty`, which the editor ships for its own terminal (ADR-0011). The
 * editor's copy is made resolvable to this process's `require` alone: no environment variable is set, so a lifecycle
 * command sees the editor's environment as before. The preload says what it loaded in one marker line on stderr.
 */

import module from 'node:module';
import path from 'node:path';

/** The marker line's name (ADR-0010 rule 1: a new family starts with `remote-oss-`). */
const MARKER = 'remote-oss-cli-preload';

/** The platforms whose acceptance rows have run with a pty (ADR-0011 decision 6). */
const PTY_PLATFORMS = new Set(['linux']);

/** Where the editor keeps `node-pty`: handed by the host in `REMOTE_OSS_EDITOR_MODULES`, removed below. */
const EDITOR_MODULES_VARIABLE = 'REMOTE_OSS_EDITOR_MODULES';

delete process.env.ELECTRON_RUN_AS_NODE;
const editorModules = process.env[EDITOR_MODULES_VARIABLE];
delete process.env[EDITOR_MODULES_VARIABLE];

/** The marker: whether `node-pty` loads in this process, and which copy did. */
function marker(loaded: boolean, from: 'default' | 'editor' | 'none'): string {
  return `${JSON.stringify({marker: MARKER, nodePty: {loaded, from}})}\n`;
}

if (editorModules !== undefined && PTY_PLATFORMS.has(process.platform)) {
  let from: 'default' | 'editor' = 'default';
  module.registerHooks({
    resolve: (specifier, context, nextResolve) => {
      if (specifier !== 'node-pty') {
        return nextResolve(specifier, context);
      }
      try {
        return nextResolve(specifier, context);
      } catch {
        from = 'editor';
        return nextResolve(path.join(editorModules, 'node-pty'), context);
      }
    },
  });
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the CLI's own loader is `require`
    require('node-pty');
    process.stderr.write(marker(true, from));
  } catch {
    process.stderr.write(marker(false, 'none'));
  }
} else {
  process.stderr.write(marker(false, 'none'));
}
```

Rules the code above follows, so the builder doesn't vary them:
- The marker is one whole line of JSON, `{"marker":"remote-oss-cli-preload","nodePty":{"loaded":<bool>,"from":"default"|"editor"|"none"}}`,
  written before the CLI's code runs. `from` says which copy the preload's own `require` resolved: `default` when
  Node found one without the hook (a user's `NODE_PATH`, or a global install), `editor` when the hook fell back to
  the editor's folder, `none` when nothing loaded or the hook wasn't installed.
- The hook is installed only when the host handed the editor's folder **and** the platform is in `PTY_PLATFORMS`.
  Anything else (Windows, macOS, a run with no folder) writes `loaded: false` and changes nothing else.
- `REMOTE_OSS_EDITOR_MODULES` is read and **deleted** before the CLI runs, so no child of the CLI sees it
  (ADR-0009 deviation 3). The preload sets no variable.
- If the `require` inside the hook throws for the editor's path too, the error leaves the hook, the preload's own
  `try` catches it and writes `loaded: false`. The CLI's later `require('node-pty')` fails the same way and falls
  back to pipes.
- If `module.registerHooks` is missing (an older Node), treat it as not loaded: guard with
  `typeof module.registerHooks === 'function'` around the `if` body, writing `loaded: false` otherwise. Our Node
  floor has it; the guard keeps the preload from crashing the CLI on a stray runtime.

### 3.2 `src/cli/cli-paths.ts`

`CliPaths` gains `editorModules: string`, "the folder the editor keeps its own Node modules in
(`<appRoot>/node_modules.asar`); the preload resolves `node-pty` from it". `cliPathsOf(extensionPath, appRoot)` takes
`appRoot` as its second parameter and sets `editorModules: path.join(appRoot, 'node_modules.asar')`. `extension.ts`
passes `vscode.env.appRoot`. This is the one place that names the folder (ADR-0011 decision 2).

### 3.3 `src/cli/node-cli-host.ts`

- The spawn's `env` becomes `{...editorEnvironment, ELECTRON_RUN_AS_NODE: '1', REMOTE_OSS_EDITOR_MODULES: paths.editorModules}`.
- The host reads the marker. Keep a `let presentationOf: StdinPresentation | undefined` per run. In the stderr line
  splitter's callback, before `onLine`, try `JSON.parse(line)`; when the parsed value is an object with
  `marker === 'remote-oss-cli-preload'`, set `presentationOf = parsed.nodePty?.loaded === true ? 'echoed' : 'plain'`
  and **do not** pass the line to `onLine` (it isn't a CLI event). Any other line, parseable or not, goes to `onLine`
  as today. Matching is on the whole line's JSON `marker` field, nothing else (ADR-0010 rule 1).
- `onStdin` is called once the mode is known (ADR-0011 decision 4): when the marker line arrives, or at the process's
  end if no marker came (then `plain`). So the `onStdin(deliver, …)` call moves from right after the spawn into a
  `function offerStdin(presentation)` that runs at most once: called from the marker branch, and from the end of
  `run` (before the return) with `'plain'` if it hasn't run yet. The `presentation` parameter of `run` is **removed**
  from `CliHost.run` and from this host: the host decides it from the marker. The marker is the preload's first
  act, before the CLI's code runs, so it reaches the host well before any lifecycle command can prompt; a key typed
  in the ms between the spawn and the marker goes nowhere, as a key with no run stdin does today.
- `deliver` converts CR to LF **only for a `plain` run** (dike's note 1): `stdin.write(presentation === 'plain' ? data.replace(/\r/gu, '\n') : data)`.
  An `echoed` run's reader is a pty whose line discipline handles Enter and whose raw-mode readers (`read -n1`, a
  TUI) expect the key as typed.
- Update the comment on `deliver` accordingly: "A `plain` run's stdin is a pipe, not a TTY: it does not turn an
  Enter's CR into the LF a reading shell waits for, so the host does what the TTY driver would. An `echoed` run's
  stdin reaches a pty, which does it itself."

### 3.4 `src/cli/cli-host.ts` and `src/cli/cli-bridge.ts`

- `CliHost.run` loses its `presentation?` parameter. The doc comment says: "`onStdin`, when given, gets the writer
  for the CLI's stdin and the run's input presentation once the host knows it: `echoed` when the preload loaded
  `node-pty` (its marker says so), `plain` when it didn't or no marker came." `StdinOf` and `StdinPresentation`
  are unchanged.
- `CliBridge.up`, `runUserCommands` and `readConfiguration` lose `presentation?` too, and `drive` stops passing it.
- `CliTarget` gains `terminalSize?: {rows: number; columns: number}`. `commonArguments` adds
  `'--terminal-rows', String(rows), '--terminal-columns', String(columns)` right after `--log-format json` when
  `terminalSize` is set. Values are integers ≥ 1; the caller guarantees it (§3.6).

### 3.5 `src/lifecycle/container-lifecycle.ts`

- The two `'plain'` arguments handed to `bridge.up` and `bridge.runUserCommands` go away (the host decides).
- `LifecyclePresenter` gains `terminalSize(): {rows: number; columns: number}`: the last size a "Configuring..."
  terminal reported, or `{rows: 24, columns: 80}` when none has reported yet. It never gives `undefined`.
- The lifecycle's `CliTarget` for `up` and `run-user-commands` sets `terminalSize: presenter.terminalSize()`, read
  when each run starts. `readConfiguration` passes none.
- Why the fallback: the terminal opens on a run's first output, so for `up` it opens with the `initializeCommand`
  itself, after the size was read. Without a fallback the host-side run would never get the flags. `24×80` is
  `node-pty`'s own default (`DEFAULT_ROWS = 24`, `DEFAULT_COLS = 80` in the editor's copy), so the fallback gives
  the size the pty would take anyway, and both runs get the flags (ADR-0011 decision 5). A first run that gets
  `24×80` while the panel is wider is the accepted gap of decision 5: the size isn't updated after the run starts.

### 3.6 `src/surfaces/lifecycle-terminal.ts` and `src/extension.ts`

- `TerminalPort.open` gains a fourth parameter `onDimensions: (size: {rows: number; columns: number}) => void`,
  which the adapter calls from the pseudoterminal's `open(initialDimensions)` when it is defined, and from
  `setDimensions` (the stable `Pseudoterminal.setDimensions`) on each change. The presenter keeps the last reported
  size in one variable of its own, shared by every run (a later run's terminal opens in the same panel), starting at
  `{rows: 24, columns: 80}`, and returns it from `terminalSize()` (§3.5). A later change doesn't reach a running
  pty (ADR-0011 decision 5, accepted).
- `extension.ts` `terminalPortOf()` wires `open: initialDimensions => { ...; if (initialDimensions) onDimensions(initialDimensions); }`
  and `setDimensions: onDimensions`. Both fields are stable API (`vscode.Pseudoterminal`).
- `attachStdin` is unchanged: the presenter already takes `(write, presentation)` and branches on it (containers-38).

### 3.7 `docs/architecture/l3/containers-engine/contracts.md`, the `CliHost` (C3) row

Replace the row's interface text with: `run(arguments, onJsonLine, cancellation, onStdin?) → {kind: 'ran', result,
status}` or `{kind: 'spawnFailed', message}`; `onStdin`, when given, gets the writer for the CLI's stdin and the
run's `StdinPresentation` once the host knows it, from the preload's `remote-oss-cli-preload` marker: `echoed` when
the preload loaded `node-pty` (the run's reader is a pty, which echoes), `plain` when it didn't or no marker came
(amended 2026-10-16 for ADR-0011). Replace the row's spawn note with: spawns `process.execPath` with
`ELECTRON_RUN_AS_NODE=1` and `REMOTE_OSS_EDITOR_MODULES=<appRoot>/node_modules.asar` on the bundled CLI's entry
script, after the preload, which removes both variables and resolves `node-pty` from the editor's folder for this
process alone (ADR-0009, ADR-0011); the CLI's stdin is piped.

### 3.8 Card containers-38 §3.3

Replace the section's text with one paragraph: "Since ADR-0011 (card containers-39) the mode isn't wired per
operation: C3 reads it per run from the preload's marker. On Linux both operations are `echoed` when the editor's
`node-pty` loaded, `plain` otherwise and on every other platform. The 7.E6 rows assert one echo per typed key in
both modes."

## 4. Rows, unit

Every existing row that passes a `presentation` to `bridge.up`, `runUserCommands`, `readConfiguration` or
`host.run` drops it (the fakes in `cli-contract.test.ts`, `connector.fixture.ts`, `container-lifecycle.test.ts`,
`node-cli-ports.test.ts`, `cli-bridge.test.ts`). The existing `F-0415 7.E6: up, run-user-commands and
read-configuration hand their presentation to the host` row in `cli-bridge.test.ts` is removed. The
`container-lifecycle.test.ts` row that expects `['ready', true, true, 'plain', 'plain', …]` drops the two
`'plain'` cells and the `presentation` fields it reads.

| File | Name | Expected |
|---|---|---|
| `cli-preload.test.ts` | `ADR-0011: with the editor folder present, the CLI process resolves node-pty, and the marker says loaded from editor` | build the preload as the existing row does; make a folder `<tmp>/editor/node_modules.asar/node-pty/` with an `index.js` of `module.exports = {spawn: () => 'fake'}` and a `package.json` `{"main":"index.js"}`; run `process.execPath --require <preload> -e 'console.log(require("node-pty").spawn())'` with env `{...process.env, ELECTRON_RUN_AS_NODE: '1', REMOTE_OSS_EDITOR_MODULES: '<tmp>/editor/node_modules.asar'}` and no `NODE_PATH`; stdout is `fake`, and stderr's first line parses to `{marker: 'remote-oss-cli-preload', nodePty: {loaded: true, from: 'editor'}}`. Skip on `process.platform !== 'linux'` with `this.skip()` |
| `cli-preload.test.ts` | `ADR-0011: a child of the CLI sees neither REMOTE_OSS_EDITOR_MODULES nor a new NODE_PATH, and a NODE_PATH of the user's stays` | same setup, `-e 'console.log(JSON.stringify([process.env.REMOTE_OSS_EDITOR_MODULES ?? "absent", process.env.NODE_PATH ?? "absent", process.env.ELECTRON_RUN_AS_NODE ?? "absent"]))'`, once with no `NODE_PATH` (expect `["absent","absent","absent"]`) and once with `NODE_PATH: '/u/own'` (expect `["absent","/u/own","absent"]`) |
| `cli-preload.test.ts` | `ADR-0011: a NODE_PATH of the user's that holds node-pty is the copy the default resolution takes, and the marker says from default` | the fake `node-pty` under `<tmp>/own/node-pty/`, `NODE_PATH: '<tmp>/own'`, plus the editor folder: stdout `fake`, marker `{loaded: true, from: 'default'}` |
| `cli-preload.test.ts` | `ADR-0011: with the folder absent the marker says not loaded, and nothing else changes` | no `REMOTE_OSS_EDITOR_MODULES`: marker `{loaded: false, from: 'none'}`, and `require("node-pty")` in `-e` throws (stdout from a `try` prints `missing`) |
| `cli-preload.test.ts` | `ADR-0011: a folder whose node-pty cannot load gives not loaded` | `REMOTE_OSS_EDITOR_MODULES` names an empty folder: marker `{loaded: false, from: 'none'}`, the process exits 0 |
| `node-cli-host.test.ts` | `ADR-0011: the marker line sets echoed, and is not told as a CLI line` | the fake writes `{"marker":"remote-oss-cli-preload","nodePty":{"loaded":true,"from":"editor"}}\n` then `{"type":"text","level":2,"text":"hi"}\n` on stderr: `onStdin` got `'echoed'`, and `onLine` saw only the `hi` line |
| `node-cli-host.test.ts` | `ADR-0011: a marker that says not loaded gives plain` | marker with `loaded: false`: `onStdin` got `'plain'` |
| `node-cli-host.test.ts` | `ADR-0011: no marker gives plain at the end of the run, once` | no marker, the process exits: `onStdin` was called once, with `'plain'`, before `run` resolves |
| `node-cli-host.test.ts` | `ADR-0011: a line that mentions the marker inside other text is a CLI line, not the marker` | stderr `{"type":"text","text":"remote-oss-cli-preload"}` and `prefix {"marker":"remote-oss-cli-preload",...}`: both reach `onLine`, `onStdin` gets `'plain'` at the end |
| `node-cli-host.test.ts` | `ADR-0011: an echoed run's CR reaches the CLI's stdin as typed` | marker loaded, writer called with `'yes\r'`: `stdinWrote` is `['yes\r']` |
| `node-cli-host.test.ts` | the existing `onStdin gets a writer that delivers …, an Enter as LF` | unchanged, with no marker (plain) |
| `node-cli-host.test.ts` | `ADR-0011: the spawn's environment carries REMOTE_OSS_EDITOR_MODULES from the paths` | the recorded `spawnOptions.env.REMOTE_OSS_EDITOR_MODULES` equals `paths.editorModules` |
| `cli-arguments.test.ts` | `ADR-0011: a terminal size adds --terminal-rows and --terminal-columns after the log format, for the three subcommands` | with `terminalSize: {rows: 24, columns: 80}`: `[..., '--log-format', 'json', '--terminal-rows', '24', '--terminal-columns', '80', ...]`; without it, neither flag |
| `container-lifecycle.test.ts` | `ADR-0011: up and run-user-commands carry the presenter's terminal size, read-configuration none` | the presenter fake's `terminalSize` gives `{rows: 30, columns: 100}`: `bridge.ups[0]?.target.terminalSize` and `bridge.runs[0]?.target.terminalSize` are that; the read's target has none |
| `lifecycle-terminal.test.ts` | `ADR-0011: terminalSize is 24×80 before any terminal reports, then the last reported size, kept for the next run` | before any output `terminalSize()` is `{rows: 24, columns: 80}`; after the terminal opens and the port reports `{rows: 30, columns: 100}` then `{rows: 30, columns: 120}`, it's the latter; after `ended()`, a new run's `terminalSize()` before its terminal opens is still `{rows: 30, columns: 120}` |
| `cli-paths.test.ts` (new if absent) | `ADR-0011: editorModules is the editor's node_modules.asar` | `cliPathsOf('/ext', '/app').editorModules` is `/app/node_modules.asar` |

## 5. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

- `F-0415.AC-36`: `deferred` → `acceptance` (rows c1–c5 cite it). Remove the reason text.
- No other row changes.

## 6. Rows, acceptance (`tests/acceptance/containers/initialize-input.test.ts`, the containers launch)

The four existing rows stay and keep their names. Their helper `theTypedKeyStandsAlone` already asserts one `Y`
after typing it; with a pty the single echo now comes from the pty (dike's note 3). Two amendments, because the
pty's echo arrives through the CLI's stderr and #1024's 50 ms release instead of synchronously from the presenter:

- `theTypedKeyStandsAlone`: after typing `Y`, wait (every 200 ms, up to 10 s) until the terminal text holds one
  more `Y` than `before`; then wait 500 ms more and read again. The helper gives `true` only when that last read
  still holds exactly one more `Y`. A second echo would show in the last read; no echo at all is the timeout, which
  the helper turns into `false`. Then type Enter as today.
- `line-editing` (#1022): the row's name becomes `F-0415 AC-36 (line-editing): backspace edits the line before it
  reaches the command (remote-oss/remote-containers#125)` and it types `ab\x7f\n`, expecting `answered: a\n`. The
  forward delete leaves the row: on a pty it isn't a line-editing key of the terminal's canonical mode, and its
  sequence reaches the command as typed, as it does in any terminal. The presenter's `plain` path keeps swallowing it,
  and the unit rows of #1022 (`a forward delete sequence is swallowed, …`) stay as they are.

If `initcmd-input`, `prompt-shown` or `postcreate-echo` fails after §3 and these amendments, that's an open row
(§8.3): don't adjust the counts.

Add a helper `pressControlC(window)` in `tests/acceptance/windows/renderer.ts`: `pressStroke` with
`{key: 'c', code: 'KeyC', windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, modifiers: 2, text: '\u0003'}`
(`modifiers: 2` is Control in `Input.dispatchKeyEvent`). Export it.

| # | Row | Expected |
|---|---|---|
| c1 | `F-0415 AC-36, ADR-0011 (initcmd-hidden): an initializeCommand that reads with echo off shows its prompt and not the typed text`. `initializeCommand`: `` printf 'code > ' && read -r -s a && printf '\n' && printf 'answered: %s\n' "$a" > <answer> ``. Wait for `code > ` in the terminal (`untilText`), type `SECRET7` then Enter | `answer` holds `answered: SECRET7\n`; the terminal text after the answer was written does **not** contain `SECRET7` |
| c2 | `F-0415 AC-36, ADR-0011 (postcreate-hidden): a postCreateCommand that reads with echo off shows its prompt and not the typed text`. Same command as `postCreateCommand`, writing to `/workspaces/<folder>/answer.txt`; `focusTerminal` first | as c1 |
| c3 | `F-0415 AC-36, ADR-0011 (read-p-prompt): the shell's read -p shows its prompt before the answer is typed, in the container`. `postCreateCommand`: `` read -p "RP> " a && printf "answered: %s\n" "$a" > /workspaces/<folder>/answer.txt ``, run by the image's BusyBox `sh`, whose `read -p` prints its prompt only on a terminal (measured on the run's image: `RP> ` on a pty, nothing on a pipe; amended on #1027) | `untilText(window, 'RP> ')` resolves **before** anything is typed; then type `Y` Enter and the file holds `answered: Y\n` |
| c4 | `ADR-0011 (pty-used): a lifecycle command runs on a terminal`. `initializeCommand`: `` if [ -t 0 ]; then printf 'tty: yes\n' > <answer>; else printf 'tty: no\n' > <answer>; fi `` | `answer` holds `tty: yes\n`. This row is the ADR's Check against the editor moving `node-pty`: a silent fallback gives `tty: no` |
| c5 | `F-0415 AC-36, 7.E6 (ctrl-c): Ctrl+C stops the running postCreateCommand, the interrupted line shows, and postStartCommand still runs`. `postCreateCommand`: `` sh -c 'word=CTRLC; echo "$word"-WAITING; sleep 40; echo "$word"-DONE' `` (the markers are built at run time, so the `Start:` line that shows the command can't hold `CTRLC-DONE`), `postStartCommand`: `` echo POSTSTART-RAN ``. `untilText(window, 'CTRLC-WAITING')`, `focusTerminal`, `pressControlC(window)`; then poll `terminalBuffer(window)` (harness.ts, over the window agent's `acceptance.agent.terminalBuffer`: terminal focus, select all, copy, clear the selection, report the clipboard), every 500 ms for up to 10 s, because the interrupted line scrolls out of the visible rows (amended on #1027) | the terminal's whole buffer holds `postCreateCommand from devcontainer.json interrupted.` and `POSTSTART-RAN`, and holds no `CTRLC-DONE`; then `connectedToContainer`. An empty buffer is an open row, not a dropped assertion |

Each row ends with `connectedToContainer(<window>)` and `closeWindow(<window>)` as the existing rows do. Folder names:
`initcmdhidden`, `posthidden`, `readp`, `ptyused`, `ctrlc`.

## 7. Gates and review

Run all gates with the changed files at 100 %, and the containers launch (`tools/acceptance.ts`, the launch that
holds `initialize-input.test.ts`). `coverage.json`'s exclusion of `src/programs/cli-preload.ts` stays; its text
becomes "runs as a preload in the CLI's own process; the preload rows cover it".

PR title: `remote-containers: lifecycle commands run in a real terminal through the editor's node-pty (card
containers-39, #1027)`. Request athena only; hermes assigns the peer. The PR body lists the measured values of §2
again as they came out on the builder's run (the `tty` paths and the marker line), so the reviewer sees the pty was
used.

## 8. Open rows (stop and report on #1027)

1. `module.registerHooks` is undefined in the editor's Node when the preload runs (the marker says `none` on Linux
   with the editor folder present): report the editor's `process.versions`.
2. The preload's `require('node-pty')` throws with the editor's folder resolvable: report the error text, and whether
   `<appRoot>/node_modules.asar.unpacked/node-pty/build/Release/pty.node` exists.
3. An existing 7.E6 row (`initcmd-input`, `postcreate-echo`, `line-editing`, `prompt-shown`) fails after §3: report
   the terminal text the row read.
4. A `CliTarget` or `onStdin` literal outside tests that §3 doesn't name.
