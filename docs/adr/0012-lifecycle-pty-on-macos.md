# ADR-0012: Lifecycle commands run in a real terminal on macOS too

- Status: accepted
- Date: 2026-10-16
- Deciders: the user (2026-10-16, who reviews and approves this change and supplied the macOS measurement)
- Scope: `remote-containers` (C3's CLI preload)
- Requirements: ADR-0011 decisions 4, 6 and 7, and its Check; F-0415 AC-36 and 7.E6; remote-oss/remote-containers#126

## Context

ADR-0011 runs lifecycle commands in a real terminal through the editor's own `node-pty`. Its decision 6 installs the
preload's resolve hook only on platforms whose acceptance rows have run with a pty. Linux has those rows (card
containers-39). macOS stayed `plain`.

On macOS the pipe keeps all three failures from #126. A command that reads a secret with echo off shows the typed
secret in plain text. A command that prints back what it read shows the answer twice: the presenter's echo, then the
command's copy (`[Y/n] > y`, then `y` on the next line). Bash `read -p` shows no prompt.

The project has no macOS machine in its lab and no macOS CI runner, so the acceptance rows can't run there. The user
ran a probe on their own Mac. It does what the preload and the CLI do: under the editor's binary with
`ELECTRON_RUN_AS_NODE=1`, it installs the same `module.registerHooks` resolve hook for `node-pty` with the fallback to
`<appRoot>/node_modules.asar`, loads `node-pty`, spawns `/bin/sh` on a pty at 80×24, and types a secret at an echo-off
`read`. The result, on VS Code (`/Applications/Visual Studio Code.app`):

```
native: pty.node
native: spawn-helper
versions: darwin arm64 node 24.21.0 electron 43.7.7
load: ok
tty: yes | answer reached the command: yes | typed secret shown: no
RESULT: pass
```

## Decision

1. **The preload's pty platforms are `linux` and `darwin`.** The hook, the marker, the `echoed` presentation and the
   fallback to pipes all work on macOS exactly as ADR-0011 has them on Linux. Nothing else changes.
2. **For macOS, the user's probe run stands in for ADR-0011 decision 6's acceptance rows**, until a macOS runner exists.
   The probe covers loading, the terminal, the answer reaching the command and the hidden secret on Apple silicon
   (`darwin arm64`). It doesn't cover Intel Macs, the CLI's own spawn of the command, or the editor-level rows of
   card containers-39 §6.
3. Windows and WSL stay `plain` (ADR-0011 decision 6).

## Options considered

| Option | For | Against |
|---|---|---|
| Switch macOS on with the user's probe as the measurement (chosen) | fixes the visible secret and the doubled answer for macOS users now; the code path is the one CI tests on Linux | no CI row on macOS; the probe is one machine and one architecture |
| Wait for a macOS runner | the full acceptance rows before the switch | there's none; macOS users keep a visible secret until there is |

## Consequences

- On macOS, an echo-off prompt hides its input, an answer shows once, and `read -p` shows its prompt.
- If the editor moves `node-pty` on macOS, runs fall back to pipes as on Linux. No macOS CI row catches that, so a
  user report would.
- Intel Macs (`darwin x64`) take the same path unmeasured. If `node-pty` doesn't load there, the marker says
  `loaded: false` and the run is `plain`, as today.

## Check

- **Unit:** the preload rows that need a pty run on Linux and macOS and skip elsewhere.
- **Measurement:** the probe output above, from the user's machine. A macOS runner, when one exists, takes card
  containers-39 §6's rows and replaces this measurement.
