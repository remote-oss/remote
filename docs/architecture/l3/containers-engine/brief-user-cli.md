# Brief: Install devcontainer CLI and its launcher (F-1201)

Owner: athena (architect). Plan: #1807's release-2 families. Spec: remote-oss/remote-containers#30 (F-1201 Install
devcontainer CLI), `spec:reviewed`.

Decisions: ADR-0009 (the pinned CLI, the editor's Node), D-14 (the `devcontainer` name), F-1406 (our identity; this
settles F-1406 Q-1, which `brief-release-1.md` left for F-1201), R-28, R-60, R-79, ADR-0013, `contracts.md` §3 (the
payload), lib-product (`urlProtocol`, the application's names).

## 1. What a survey found (2026-11-04)

Nothing exists yet: no `installUserCLI`, no `cli-bin` and no launcher. Of the 61 open lines, 50 are gaps and 10 are
macOS or Windows lines. Some parts are reusable:
- `authority/payload.ts`'s hex and payload encoders;
- `cli/override-pre-pass.ts`'s substitution;
- `configuration-text.ts`'s JSONC parse;
- connecting an old-style hex payload, which is built (F-0501 AC-7).

## 2. The `cli-bin` folder (BR-15; C3)

- **Where:** `cli-bin` in the extension's `globalStorageUri`, a folder only the user can write. F-1406 gives its
  parent folder our id.
- **When:** it's written at every activation, in every window.
- **What it holds:**
  - **The launchers:** `devcontainer` (mode 0755) and `devcontainer.cmd`. On Insiders, the launcher is
    `devcontainer-insiders`, by the product's quality (BR-16).
  - **Four data files:** `remote-containers-path`, `vscode-app-root`, `vscode-path` and `vscode-quality`. Their
    contents come from the public API: the extension's install folder, `vscode.env.appRoot`, `process.execPath` and
    the product's quality.
  - **Not written:** the reference's fifth file, `vscode-machine-id`. Nothing we build reads it, so it isn't written
    (R-60, R-28).
- **The two groups are refreshed independently,** each when its key file is missing or no longer matches:
  - `remote-containers-path` for the launchers;
  - `vscode-path` for the editor's files.

  A matching group isn't touched, and a missing folder is written whole.
- **Every file** is written under a temporary name and renamed, so two windows activating together never leave a
  half-written launcher.
- **The launcher scripts** are constant text of ours. They read the paths from the data files at run time, so no
  path is ever pasted into a script. They run the launcher program (§3):
  - **On POSIX:** `ELECTRON_RUN_AS_NODE=1` and the recorded `vscode-path`, with `"$@"` passed through.
  - **On Windows:** the `.cmd` equivalent, with arguments passed through and nothing re-quoted by us.

## 3. The launcher program (C3)

`dist/cli-launcher.js` runs on the editor's own Node (ADR-0009 decision 1), from a shell:
- **`open [path] [--config <file>]`** (BR-16, BR-17, BR-19, BR-20) is ours:
  1. **The folder:** a relative path (the default is `.`) is resolved against the physical current folder and
     normalized. An absolute path is kept as typed, less one trailing `/`. These are BR-20's rules on both platforms,
     since they decide which container a folder maps to.
  2. **The configuration:**
     - **Which:** the given `--config` file, else the folder's default configuration (F-0301's discovery order).
     - **How it's read:** as JSONC.
     - **An invalid file** gives an error that names the file, a non-zero exit status, and nothing launched. That's
       the spec's preferred behaviour, not the reference's.
  3. **The path:**
     - the file's `workspaceFolder`, after substitution with the shell's environment (`localWorkspaceFolder`,
       `localWorkspaceFolderBasename`, `localEnv` and `env`; an unknown variable or `containerEnv` gives `''`, and
       empty segments are dropped);
     - else `/` for a Compose configuration;
     - else `/workspaces/<folder basename>`.

     With `--config`, the rule applies to the given file, the spec's preferred behaviour (decision E3).
  4. **The authority:** `dev-container+<hex>`.
     - **Without `--config`:** the hex of the folder path.
     - **With `--config`:** the hex of the compact `{"hostPath", "configFile": {"$mid": 1, "path", "scheme": "file"}}`.
       F-0501's connector accepts both (built).
     - **A `.code-workspace` argument:** the hex holds the file's path (6.10).
     - **Characters:** spaces, `$` and quotes are kept intact, the spec's preferred behaviour (BR-21 marks the
       reference's losses as not preferred).
  5. **The launch:** the recorded installation's own command line opens the URI, through `--folder-uri` with the
     product's `urlProtocol` from lib-product. No user data or extensions folder is passed, so the default profile
     opens (BR-16, §16's parity rule).
     - It's spawned with an argument list and no shell.
     - On macOS, a window opens as on Linux. That's AC-41's corrected behaviour, where the reference launched nothing
       (7.E6). Its rows are `host: macOS`.
- **`build`** keeps the legacy options (BR-18, 3.5):
  - the positional folder, `--verbose` and `--disable-telemetry` (accepted, and nothing is sent: R-28);
  - the common options;
  - any other open-CLI `build` option is rejected with 7.E5's message.

  It then runs the CLI's `build`.
- **Anything else** is passed to the pinned CLI unchanged. The launcher spawns the CLI's entry script on the same
  Node, with inherited stdio and its exit status passed through. It never imports the CLI (ADR-0009).
- **The help text** (3.5): the CLI's own, plus `open` and the legacy `build` lines in our words.

## 4. The command "Dev Containers: Install devcontainer CLI" (C1, C3)

- **The command:** `remote-containers.installUserCLI`, with F-1201 §3's Palette clause.
  - It runs in the UI extension host (BR-9).
  - At most one of its dialogs shows at a time, and a second run while one is open does nothing (BR-13).
  - It's not cached, so it checks again on every run (BR-6). It never writes a shell profile (BR-10).
- **The PATH** is the extension host's own `process.env.PATH` (BR-2, §16). That's core's resolved shell environment,
  with its wait and its timeout. An entry matches only when its text equals the candidate's path, with no
  normalization (AC-60).
- **Already installed** (BR-7):
  - the candidate's `devcontainer` is a link whose target resolves to our `cli-bin` launcher;
  - another `devcontainer` earlier on the PATH doesn't count either way (AC-13).
- **Linux:** it tries `~/bin`, then `~/.local/bin`, each only if it's on the PATH and exists (BR-1).
  - **The first that qualifies:** a folder is offered; something on the PATH that isn't a folder ends the search with
    S354.
  - **No candidate:** S354, with "Copy CLI Path" (BR-3, BR-8 and S030).
  - **"Create":** the symlink is made with an exclusive create. `EEXIST` from a second window is checked again, not
    reported as a failure (AC-61).
  - **Something else already there** (a foreign file, a second link, a dangling link): F-1201 7.x's dialogs (AC-17,
    AC-51 to AC-53).
- **macOS:** the same, with `/usr/local/bin` as the fallback (BR-4).
  - **The fallback:** S374's notice, then the OS's administrator prompt (`osascript` with administrator privileges,
    the two fixed paths passed as `quoted form of`).
  - **A declined or failed prompt** changes nothing (AC-24).
  - **Rows:** `host: macOS`.
- **Windows:** the user's `Path` environment variable gains the `cli-bin` folder (BR-5).
  - **How:** the user environment is changed through PowerShell's `[Environment]::SetEnvironmentVariable(..., 'User')`,
    spawned with an argument list. `setx` is never used, because it truncates long values.
  - **Rows:** `host: windows`. Rows that need no Docker Desktop can run on the hosted `windows-2025` runner.
- **The dialogs and their button orders** are F-1201's (S030, S354, S381; BR-11, BR-12). No progress is shown.
- **No telemetry** (BR-14, R-28).
- **No uninstall hook** (BR-22): AC-54 and AC-56 accept that, and an uninstall script would be beyond the spec
  (R-60).

## 5. Rows and the cut

- **Unit rows:**
  - `cli-bin`'s two refresh groups and the atomic write;
  - the launcher's argument parsing;
  - BR-20's path rules (POSIX and Windows forms, as pure functions over a separator);
  - BR-19's substitution;
  - BR-17's authority, both forms;
  - the candidate search over a PATH string;
  - the "already installed" check;
  - the Windows PATH edit's argument list.
- **Acceptance rows** (Linux): the command's dialogs, and a launcher run from a shell. The launcher row runs `open`
  with launching stubbed to record its argument list, so it needs no second editor, and `build` and a forwarded `up`
  against the runner's Docker. There's no new fixture.

| Lines | Where |
|---|---|
| the 50 gaps | cards 1 to 3 |
| AC-10, AC-11, AC-24, AC-41 (`host: macOS`); AC-12, AC-25, AC-26, AC-40, AC-50, AC-56 (`host: windows`) | the same cards, as `host:` rows |

**Suggested cards** (daedalus):
1. **`cli-bin` and the launcher:** §2 and §3.
2. **The install command:** §4.
3. **Rows:** §5's Linux acceptance rows.
