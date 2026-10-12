# Task card cli-05: the CLI path's acceptance rows, in VSCodium (#412)

Why: brief `brief-cli-path.md` §10 item 5. cli-04 (#457, PR #477) wires the CLI path into the connect; this card proves
it end to end in the editor, with the editor carrying `cliDownloadUrlTemplate`. Builder: daedalus. Reviewers: athena
(design), proteus (harness and CI).

**Depends on cli-04 (PR #477) and tooling-18's log switch merged.**

## 1. The constraint: where the CLI comes from

No VSCodium release ships the patched CLI yet (brief §11). The user's CLI archives live only in daedalus's room, and
the user has asked that nothing pins them until the patch is final. Brief §11's hosting decision is also still the
user's. So:
- **the rows run only when the run is given an archive** (`REMOTE_OSS_CLI_ARCHIVE`, a path to the `.tar.gz` holding
  the one CLI file), as `tests/acceptance/server/cli.test.ts` does today;
- **no CI job runs them** until the user rules on §11. No workflow change in this card;
- **no repository file names the archive's origin, its owner or its hash** (the wall rule).

When §11 is ruled (option (a) or (c)), a follow-up card adds the CI job and the pin.

## 2. The editor under test

The patched CLI expands its server template only for its own release (V7a), so the editor's commit must be the CLI's.
The archives are built from VSCodium `1.140.06729-insider` (`[cli]` at vscode 07f806f999). The run therefore uses that
release, not the VSCodium run's pinned `1.140.06829-insider`:

| Constant (`tools/acceptance.ts`) | Value |
|---|---|
| `VSCODIUM_CLI_RELEASE.tagName` | `1.140.06729-insider` |
| `.sha256['linux-x64']` | `f2a998631e4b43d8bf6efa635413c209cf542de79dbeca6a6f6d2d18b02d4678` |
| `.sha256['linux-arm64']` | `c9242ffab677688db436e0142469e2c5fca6e2e6503c54b9a601d8fb5f4234a7` |

These are VSCodium's own public release digests (GitHub's asset `digest` field, 2026-10-12), not the user's build.
`vscodiumExecutableOf` takes the release as a parameter instead of reading the one constant.

**The CLI source.** Before each launch, the run writes `cliDownloadUrlTemplate` into the unpacked editor's
`resources/app/product.json`. Its value is `http://127.0.0.1:<port>/<label path>/cli-${os}-${arch}.tar.gz`, served by a
loopback HTTP server the run starts (`node:http`, `127.0.0.1` only):
- `GET /cli/cli-alpine-<arch>.tar.gz` answers the archive;
- anything else answers 404.

The user settings for the CLI labels add `"remote.SSH.localServerDownload": "always"`, so the client downloads the
archive and copies it to the host, because the host can't reach the client's loopback. The CLI's own `serve` downloads
the server on the host from the patched build's template, which needs the host's network, as the real-server run does.

## 3. The labels

`pnpm test:acceptance:cli` (on Linux without a display, under `xvfb-run --auto-servernum`) packages the extensions,
then runs `tools/acceptance.ts --editor vscodium --cli`. Without `REMOTE_OSS_CLI_ARCHIVE` it prints one line,
`acceptance: the CLI run needs REMOTE_OSS_CLI_ARCHIVE; skipped`, and exits 0. Labels, in order, each a launch as the
VSCodium run's are:

| Label | Template path | Settings beyond the run's | Suite |
|---|---|---|---|
| `cli-remote` | `/cli/` | none | `suite-cli/` |
| `cli-reconnect` | `/cli/` | none | `suite-cli-reconnect/` |
| `cli-missing` | `/missing/` | none | `suite-cli-missing/` |
| `cli-off` | `/cli/` | `"remote.SSH.useExecServer": false` | `suite-cli-off/` |

Each window opens `vscode-remote://ssh-remote+harness/home/harness`. The host is the VSCodium run's: Alpine, so
`${os}` is `alpine`. One host serves all four labels in order, and it's cleaned once before `cli-remote`.

## 4. Seeing the log

The rows read the extension's log through `REMOTE_OSS_ACCEPTANCE_LOG`, the switch the harness README already promises.
Under `REMOTE_OSS_ACCEPTANCE`, the extension appends each line it logs, after the logger's secret masking, to the
file that variable names: one per launch, in the run's folder, set by the run beside the script and the record. A
helper `connectionLog()` in `tests/acceptance/suite/harness.ts` reads it. The switch itself is built by card
tooling-18 (D-85); this card depends on it.

**S045.** The scripted adapters (`scripted-adapters.ts`) record the download notification: `show` adds a record line
`{surface: 'downloadProgress', question: <title>, answer: 'shown', matched: true}`, the shape of tooling-18's progress
lines, and the editor's own notification is still shown.

## 5. The rows

One assertion per `it`; names start with the cite.

**suite-cli (first connect)**

| Cite | Expected |
|---|---|
| F-2103 5.0 step 5 | `vscode.env.remoteName` is `ssh-remote`, and the workspace folder is `/home/harness` |
| F-3902 rule 5 (i) | the host holds `~/.vscodium-server/codium-insiders-<commit>`, an executable file (the editor's `applicationName` and commit) |
| brief §3 | the server is under `~/.vscodium-server/cli/servers/Insiders-<commit>/server/` and its `node` runs |
| F-2103 5.0 step 6 | the record has one `downloadProgress` line, `Downloading VS Code Server...` |
| F-2103 5.0 step 5 | `ps -eo args` on the host shows `<CLI file> command-shell` |
| contracts S10 | the control token, read from the CLI process's `/proc/<pid>/environ` (`VSCODE_CLI_REQUIRE_TOKEN`), and the connection token, read from the running server's token file, appear in no `ps -eo args` line on the host and no line of the log. The row compares booleans only, so no output ever holds a token |
| #140 | a file written through the window is on the host |

**suite-cli-reconnect (second launch)**

| Cite | Expected |
|---|---|
| F-2103 BR-8 | the window is on `ssh-remote` |
| F-2103 BR-8 | the record has no `downloadProgress` line (nothing was downloaded) |
| F-2103 BR-8 | the server folder is the one `cli-remote` left, and its `node` process is the same pid |

**suite-cli-missing (a CLI source that answers 404)**

| Cite | Expected |
|---|---|
| brief §6, F-2103 BR-13 | the window is on `ssh-remote` (the direct install connected) |
| brief §6 | the log has one line starting `the CLI path failed (` and ending `; installing the server directly` |
| brief §6 | the host has a direct install under `~/.vscodium-server/bin/<commit>/` |

**suite-cli-off (`useExecServer: false`)**

| Cite | Expected |
|---|---|
| F-2103 BR-1 | the log has `the CLI path was not used` with the setting's reason, once |
| F-2103 BR-7 | the host holds both layouts side by side: `cli/servers/Insiders-<commit>/server/` from `cli-remote` and `bin/<commit>/` |
| F-2103 BR-7 | the window is on `ssh-remote` over the direct install's server |

**The VSCodium run (no CLI field), one row added to `suite-remote/`**

| Cite | Expected |
|---|---|
| F-2103 BR-13 | the log has `the CLI path was not used: the editor names no CLI source`, once |

## 6. Files

| File | Change |
|---|---|
| `tools/acceptance.ts`, `tools/acceptance.test.ts` | `VSCODIUM_CLI_RELEASE`, `--cli`, the archive server, the product field, the four labels; rows for each new pure part |
| `tests/acceptance/suite/harness.ts` | `connectionLog()` (tooling-18 builds the switch it reads) |
| `tests/acceptance/suite-cli*/` | the suites of section 5 |
| `tests/acceptance/suite-remote/remote-window.test.ts` | the BR-13 row |
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts` and its test | the `downloadProgress` record |
| `package.json` | `test:acceptance:cli` |
| `tests/acceptance/README.md` | a section "The CLI run" |

## 7. Gates and review

The repository's gates, with `tools/` at its ratchet. The CLI run's result (all rows, local, with the archive) goes in
the PR body, with the host's architecture. PR title `tests: the CLI path in VSCodium, opt-in on a CLI archive (card
cli-05, #412)`.

## 8. Open rows

- Brief §11 (the user's): where CI gets a CLI. Until then, nothing in CI.
- `remote-oss/remote-ssh#79` point 1: if the server source is passed at run time, a row checks that the CLI downloaded
  from the editor's resolved template. It's added with that change.
