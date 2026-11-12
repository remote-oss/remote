# Brief: the remote-wsl package (F-6001 to F-6005, F-6602, F-7901, F-7903, F-7904)

Part of `brief-remote-wsl.md` (#2348), whose §2 rulings apply here. Owner components: `wsl.package` (area B), the new
`wsl.web-entry` and `wsl.log`.

## 1. Manifest, activation, stand-down and the proposal probe (F-6001, F-7901, F-7903)

### 1.1 The manifest

- **Identity (F-7901):** `remote-oss.remote-wsl`. Reference identifiers (`ms-vscode-remote.remote-wsl` above all) live
  only in `packages/remote-wsl/identifiers.json` and its generated table, never in shipped prose (ADR-0008,
  `public-surface-terms.ts`). The two invented identifiers are F-7901's: the context key `wsl.standingDown` and the
  runtime command `remote-wsl.connectToWSLDefault`.
- **Declarations (F-6001 20.1, AC-25, AC-35):** `enabledApiProposals` exactly `resolvers`, `contribViewsRemote`,
  `contribRemoteHelp`; `engines.vscode` `^1.125.0`; no `extensionPack`, no `extensionDependencies`, no `telemetry`.
- **Activation events (F-6001 3.3):** `onStartupFinished`, `onResolveRemoteAuthority:wsl`,
  `onCommand:remote-wsl.newWindow`, `onCommand:remote-wsl.newWindowForDistro`. `onStartupFinished` is also what lets
  F-6206's R3 evaluate in a local window on a share.
- **`when` clauses (F-6001 AC-43):** every static contribution with a clause carries the reference's whole condition in
  parentheses, then `&& !wsl.standingDown`. The palette entry of "WSL: Show Log" carries the bare `!wsl.standingDown`, and
  the indicator's reads `(remoteName == wsl) && !wsl.standingDown`. The reference's verbatim clauses come from the spec
  side's identity inventory (F-7901 C-1), as for remote-ssh; the manifest test compares against it.
- **Hidden commands:** `silent` (`reading-2348-r46-silent`). `remote-wsl.newWindow` and `newWindowForDistro` are
  registered and do nothing visible (F-7901 §2.1); they must not grow behaviour.
- **Settings read before trust:** a setting a repository can set may only switch between fixed flows or carry a bounded
  number (`remote.WSL.experimental.scriptLessStartup`, `remote.WSL.fileWatcher.*`). A setting that names a URL, path or
  command (`remote.WSL.serverDownloadUrlTemplate`) has `application` scope and is read from the `defaultProfileUser`
  layer only.

### 1.2 Activation order

At every activation, in this order, and never awaiting a `wsl.exe` process (core waits for the
`onResolveRemoteAuthority` activation before resolving):
1. **Stand-down (F-6001 20.3, AC-34, AC-39):** lib-standdown looks for `ms-vscode-remote.remote-wsl` among the enabled
   extensions. If it is enabled, the extension sets `wsl.standingDown`, registers no command, resolver, tree data
   provider or URI handler, writes no probe line and shows the one non-modal warning with the button "Show Other
   Extension", which opens the Extensions view on `@id:` and the identifier from `identifiers.json`.
2. **The browser entry stops here.** `wsl.web-entry` (new, area B) is the bundle `dist/web/extension.js` built from
   `src/web-extension.ts` with no `node:` import and no lib-wsl: it rejects with STR:S061 and its log line, and runs no
   probe (F-6001 AC-42; R-87; remote-explorer's `web-extension.ts` is the pattern).
3. **The probe (F-6001 20.4, F-7903 rule 4),** on every desktop platform, Linux arm64 and macOS arm64 included (AC-41).
4. **Registration** of only what the granted proposals allow: no resolver without `resolvers`.
5. **The presence check** for the extension-set keys runs management verbs only (`--status`, `--list`), never
   `-d <distro> --exec`, so activation starts no distro (F-6001 AC-30).

### 1.3 The probe and the setup notifications, `ruling-2348-views-probe`

- **Conflict:** lib-authority's `probeProposals` counts `contribViewsRemote` as granted whenever `resolvers` is, because
  in a connecting window the views register only after the resolve. F-6001 AC-38 requires a `product.json` grant of only
  `resolvers` to fail the views probe.
- **Ruling:** the probe gains an option `views: 'byCommand'` (default `'withList'`, so ssh and containers are
  unchanged). With it, `contribViewsRemote` is granted exactly when `targetsWsl.focus` is in the stable command list. In a
  window activated to resolve, that read waits until the first resolve has settled; elsewhere it runs at activation.
  `contribRemoteHelp` has no probe of its own and is named in the line exactly when `resolvers` is.
- **The line** (F-6002 BR-11, AC-31): `Missing proposed APIs: <names>` in English, names in the declared order separated
  by a comma and a space, written after the log exists and before anything is registered, only when a probe fails, and
  never while standing down.
- **The three notifications** (Setup, Restart, Failed attempt; F-6001 AC-44, AC-45, AC-47) and the two global-state
  flags (dismissal, attempt-pending; AC-40, AC-46) are the family's `familySetupPortsOf` with WSL's name and texts. The
  sibling list (F-7904 A-2) is the installed `remote-oss.` extensions that declare proposals and aren't in `argv.json`,
  this extension's id first. The extension never writes `argv.json` itself.

## 2. The log (F-6002): the new `wsl.log`

- **Component:** `wsl.log` owns the window's logger over lib-log, the "WSL" terminal and its lifecycle, the
  `remote.WSL.debug` snapshot, the daemon file and the reveal policy, and serves D6, D7 and `wsl.failure-ui` one narrow
  port (`logger`, `reveal`). The terminal is lib-log's terminal sink as amended (brief-remote-wsl §3), so
  ruling-2325 point 2 escapes its controls.
- **Lines and the terminal (BR-1, BR-3, AC-9, AC-10):** every line is kept from activation until the first terminal; a
  terminal closed by the user reopens empty. The terminal is created at the first failure or "WSL: Show Log". In a
  Restricted Mode window that raises core's terminal trust prompt, which F-6208 AC-21 observes, so it stays.
- **Colours (BR-5, AC-20, AC-28, AC-29):** a line's colour comes from its stream tag (`reading-2348-stream-tag`), never
  from its text (ADR-0010): `stderr` from the distro's launcher is the red class.
- **Debug (BR-7, BR-8, AC-15, AC-17):** `remote.WSL.debug` is read when the resolve starts and once more at the first
  configuration change during that start, so a value only in the distro's Remote settings applies once it arrives. With
  debug on, the daemon file is D5h's log: `wsl-daemon-<timestamp>.log` in the extension's log folder, created
  exclusively, with a numeric suffix when two starts share a second. The environment dump lists names only.
- **Secrets (BR-9, Q1 option (b)):** the connection token is registered with lib-log's redaction as soon as lib-server
  returns it; the terminal and the daemon file take the same redaction.
- **The remote-line log:** remote-ssh's `loggedChannel` and `masked` are lifted into lib-server, so WSL logs the server's
  lines with the same scrubbing.

## 3. Help, feedback and issues (F-6003)

- **`contributes.remoteHelp`** carries our four rows (R-31, R-98's shape, remote name `wsl`); F-6004 keeps the Get Started
  row. The feedback address has no manifest key (AC-8 allows none): it is a constant of the help module, pinned by a test.
- **The help module** is lifted from remote-ssh into lib-identifiers (`getStarted` as a URL or a walkthrough, `feedback`
  optional), and remote-ssh moves to it in the same card. Three packages would otherwise copy it.
- **Report Issue (16, AC-4):** core's issue reporter where the product has one. Where it has none (a product without
  `reportIssueUrl`), our issues page opens externally, `reading-2348-report-issue-fallback`.
- **Out of context:** the three commands always act, as on Linux in the reference (AC-18 allows it).

## 4. The walkthrough (F-6004)

- **Content:** the eight steps and their texts as the spec quotes them. The 13 pictures are our own, made from our
  extension's UI on the Windows runner with a neutral user and machine name; none comes from the reference.
- **Links:** only `command:` targets from a closed allowlist, tested; the three Markdown documents and the
  `docs/remote-wsl/` pages they and the nls links point to are ours.
- **`remote-wsl.getStarted`** opens our documentation page (AC-25; no new page, R-60). **`connectToWSLDefault`** connects
  the current window to the default distro (authority `wsl+`), as F-6202's connect does; it is provisional on F-6202.
- **Lint:** `tools/public-surface.ts` scans `resources/walkthrough/*.md` and matches `code.visualstudio.com` too;
  `.vscodeignore` keeps `resources/**`.

## 5. Identity, localization and the public voice (F-6005, F-7901, F-7904)

- **F-6005 is under revision.** Its stable lines are carded now; AC-5 to AC-7 wait on the revision. Until then:
  - translations are our own, never copied from the reference (`reading-2348-own-translations`, Q1 option (b)); real
    locales show English until they exist;
  - "no English bundle" (AC-6) is read as no `bundle.l10n.en.json`; the default `bundle.l10n.json` ships as the key
    source the tooling needs.
- **No telemetry (F-6005 AC-10, R-28):** the containers source scan and the manifest checks run over remote-wsl and
  lib-wsl.
- **README, `ruling-2348-readme-voice`.** F-7904 B-3 asks the README to say what Microsoft's extension does; ADR-0008
  forbids naming it in shipped text. The README says it neutrally ("another extension that provides the `wsl` authority"),
  and K-4 checks the neutral items. The runtime button of §1.2 may still use the identifier, which is data.
- **F-7904's other checks:** the pack membership row (K-2) belongs to remote-extensionpack; a `tools/` unit row checks
  each manifest's version against its channel (C-2); the extension never reads which channel it came from (C-4).

## 6. Core behaviour in a WSL window (F-6602): not a no-op

- **AC-18:** a `docs/remote-wsl/` page with the topics the spec lists, checked for headings and for no reference URL.
- **AC-19:** a negative manifest check against an allowlist generated from `identifiers.json`, so a later surface doesn't
  trip it.
- **AC-24 (the first terminal of an empty window):** measure first on the Windows launch whether core opens it. Build a
  once-per-window hook in `wsl.resolver-front` only if it doesn't; the hook passes no `isTrusted`.
- **AC-25:** no process of ours outlives Close Remote Connection by more than D5h's grace; the row lists processes on
  Windows and in the distro, not the distro's own idle state.
- **Core rows** (AC-1, 4, 6, 7, 8, 12, 13, 20, 23, 26) are witnessed by one shared WSL-window smoke run on the Windows
  launch; pure core rows get `core` lines.

## 7. The cut

| Card | Scope | Test kinds |
|---|---|---|
| pkg-1 | manifest, `identifiers.json`, activation skeleton (§1.1, §1.2 steps 1, 2, 4, 5), `wsl.web-entry`, R-46, the gating lint over key bindings, views and walkthroughs | manifest, unit, acceptance-linux |
| pkg-2 | the views probe option in lib-authority, WSL's probe, line and three notifications (§1.3) | unit, acceptance-linux, acceptance-win |
| pkg-3 | lib-log's terminal sink and file sink, lib-host's stream tag, `wsl.log` (§2), the lifted remote-line log | unit, acceptance-linux, acceptance-win |
| pkg-4 | help (§3), the help module lift | unit, manifest, acceptance-linux |
| pkg-5 | the walkthrough, its pictures and documents, `docs/remote-wsl/`, the lint (§4) | manifest, acceptance-linux, acceptance-win |
| pkg-6 | identity, README, the no-telemetry guard, F-7904's rows (§5); F-6005's stable lines | manifest, unit |
| pkg-7 | F-6602's rows (§6) | acceptance-win, manifest |
