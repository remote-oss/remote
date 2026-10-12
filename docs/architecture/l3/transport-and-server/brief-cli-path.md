# Brief: Remote - SSH's CLI path (exec server bootstrap)

Owner: athena (architect). Issue: #412. Decisions: D-76 (the user, 2026-10-08: once the editor names a CLI source,
Remote-SSH uses the CLI by default, as the reference does; direct install stays the fallback forever), D-84 (the user,
2026-10-12: part F starts on the server path; the CLI path is wanted too). Not a 0.2 release blocker: 0.2 ships the
direct-install path (D-76's fallback).

## 1. Where the specs and the design stand

- **The specs forbid it as written.** F-3902 rule 5 (`remote-oss/remote-ssh#79`): a templated server source is
  installed as one archive per host, and "a conformant Remote-SSH never downloads or starts the editor's CLI".
  F-2103 BR-13 (`#21`, "proposed"): a server resolved from a download template (a Code-OSS derivative) is always
  installed directly and `remote.SSH.useExecServer` has no effect, with one log line per connect; with genuine
  VS Code both modes behave as F-2103 specifies. Constraint 43 says the same for templated sources. Every source we
  resolve today is templated, so in practice the CLI is never used. D-76 revises them "on pull". So **step 0 is a spec revision request to metis**
  (section 9), and no code that takes the CLI path merges before metis has revised rule 5 and BR-13.
- **ADR-0006 decision 3 withdrew `cliDownloadUrlTemplate`** (2026-10-06); its "Facts from the VSCodium CLI patch"
  section keeps what the patch does. `binding-rulings.md` (R-47's CLI table) and `dossier.md` still describe a CLI table
  and are stale; this brief replaces both (section 8).
- **What exists:** lib-server's `decideCliPath`, `cliArchiveTemplateVariables` and `parseCliServeError` (card ssh-08),
  pure and unused. The plan notes `useExecServer` as ignored (contracts V3).

## 2. When the CLI path is taken

The plan decides once per connect, in this order (it extends `decideCliPath`'s card ssh-08 table; the first two rows
are today's reuse, unchanged):

| Order | Condition | Path | Log (F-2003) |
|---|---|---|---|
| 1 | a server for the client's commit is installed, in `bin/<commit>/` or `cli/servers/<Quality>-<commit>/server/` (F-3902 rule 10, `bin/` first) | reuse, started directly with its own launcher | none |
| 2 | `remote.SSH.useExecServer` falsy (F-2103 BR-1, BR-2), or `localServerDownload` is `manual-bootstrap` (BR-3, with S088) | direct install | none |
| 3 | the running editor's product names no `cliDownloadUrlTemplate` | direct install | the CLI path was not used: the editor names no CLI source |
| 4 | the host platform has no CLI build (riscv64, loong64; section 3) | direct install | …: no CLI build for `<os>-<arch>` |
| 5 | the CLI source or the server source is not classified `free` by V6 (section 5) | direct install | …: the server's terms must be accepted first |
| 6 | otherwise | **CLI**, downloading the CLI unless `<data>/<applicationName>-<commit>` is on the host | none |

Rows 3–5 log once per connect, the reason named (BR-13 as revised). A CLI attempt that fails **before the server is
running** in one of the ways of section 6's fallback table falls back to direct install **once in that connect**, logged.
Nothing persists between connects: the next connect decides again (BR-5: no live switch, a change applies at the next
resolve).

## 3. The CLI source (ADR-0006 decision 3, revised)

- **One source: the product field `cliDownloadUrlTemplate`**, the same placeholders as `serverDownloadUrlTemplate`
  (`cliArchiveTemplateVariables`), read from the running editor's `product.json` through lib-product. **No CLI table,
  no CLI dialog, and no setting:** the specs define no CLI URL setting, and inventing one is a feature beyond the specs
  (R-60). An editor without the field takes row 3.
- **The server source the CLI downloads** is the one V3 already resolves: override, then the product template, then
  the table (R-47 rule 4). The CLI gets it as `VSCODE_CLI_SERVER_DOWNLOAD_URL_TEMPLATE`, pre-expanded except `${os}` and
  `${arch}`, together with `VSCODE_CLI_COMMIT` and `VSCODE_CLI_QUALITY` (ADR-0006's patch facts). So a user's override
  reaches the CLI too, and the CLI never falls back to a feed.
- **Platforms:** the CLI exists for every server platform except riscv64 and loong64 (`[cli]` build targets, ADR-0006's
  patch facts). That list is a lib-server constant, not product data. A platform the list allows but the source doesn't
  serve (a 404 at the CLI download) is a fallback row of section 6.
- **Names come from the profile** (ADR-0006 decision 5): the CLI is placed at `~/<serverDataFolderName>/<applicationName>-<commit>`
  (the reference's `code-<commit>` for genuine VS Code), its data folder is `~/<serverDataFolderName>/cli`, and the
  server lands in `cli/servers/<Quality>-<commit>/server/`. No product name is written in code (ADR-0006's check).

## 4. Plan, transfer and start

- **V3 `plan`** gains a third kind, `{kind: 'cli', cliAddress, download, where, clientFallback}`, beside `reuse` and
  `download`. `useExecServerIgnored` becomes the reason-carrying note of rows 3–5. `remote-ssh`'s server steps pass the
  `cli/servers` layout to reuse (today only `bin` is wired; F-3902 rule 10 needs both whatever the path).
- **Transfer of the CLI** reuses V4's machinery for an archive of one file: host-first with the client fallback of
  `localServerDownload` (F-3902 rule 6), the client copy through the window's `scp`, which runs in the hidden copy
  terminal (card ssh-29), unpacked by the host's `tar`, made executable. The CLI archive is cached like a server archive
  (ADR-0006 decision 4: keyed by product and commit). Its phases are today's: S041 while the host downloads the CLI
  (S044 and S029 on the client fallback), then S084 while it is unpacked, then S130 (F-2103 5.0 steps 3–4).
- **V7 `start` gains `startCli`**: it starts the CLI under `/bin/sh` (F-2103 §6.7: bash isn't needed), with
  `--cli-data-dir`, the server template variables, and the connection token file, inside the host lock loop (V5) as
  `startOrReuse` is. It returns the same `StartedServer` shape: `endpoint` is the CLI's own listening port on
  127.0.0.1 (the window's tunnel W2 targets it, as F-2103 5.0 step 5 says), `connectionToken` the CLI's token,
  `processId` the CLI's, `reused` false. **The CLI's exact command line, its ready line and its reply format are not in
  the spec.** They come from the `[cli]` crate (R-76), measured against a real CLI build, and card cli-01 (section 10)
  writes them down with `[cli]` citations before any wiring is carded.
- **After the window resolves,** the CLI downloads, verifies and starts the server itself (F-2103 5.0 steps 5–8). That
  is a **second notification**, "Downloading VS Code Server..." (STR:S045), indeterminate and then with a
  percentage, staying at 100% while the server is unpacked and started, then closing (5.0 steps 6–8). It is not a
  stage of the connect's progress, which has already ended. Its errors arrive in the CLI's reply and are read by
  `parseCliServeError`; their classes are section 6's.
- **Reuse (F-2103 BR-8, BR-9):** one CLI process per SSH connection, each finding the running server. A reload in a
  window that keeps its connection keeps its CLI. The server outlives the CLI (BR-10).

## 5. Licence (R-68, V6)

The CLI never installs a server whose terms need the user's acceptance. Row 5 sends any source that V6 doesn't classify
`free` to the direct-install path, where V6's modal runs before the download as today. So the CLI path needs no modal,
no acceptance flag and no `--accept-server-license-terms`. The CLI archive itself is the editor's own MIT build. Its
source is classified like a server source, and a non-free CLI source also takes row 5.

## 6. Failures and the fallback

| What failed | When | Outcome |
|---|---|---|
| CLI download: not found (404), or no build for the platform | before the CLI runs | fall back to direct install once in this connect, logged |
| CLI download: any other HTTP error or a network failure | before the CLI runs | fall back once, logged; if direct install fails as well, its own failure is shown |
| the CLI doesn't start, or prints no ready line within V7's ready bound | before the server runs | fall back once, logged; the CLI process is ended |
| the CLI's server download or start fails (`parseCliServeError`: `download`, `template`, `commitMismatch`, `other`) | after the window resolved | **no** fallback (the window is already connected to the CLI): F-2601's dialog, as F-2103 7.E-rows and S043/S075 classify; the whole message to the log |
| missing runtime libraries (F-2103 7.E2) | the server's start | F-2601's dialog after the R-79 bound, never a hang |

The fallback never hides a fault silently. It is logged with the cause, and it happens at most once per connect.

## 7. Two installs side by side (F-2103 BR-6, BR-7)

The modes keep separate installs (`bin/` and `cli/servers/`), and neither removes the other's. "Kill VS Code Server"
and "Uninstall" (F-2411) cover both layouts and the CLI files (`<applicationName>-<commit>`, `.cli.<commit>.log`). A
mode switch makes a new connection (BR-6). Nothing in the window shows the mode (BR-11).

## 8. Document revisions (when metis has revised the spec)

- **ADR-0006 decision 3:** `cliDownloadUrlTemplate` returns as the product field of section 3, with no table, dialog or
  setting. The patch facts section becomes its basis.
- **ADR-0005 decision 2a:** its "then" clauses are done by this brief, and a status line points here.
- **Contracts:** V3 (the `cli` plan kind and the reasoned note), V4 (the CLI archive), V7 (`startCli`). R1: the CLI
  path's phases and its S045 notification, and the fallback. W2 needs no change: the tunnel targets a port.
- **Stale text:** `binding-rulings.md` R-47's CLI table and `dossier.md`'s "decision 3 defines" are corrected. Constraint
  43 follows the revised rule 5.

## 9. Step 0: the spec

A request to metis on `remote-oss/remote-ssh#79` (F-3902 rule 5) and `#21` (F-2103 BR-13), filed with this brief: revise
both for D-76. When the editor names a CLI source and the host has a build, `useExecServer` applies and exec mode is
the default, as in the reference; direct install remains the fallback (section 2's rows). The request asks metis to
keep F-2103's observable rows (§5, §6, BR-1 to BR-12) as the CLI path's acceptance criteria.

## 10. Cards (daedalus)

1. **cli-01, a measurement and no product code:** the CLI's command line, ready line, token, reply and error format,
   and the progress lines, from the `[cli]` crate, measured against a real CLI build on the harness host. The result is
   a contracts amendment to V7, for my check.
2. **cli-02 (lib-product, lib-server):** `cliDownloadUrlTemplate` in the profile; `plan`'s `cli` kind and section 2's
   rows; the reasoned note; the platform constant. Pure, over today's fakes.
3. **cli-03 (lib-server):** the CLI archive transfer and cache, and `startCli` over the host channel.
4. **cli-04 (remote-ssh):** the server steps wired to the CLI path, the S045 notification, `parseCliServeError` into
   F-2601's classes, and the once-per-connect fallback.
5. **cli-05 (acceptance):** part F's CLI rows, in VSCodium, the editor carrying `cliDownloadUrlTemplate`:
   - the first connect over the CLI, with the host layout of section 3;
   - a reconnect that reuses the running server;
   - `useExecServer: false` → a direct install, with the two installs side by side (BR-7);
   - a CLI source that answers 404 → the logged fallback;
   - the BR-13 log line for an editor without the field.
   They follow part F's harness rulings (#253: the remote window for success, a local window for failures).

Cards 2 to 5 wait for step 0 and for cli-01's amendment. Card 1 can start at once.

## 11. Where the harness gets a CLI (the user's decision)

No upstream VSCodium release ships the patched CLI yet, and the harness's pinned VSCodium Insiders names no
`cliDownloadUrlTemplate`. The options:

| Option | What it takes | Note |
|---|---|---|
| (a) **A sha256-pinned copy of the user's CLI archives, hosted under `remote-oss`**, fetched by CI with its own token | the user's consent; the alpine-x64 (CI runners) and alpine-arm64 (local hosts) archives, pinned to their sidecar sha256 values; the harness adds the field to the test editor's `product.json` copy, pointing at that copy | **recommended as the interim.** It names no patch repository and no person (the wall rule), and nothing becomes public if the hosting repository is private |
| (b) our own build of the patch | the patch source in a repository we build from, a Rust and musl cross toolchain, a long CI job | not worth it: it duplicates the user's work and puts the patch's provenance in our files |
| (c) upstream VSCodium ships the patch | nothing in the harness but a reviewed bump of the pinned tag | **the target.** The test editor's own `product.json` then names the source, and (a) is retired |

Until the user decides, cli-01 measures against the binaries in daedalus's room, by hand, and nothing in CI depends on
them.
