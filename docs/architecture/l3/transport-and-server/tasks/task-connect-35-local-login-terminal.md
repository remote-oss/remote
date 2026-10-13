# Task card connect-35: terminal mode connects: the login terminal runs on the local machine

Issue: #639. Release 0.2, gating (athena, 2026-10-13). Size: S. Builder: iris or hestia, whoever is free first.
**First in the queue.** Several rows run in terminal mode and wait on this card:
- F-2501 AC-13;
- F-2102 AC-19 to 22, 26 and 30;
- F-2101 AC-4's terminal half (#632);
- D-65's F-2304, F-2305 and F-2306 flows.

## 1. The defect and where the connect stops

**What proteus saw** (pinned VSCodium, main 233e3b7, `remote.SSH.useLocalServer: false`, by hand):
- The ssh client sees `-V`, then `-F <config> -G -- harness`, then nothing.
- The log stops after "Using ssh client: <path>", and about 17 s later shows "connect failed: timeout".
- No terminal ever appears.

**Where it stops:**
1. The pipeline has located the client (`-V`) and read the host's effective configuration (`-G`).
2. It enters the terminal connection step (`remote-ssh/src/pipeline/terminal-connection-step.ts`,
   `openTerminalConnectionStep`), which calls `terminals.open(...)`.
3. `loginTerminalsOf` (`remote-ssh/src/surfaces/login-terminal.ts`) calls `window.createTerminal({..., cwd:
   homeFolder})` with `homeFolder` a **string**.
4. The step then starts its connect wait (`ConnectWait`) and waits for the terminal's first output, or the
   authenticated marker.
5. Neither ever comes, so the wait fires `timeout` and the pipeline reports "connect failed: timeout".

**Why the terminal never starts** ([oss]):
- `src/vs/workbench/contrib/terminal/browser/terminalProcessManager.ts`: a terminal whose `cwd` isn't a URI takes
  `remoteAuthority` from the window's environment. In a window on `ssh-remote+<host>` that's the authority being
  resolved, so the process waits for the remote terminal backend. That backend exists only once this same connect has
  succeeded: a deadlock that the connect wait ends.
- Only a `cwd` that's a URI with the `file` scheme gives `getRemoteAuthority(cwd)` = `undefined`, which means the local
  backend.
- `terminalService.ts` `createTerminal` also skips its wait for the terminal profiles in that case
  (`isLocalInRemoteTerminal`): "these terminals need to be launched before remote connections are established".

**Why the acceptance run missed it:** the `terminal` launch's one row
(`suite-terminal/terminal-mode.test.ts`) asserts `env.remoteName` and the setting. Both hold in a window whose resolve
failed.

## 2. The fix

`login-terminal.ts`: the terminal's `cwd` becomes `editor.Uri.file(homeFolder)`. The adapter's `editor` parameter type
gains `'Uri'` in its `Pick` (`Pick<typeof vscode, 'window' | 'TerminalExitReason' | 'Uri'>`). `extension.ts` already
passes the `vscode` module. Nothing else changes in the product.

## 3. Rows

**Unit rows** (`remote-ssh/test/unit/login-terminal.test.ts`). The fake editor gains `Uri.file`, returning
`{scheme: 'file', fsPath: <path>}`.

| Cite | Given | Expected |
|---|---|---|
| F-2308 §16 | the existing first row | `cwd` is now `{scheme: 'file', fsPath: '/home/a'}` (replace the string in the row's expected object); every other field unchanged |
| #639 | `opened()` | `created[0].cwd` is not a string, and its `scheme` is `file` |

**Acceptance row** (`tests/acceptance/suite-terminal/terminal-mode.test.ts`), named
`#639: in terminal mode the window's connection works (the login terminal is local)`. In the `terminal` launch:
- `vscode.workspace.fs.stat(vscode.Uri.parse('vscode-remote://ssh-remote+harness/home/harness'))`, retried every
  500 ms for at most 60 s, resolves with `type` `FileType.Directory`;
- `connectionLog()` (from `suite/harness.ts`) has no line containing `connect failed`.

**It must fail on main and pass with the fix:** run the `terminal` launch on main with the new row and no fix, and
paste the failure into the PR. Then paste the passing run with the fix. Keep the existing row.

**Full VSCodium run:** `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`, every launch green. Paste the
summary.

## 4. Gates and review

`pnpm lint`, `format:check`, `typecheck`, `dupes`, `dead`, `check-layout`, `coverage` (`login-terminal.ts` stays at
100 %). PR title `remote-ssh: terminal mode connects; the login terminal runs locally (card connect-35, #639)`. themis or
triton reviews; athena gives the design check. proteus repeats the manual check of #639 on the built VSIX.

## 5. Open rows (stop and report on #639)

1. With a `file:` `cwd` in a remote window, core prints the line "This shell is running on your local machine, NOT on
   the connected remote machine" as the terminal's initial text (`terminalService.ts`, `localTerminalRemote`).
   - If that text reaches `onDidWriteTerminalData` and the login parser reads it as a question or an error, stop and
     report the record and log lines. Don't filter it by guess.
   - If it doesn't reach the parser, note that in the PR.
2. If the acceptance row still fails with the fix, report the log from "Using ssh client" on, and the terminal list
   (`vscode.window.terminals` names). Don't widen the connect wait.
