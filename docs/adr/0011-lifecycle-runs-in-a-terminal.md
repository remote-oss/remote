# ADR-0011: Lifecycle commands run in a real terminal, through the editor's own node-pty

- Status: accepted
- Date: 2026-10-16
- Deciders: the user (2026-10-16, "I approve giving lifecycle commands a terminal"); written by the lead (athena)
- Scope: `remote-containers` (C3 cli-bridge and its preload, C4 the lifecycle's wiring, C7 the "Configuring..."
  terminal)
- Requirements: F-0415 AC-36 and 7.E6; R-26; ADR-0007 (the editor version floor), ADR-0009 (the CLI bridge),
  ADR-0010 (markers); card containers-04 ("Output split across events"), card containers-38 §3.3;
  remote-oss/remote-containers#126; remote-oss/remote#1023, #1024

## Context

The "Configuring..." terminal runs lifecycle commands with a pipe on stdin, because the pinned CLI (0.89.0) can't
find `node-pty`. With a pipe, three things go wrong, all measured on main (remote-containers#126):

- a command that turns echo off to read a secret (a one-time passcode at a `code >` prompt) can't do so, and the
  presenter echoes every printable key, so **the secret shows in plain text**;
- a command that prints back what it read shows the answer twice;
- bash `read -p` prints no prompt at all when stdin isn't a terminal.

#1024's 50 ms release fixed prompts that a command prints itself. It can't fix these three, because they depend on
whether stdin is a terminal.

The pinned CLI already supports a terminal. Its module loader (`[devcontainers-cli] dist/spec-node/devContainersSpecCLI.js`)
tries each entry of `process.env.NODE_PATH`, then a plain `require('node-pty')`. When that load succeeds, the
host-side runs (`initializeCommand`) go through its `ptyExec` and the in-container runs through `docker exec -it`.
When it fails, both fall back to the pipes we use today. It also takes `--terminal-rows` and `--terminal-columns`.

The editor ships `node-pty` for its own terminal, in `<appRoot>/node_modules.asar` with the native `pty.node`
unpacked. selene measured that with this path on the module search, both kinds of run get a pty (Linux,
VSCodium 1.140, Electron 43 / Node 24). The prompts show at once, and the pty does the echo and line editing. This
location isn't extension API.

The extension already has the switch it needs: #1023's `StdinPresentation` (`echoed` | `plain`). Card
containers-38 §3.3 named this change: "a CLI that bundles `node-pty`" flips both operations to `echoed`.

## Decision

1. **Lifecycle runs get a terminal through the CLI's own `node-pty` path.** We bend the CLI through its first
   mechanism, its inputs and its process (ADR-0009 decision 2.1). We don't patch the CLI, add `node-pty` to the VSIX,
   or write a pty of our own.
2. **We use the editor's copy, found from `vscode.env.appRoot`.** `cli-paths.ts` is the one place that names
   `<appRoot>/node_modules.asar`, and the path reaches C3 as a value in `CliTarget`, like `dockerPath`. We don't
   ship a native module, and we add no licence or notice.
3. **Only the CLI's own process can see it.** The CLI preload (`programs/cli-preload.ts`) makes `node-pty` resolvable
   to the CLI's `require`, and to nothing else:
   - it doesn't set `NODE_PATH` (or any other variable) in the environment the CLI passes to its children, and it
     leaves a `NODE_PATH` of the user's untouched, so a lifecycle command sees the editor's environment as before
     (ADR-0009 deviation 3);
   - it uses Node's documented `module.registerHooks` resolve hook for the one specifier `node-pty`, and only when
     the default resolution fails. If the hook can't load from the asar under `ELECTRON_RUN_AS_NODE`, the card may
     add the folder to the CLI process's own module search instead. The rule above doesn't change.
4. **The extension knows the mode; it doesn't guess it.** Before the CLI's code runs, the preload loads `node-pty`.
   It writes one marker line of its own on stderr, saying whether the load succeeded (ADR-0010; the card names the
   marker). Because the load runs in the same process, the CLI's own load can't give a different answer. C3 reads
   the marker and gives each run its `StdinPresentation`: `echoed` when the load succeeded, `plain` when it failed or
   no marker came. `onStdin` is called once the mode is known. A run that falls back to pipes behaves exactly as it
   does today.
5. **The terminal's size goes to the CLI.** C3 passes `--terminal-rows` and `--terminal-columns` from the
   "Configuring..." terminal's size when the run starts. A resize during the run doesn't reach the pty. That gap is
   accepted for release 1.
6. **Platforms flip one at a time.** The preload installs the hook only on platforms whose acceptance rows have run
   with a pty. Release 1 is Linux client and local engine (brief-release-1), so Linux comes first. Windows (the CLI
   calls node-pty with `useConpty: false`), macOS and WSL stay `plain` until a card measures them, along with any
   proxied run such as Clone in Container Volume when it comes in.
7. **Secrets keep their guarantees.** A pty's echo and its `\r\n` line endings reach C3 as `raw` output and go through
   the same line hold, 50 ms release and `scrubbed()` (card containers-04, R-26). An echo-off read prints nothing,
   so a typed secret no longer reaches the terminal or the log at all.

## Options considered

| Option | For | Against |
|---|---|---|
| The editor's `node-pty`, made visible to the CLI process alone by the preload (chosen) | the CLI's own pty path; no native module of ours; a fallback to today's pipes | an internal editor path, which a later editor version may move (decision 4 and the Check catch that) |
| `NODE_PATH` in the CLI's environment | one line; the CLI reads it first | the CLI passes its environment to host-side commands, so a user's commands see a changed `NODE_PATH` |
| Bundle `node-pty` in the VSIX | a path we control | a native build per platform and Electron ABI; a per-platform VSIX; a new licence; it breaks on each Electron bump |
| Our own pty, or `script(1)` around the command | no editor dependency | rebuilds what the CLI already has; patches the CLI's command line (ADR-0009); `script` isn't on every platform |
| Keep pipes (the earlier "no ADR for now" on #126) | nothing changes | a typed one-time passcode shows in plain text; the user reversed it |

## Consequences

- The three failures on #126 go away on Linux: an echo-off prompt hides its input, an answer shows once, and
  `read -p` shows its prompt.
- Ctrl+C becomes the pty's interrupt for the command's process group, as in any terminal. The presenter already
  forwards control keys raw.
- What must change, in the card that implements this (daedalus writes it):
  - contracts.md, the `CliHost` row: the presentation is reported per run by C3 from the marker, and the spawn
    note names the preload's `node-pty` resolution;
  - card containers-38 §3.3: the flip happens now, from the marker, for both operations. The 7.E6 rows assert the
    pty's single echo;
  - F-0415 7.E6 and AC-36: the echo rows follow the pty; the AC-36 Ctrl+C half becomes reachable, and the card says
    whether it takes it;
  - card containers-04: output can now carry `\r\n` and the pty's echo. The hold rules stay.
- The extension now depends on where the editor keeps `node-pty`. If it moves, the runs fall back to pipes (with
  today's behaviour, safe but the secret echo comes back), and the Check below fails CI.

## Check

- **Unit:** the preload rows: with the editor folder present, the CLI process resolves `node-pty`, and a child it
  starts sees neither a new `NODE_PATH` nor a changed one; with the folder absent, the marker says not loaded and the
  run is `plain`. C3's rows: the marker sets `echoed`, and no marker gives `plain`.
- **Acceptance** (Linux, the pinned editor build): an `initializeCommand` and a `postCreateCommand` each read with
  echo off (`read -s`), and the typed text isn't in the terminal; `read -p` shows its prompt before the answer is
  typed; an echoing command shows the answer once. A row also asserts that the run used a pty. That catches the
  editor moving `node-pty`, because a silent fallback would make that row fail.
- **Review:** a PR that sets `NODE_PATH` in a child's environment, adds `node-pty` to the VSIX, or flips a platform
  without its acceptance rows fails the design check. Raising the editor floor (ADR-0007) or bumping the editor in
  CI runs the acceptance rows above.
