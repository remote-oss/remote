# Brief: commands, surfaces and the `code` command (F-6102, F-6203 to F-6207, F-6401, F-6402)

Part of `brief-remote-wsl.md` (#2348), whose §2 rulings apply here; item 2 (`validDistroName`) and item 4 (neutralised
text) bind every command below. Owner components: D12 wsl-commands with the new D12e explorer-launcher, D10
window-advisories, D8 shell-handoff with the build-time D8g, D11's writing side, `wsl.window-surfaces` (area B).

## 1. Adding a distro (F-6102)

- **One flow** behind all four entry points (D12). The no-distro notice (STR:S033, with the STR:S005 button when the
  caller asks for it) is one D12 function shared with F-6202 and F-6203.
- **The picker** lists every entry of `wsl.exe --list --online`, sorted as `sortOnlineCatalogue` does (AC-3 stays
  provisional on Q7). Friendly names are display text with `$(` escaped. "No distro installed" and "the list failed" are
  told apart by exit status and row count, never by WSL's localised text (7.E1, 7.E3).
- **The install** types `wsl.exe --install -d <NAME>` into a terminal of the user's default profile, created from the
  local extension host through a narrow terminal port (`create`, `show`, `sendText`). `<NAME>` passes `installCommandLine`'s
  check first. Nothing is installed without a pick, and no watcher follows the install (BR-6, BR-8).
- **"Browse Store...":** `ms-windows-store://search/?query=Linux` (`reading-2348-store-link`). It is an app link to the one
  place a distro comes from, not a help or issue URL, so R-31 has no address of ours to put there.
- **A failed online list** opens the picker with only "Browse Store..." and writes one log line
  (`reading-2348-online-list-failure`; 7.E4 fixes only that no install starts).

## 2. Open Folder in WSL (F-6203)

- **The dialog** is core's `showOpenDialog`; core picks native or quick input.
- **The start folder's share host** comes from the Windows build: `\\wsl.localhost` from build 21354, `\\wsl$` before
  (`reading-2348-share-host`; D3 takes the host as a parameter, AC-23).
- **The chosen folder:** the host match is exact; a distro segment that fails `validDistroName` is not a distro (a silent
  no-op). The window opens with the opener's "core decides" target, with no force flags, so
  `window.openFoldersInNewWindow` applies (BR-4, AC-6, AC-10).
- **STR:S046** is shown when `!multiDistroAllowed(build)`, with `{0}` = `1903`, the same label as S064
  (`reading-2348-s046`).
- **Never** writes `security.allowedUNCHosts` (AC-16, AC-20) or grants trust.
- **Availability:** a window with no remote or a `wsl` remote; elsewhere `silent`. The list call is bounded, and at the
  bound the no-distro notice shows, as for a failed list (AC-15, AC-21).

## 3. Reopen in WSL and Reopen in Windows (F-6204)

- **Owner:** D12, with D3 contributing (components.md is corrected).
- **Paths:**
  - Windows to distro: D3's pure pre-check accepts a drive form (`^[A-Za-z]:[\\/]`) or a WSL share and nothing else
    (`notTranslatable`, no process); `wslpath -u -- <path>`; the result must start with `/`.
  - Distro to Windows: D3's new `toWindows` (`wslpath -w -- <path>`), accepting only a drive form or a share form and
    rebuilding the share form, so a hostile distro can't name an arbitrary local or UNC folder.
  - A failed `wslpath` is silent (7.E6, 7.E12).
- **`wsl.noWSLPath`:** D2's pure `pathTranslationAvailable(build)` (build 17063 or later, or unknown) is read once at
  activation and set by `wsl.package`. When it is false, D12 shows STR:S047 with `{0}` = "Windows build 17063".
- **The reload** uses the opener's new local form for a drive or UNC path (`Uri.file`), and the lifted `open-gate.ts`, so
  no window is reloaded into an authority nobody can resolve. The picker is F-6202's port (provisional).
- **An unregistered distro** (7.E13, AC-36): the window reloads if the name passes `validDistroName`; otherwise there is
  no reload and one log line.
- **An untitled workspace, `ruling-2348-untitled-workspace`** (Q3, 7.E8, AC-30, AC-31): the command refuses before the
  picker with an information message of ours. Core's "save your workspace?" prompt runs as the window unloads, after
  our command has passed its target, so the saved path never comes back to us and option (a) has no hook. The card
  verifies that against core first; if core does return the path, it takes option (a) instead.
- **Out of context:** `silent` for both commands, also for Reopen in WSL inside a WSL window (7.E5 isn't reproduced).
  There is no default-distro step and no progress before the picker (7.E11, BR-9).

## 4. Labels (F-6205, under revision)

- **Formatters, plural:** `wsl.window-surfaces` registers one per listed distro, `docker-desktop` included, once D6's
  step-4 list read returns, before the connect's outcome. They aren't refreshed afterwards (R-60).
- **lib-authority** widens `registerAuthorityLabel`: an explicit authority, `workspaceTooltip`, `priority` (where the
  pinned proposal has it). The manifest also declares the static `wsl+*` formatter (F-7901 §2.5).
- **A distro with no version** gets no tooltip (Q2 option (b), `reading-2348-label-no-version`; AC-19 allows it). STR:S042's
  `{0}` has Markdown metacharacters escaped, since core renders the tooltip as trusted Markdown.
- **Waiting on the revision:** AC-3, AC-4, AC-18, AC-19, AC-20.

## 5. Recommendations (F-6206)

- **D10** evaluates R1 (WSL 2 on `/mnt/<letter>/…`) and R2 (WSL 1) when the first resolve has settled connected, once per
  extension host, and R3 (a local window on a `\\wsl` share) after `onStartupFinished`. An unknown version and a nested
  authority show neither R1 nor R2. `<letter>` is lower case only (`reading-2348-mount-letter`).
- **Flags:** three booleans under our id, never keyed by distro or path (BR-5). R3's text is a string-table entry, English
  verbatim, localisable.
- **`remote-wsl.reopenFromRecommendation`** is always registered (`silent`; available in a local window on a share). It
  ignores every argument, reads the window itself, reloads only the current window, and needs a distro that passes
  `validDistroName`. Where WSL can't be detected it shows F-6101's message and doesn't reload (AC-26, provisional).
- **"Read More"** opens our constant page through `env.openExternal`.

## 6. Reveal in File Explorer (F-6207): D12 and D12e

- **The resource:** only a `vscode-remote` resource with the window's own authority is revealed; `untitled` gives STR:S052
  (its `{0}` escaped); no editor takes BR-1's fallback (the workspace folder, else `/home`). An editor of any other scheme
  reveals nothing and writes a log line (`reading-2348-reveal-non-file`, following AC-26 where 7.E6 differs). Nothing is
  stat'ed (AC-18).
- **D12e explorer-launcher** (new, process) is the one place that starts `explorer.exe`: the absolute
  `%SystemRoot%\explorer.exe` (from the composition root), a verbatim command line `/select,"<path>"`, no shell. The path
  must start with `X:\` or `\\wsl.localhost\<registered>\` (`\\wsl$\` on old builds) and contain no `"` and no control
  character; otherwise nothing starts and the refusal is logged. The card checks `,`, `#`, `%`, `&`, spaces and non-ASCII
  on the Windows runner.

## 7. `code` in a distro shell (F-6401): D8, D8g and D11's writing side

- **The route, `reading-2348-code-route`** (Q1 option (a), F-7901 Q1): `scripts/wslCode.sh` accepts the stock launcher's
  five leading arguments and VSCodium's six. A VSCodium user reaches us through
  `VSCODE_WSL_EXTENSION_ID=remote-oss.remote-wsl`; the stock launcher never does (7.E5). The rows run on VSCodium with
  that variable passed through `WSLENV`.
- **The argument form** is decided by the launchers' fixed leading arguments (from [oss] `code.sh` and VSCodium's
  patch), never by the shape of a user argument; the card documents the environment flag that settles the case where
  they can't be told apart.
- **The source, `reading-2348-shell-source`:** the launcher's arguments are the only channel into the script, so only
  lib-product's built-in table, keyed by the application name, is available there (BR-8's first two sources can't
  reach it). The install half is generated at build time by D8g (`tools/`) from lib-server's POSIX functions and that
  table, so there is one installer. It verifies with `sha256sum` when a hash was announced, else by length.
- **Input checks:** `WSL_DISTRO_NAME` passes the shell port of `validDistroName`; if it is absent, the script prints a
  failure line and exits, without guessing. User arguments go only to the server CLI, never to `eval`, `sh -c` or a
  Windows shell, and the Windows executable path comes only from the launcher's positional argument.
- **The environment record** (D11, F-6303 6.1):
  - **When:** written only when the call names a folder or a workspace file (`code .`, `code <folder>`,
    `code <file>.code-workspace`); never for files, `-r` or no folder.
  - **Where:** `mktemp` in a private per-user directory (`$XDG_RUNTIME_DIR` when it is the user's with mode 0700, else
    `~/.cache/remote-oss-wsl/` made 0700), file mode 0600, one use, captured with tracing off.
  - **What:** the exported environment minus `PWD`, `OLDPWD`, `SHLVL`, `_`, `WSL_INTEROP` and `WSLENV`, which belong to
    the shell process (`reading-2348-env-exclusions`).
  - **Taking it (D6 through D4):** owner and mode are checked first; a strict parser (names `[A-Za-z_][A-Za-z0-9_]*`, at
    most 1 MiB, no NUL); 60 s expiry; it is deleted by the take even when unused. The key is the outer authority, the
    distro and the path. Values never reach a Windows command line, environment, `WSLENV` or a log.
- **Option-only calls** (`--version`, `--help`, `--list-extensions`) install the server first on a first run, since its
  CLI is in the archive (`reading-2348-option-only`). The logical working folder (`$PWD`) is passed to the server CLI
  explicitly (BR-3, AC-8; the card verifies which input carries it). Exit codes beyond 14 are a table in the card.
- **Tests:** the script is unit-tested on Linux with stand-in tools; `.gitattributes` keeps it LF-only.

## 8. Windows command line (F-6402)

No code of its own. Its rows pass through F-6201's resolver, F-6205's labels, F-6001's activation and D2's match, and
nothing parses paths, expands `~` or maps `C:\` (7.E8, 7.E10; R-60). AC-24 needs a genuine VS Code client (`host:`).

## 9. The cut

| Card | Scope | Test kinds |
|---|---|---|
| cmd-1 | lib-wsl: D2's process half, `validDistroName`, `pathTranslationAvailable`, D1's `wslconfig.exe` route, D3's `toWindows`, pre-checks, `--` and share host | unit |
| cmd-2 | lib-authority's opener ("core decides", the local Windows form) and the `open-gate.ts` lift | unit |
| cmd-3 | lib-authority's label registrations | unit |
| cmd-4 | F-6102 (§1) with the shared notice and the terminal port | unit, acceptance-win |
| cmd-5 | F-6203 (§2) | unit, acceptance-win |
| cmd-6 | F-6204 (§3) | unit, acceptance-win |
| cmd-7 | F-6205's stable lines (§4) | unit, manifest, acceptance-win |
| cmd-8 | F-6206 (§5) | unit, acceptance-win, host: WSL 1 |
| cmd-9 | F-6207 and D12e (§6) | unit, acceptance-win |
| cmd-10 | F-6401: `wslCode.sh`, D8g, D11's writing side (§7) | unit, acceptance-win |
| cmd-11 | F-6402's rows (§8) | acceptance-win, host: genuine VS Code |
