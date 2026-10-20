# Task card tooling-51: a genuine VS Code launch, and F-3902's genuine-client rows (AC-8, 9, 12, 15, 17, 24, 25)

Issue: #1142. Release 0.2. Size: L. Builder: `task:claude`. Design: D-97 (athena's answer to proteus, 2026-10-20). Ops calls:
proteus, 2026-10-20 (github.com through the stand-in, a TLS attempt counted as the download, `localServerDownload`
off, the launch's shape). Spec: remote-oss/remote-ssh#79 (F-3902), rules 1, 8 and 11 and §5a. Read it with plain
`gh issue view 79 -R remote-oss/remote-ssh`; gh-lab only reads remote-oss/remote. Quoting it is fine (D-98).

The launch is `genuine`: VS Code at the ADR-0007 floor (`EDITOR_VERSION`, 1.139.1) runs our VSIX in place of VSCodium,
with the run's own stand-in download host. **Nothing reaches Microsoft or GitHub.** No request to
`update.code.visualstudio.com` gets through, no Microsoft server is downloaded, nothing clicks "Accept and Continue",
and every case sets `remote.SSH.localServerDownload: "off"`. Without that last setting, a failed host download falls
back to a local one on the runner, where github.com is the real GitHub.

## 1. What's on main (checked by daedalus, 2026-10-20)

- The VSCodium run's plain launches all start `HARNESS_VSCODIUM_EXECUTABLE` (`runPlain` in `tools/acceptance.ts`).
  The VS Code run (`--editor vscode`) has no launches, no download host and no window agent. `editorCli()` already
  downloads VS Code at `EDITOR_VERSION` (`downloadAndUnzipVSCode`, with one retry).
- With `REMOTE_OSS_ACCEPTANCE_SCRIPT` and `_RECORD` set, `adaptersFor` (`packages/remote-ssh/src/surfaces/scripted-adapters.ts`)
  replaces every dialog of ours with a scripted one. The record keeps a modal's message and detail, but not its kind
  or its items. AC-24 asks for the kind and the items, so the genuine launch runs with the **real** dialogs, read and
  answered through the renderer helpers (§2.3).
- **Product defect 1: the licence modal isn't §5a's yet.** `packages/remote-ssh/src/surfaces/licence-modal.ts` still
  has its provisional texts ("{0} needs you to accept the license terms…" / "Read the terms at {0}."). It passes two
  items, "Accept and Continue" and its own "Cancel", and `licenceDialogOf` (`surfaces/editor-adapters.ts`) shows them
  as a modal *warning*. Rule 11 and §5a want a modal *information* message: message `serverLicenseMessage`, detail
  `serverLicenseDetail` ({0} our display name, {1} the licence URL in full), and one item of ours,
  `acceptAndContinue`. "Cancel" is core's close item. §3 fixes this.
- **Product defect 2: the no-source dialog names the wrong {0}.** `registerConnectOf` (`src/extension.ts`) fills
  the presenter's `applicationName` from `vscode.env.appName`, which is the product's long name ("Visual Studio
  Code"). Rule 8 and §5a want the client's `applicationName` from `product.json` (`code`). §3 fixes this.
- The rule 8 dialog's buttons are already right on screen: "Open Setting" plus a "Cancel" that is the close item.
  `classifyLicence` (`packages/lib-product/src/licence.ts`) already treats a setting URL on genuine VS Code as
  licensed unless it starts with an MIT prefix, matched exactly (`https://github.com/VSCodium/vscodium/releases/`).

## 2. Harness

### 2.1 The launch: `client` and `namedOnly` (`tools/acceptance-launches.ts`, `tools/acceptance.ts`)

- `PlainLaunch` gains `client?: 'vscode'`: "The editor the launch starts: VS Code at the floor of ADR-0007 instead
  of the run's VSCodium." Only a plain launch has it.
- `LaunchCommon` gains `namedOnly?: true`: "Whether the run makes the launch only when `--launches` names it." In
  `chosenLaunches`, `selected === undefined` (no flag, or `--launches all`) drops `namedOnly` launches. A named
  label keeps them. The unknown-label message still lists them as known.
- Add the launch **last** in `launchesOf`:
  `{...RENDERER_LAUNCH, label: 'genuine', suite: 'genuine', client: 'vscode', namedOnly: true, settings: {...RENDERER_LAUNCH.settings, 'window.dialogStyle': 'custom', 'remote.SSH.localServerDownload': 'off'}, environment: {REMOTE_OSS_ACCEPTANCE_SCRIPT: ''}}`.
  The empty script variable makes `adaptersFor` return the real dialogs. It works because `runPlainLaunch` spreads
  `launch.environment` after the launch's files, and a unit row proves it. Last place matters: VS Code 1.139.1
  then never opens a user-data folder before a VSCodium launch has written to it, and the routing of §2.4 has no
  launch after it.
- `extensionsFolderOf` gives a `client: 'vscode'` launch its own folder, `<run>/extensions-<label>`, as
  `withExtensions` does.
- `installsOf` entries gain `client: 'vscodium' | 'vscode'`. The genuine folder gets the run's VSIX files (remote-ssh,
  remote-ssh-edit and the window agent) and is installed with **VS Code's** CLI
  (`resolveCliPathFromVSCodeExecutablePath`). `prepare` builds the installs only for the `client: 'vscode'`
  launches the run actually makes, so `prepare` takes `chosen` as a new parameter. A run without `genuine` never
  downloads VS Code.
- `HarnessDependencies` gains `vscodeExecutable(): Promise<string>`: the `downloadAndUnzipVSCode(EDITOR_VERSION)`
  that `editorCli()` already does, with its retry. Have `editorCli()` call it so the download isn't written twice.
  `HarnessVariables` gains `HARNESS_VSCODE_EXECUTABLE?`, set only when a chosen launch has `client: 'vscode'`.
- `runPlain` starts `HARNESS_VSCODE_EXECUTABLE` for a `client: 'vscode'` launch and `HARNESS_VSCODIUM_EXECUTABLE`
  otherwise. `runPlainLaunch` adds `HARNESS_EDITOR_EXECUTABLE` (the executable it started) to the launch's
  environment.
- Leave `--editor vscode` as it is. The CI job (proteus's) runs
  `node tools/acceptance.ts --editor vscodium --launches genuine` on X64.

Unit rows (in `tools/acceptance-launches.test.ts`, `tools/acceptance.test.ts` and `tools/acceptance-plain.test.ts`, next to
their neighbours):
- `chosenLaunches`: no selection leaves `genuine` out; `['genuine']` gives it alone; `['genuine', 'remote']` gives both, in
  table order.
- `genuine` is the table's last launch.
- `extensionsFolderOf`: the genuine launch gets `extensions-genuine`.
- `installsOf`: genuine's folder has the run's VSIX and `client: 'vscode'`; with `genuine` not chosen there is no such entry.
- `runAcceptance` with `genuine` chosen calls `vscodeExecutable` once, and without it never.
- `plainEditorOf` / `runPlainLaunch`: the genuine launch's program is the VS Code executable; its environment has
  `REMOTE_OSS_ACCEPTANCE_SCRIPT` `''` and `HARNESS_EDITOR_EXECUTABLE` set.

### 2.2 The download host's TLS log (`tools/acceptance-downloads.ts`)

The HTTPS server logs every TLS handshake's SNI name in a log of its own, `<run>/downloads-tls.log`, through
`SNICallback` (log `<ISO time> <servername or ->`, then answer with the one context it has today). The request log
and its parsers (`requestsOfLaunch`, `requestsLogged`) don't change. `downloadVariables` gains
`HARNESS_DOWNLOADS_TLS_LOG`. The certificate and its trust stay as they are, so download-untrusted (F-2403 AC-26)
is untouched.
Unit row in `tools/acceptance-downloads.test.ts`: a TLS connect to the HTTPS port with servername `github.com` logs one line
ending in `github.com`, and the request log is unchanged by a handshake that fails.

### 2.3 Helpers (`tests/acceptance/windows/`)

- `harness.ts` `editorProduct()` reads `product.json` beside `HARNESS_EDITOR_EXECUTABLE` (same layout:
  `resources/app/product.json`), and its type gains `serverLicenseUrl: string` and `nameLong: string`. Callers stay
  as they are, since every plain launch now has the variable.
- `renderer.ts` `dialogKindOf(name): Promise<'info' | 'warning' | 'error' | undefined>`, read from the open custom
  dialog's icon (`codicon-info`, `codicon-warning` or `codicon-error` on the dialog's icon element). Undefined when
  no dialog is open. Measure the element and class on 1.139.1 and VSCodium. `ShownDialog` stays as it is.
- `renderer.ts` `settingsEditorOf(name): Promise<{tab: string; search: string} | undefined>`: the open Settings
  editor's selected tab label (User / Workspace / Remote) and the text of its search box. Undefined when no Settings
  editor is the active editor. Measure the selectors (the tabs widget's checked action item, the search widget's
  `.view-lines`) on both editors, and use them in a comment-free expression like `DIALOG_EXPRESSION`.
- The genuine suite's own helpers live in `tests/acceptance/genuine/genuine.ts`:
  - `freshHost()`: close every window but the local one, then `rm -rf /home/harness/.vscode-server /home/harness/genuine-*`.
  - `tlsNamesSince(mark)` / `requestsSince(mark)`: the lines of the two logs after a count.
  - `homeNames()`: `ls -A /home/harness`.

### 2.4 github.com through the stand-in, for AC-15 only

In the AC-15 row's `before`, as root (`onHostAs('root', 'sh', '-c', …)`):
- Append `<gateway> github.com` to `/etc/hosts`, where `<gateway>` is
  `getent hosts update.code.visualstudio.com | cut -d' ' -f1` (already host-gateway).
- Add `iptables -t nat -A OUTPUT -p tcp -d <gateway> --dport 443 -j DNAT --to-destination <gateway>:<httpsPort>`,
  where `<httpsPort>` is the port of `HARNESS_DOWNLOADS_HTTPS`.

Its `after` removes both. Delete the rule with `-D` and the same arguments. `/etc/hosts` is bind-mounted, so
rewrite it in place rather than using `sed -i`: `grep -v ' github.com$' /etc/hosts > /tmp/hosts && cat /tmp/hosts > /etc/hosts`.
The container's removal at the end of the run is the backstop, and `genuine` being last means no launch runs
after it. The case's URL has **no port**, so it matches the MIT prefix character for character.

## 3. Product fixes (remote-ssh)

1. **Licence modal per §5a.** In `licence-modal.ts`, `LICENCE_TEMPLATES` becomes the §5a keys:
   `serverLicenseMessage` "Accept the server's licence terms?";
   `serverLicenseDetail` "The server {0} installs or starts on this host is distributed under licence terms of its
   own, which {0} does not accept for you. Read them at {1} before you continue. \"Accept and Continue\" accepts
   them for this profile; the choice is remembered for this profile.";
   `acceptAndContinue` "Accept and Continue".
   {0} is `names.displayName` and {1} the terms URL. `askUser` passes one item, `[accept]`. `LicenceNames` drops
   `applicationName` (nothing else uses it). The port's comment changes to "A modal information message with the
   detail and the extension's one item; resolves with the item, or nothing for core's Cancel, Escape or X."
   In `editor-adapters.ts`, `licenceDialogOf` calls `showInformationMessage(message, {modal: true, detail},
   ...buttons.map(title => ({title})))`, with no close affordance, so core adds its Cancel. In `scripted-adapters.ts`,
   `decline` gives `undefined` (recorded `decline`, as now). The l10n bundles: drop the three old keys and add the
   three new ones to `l10n/bundle.l10n.json` and every locale bundle, with the English text as value (as the
   bundles do now); `pnpm check-string-tables` passes. Unit rows: `licence-modal.test.ts` (texts, the one item,
   accept / undefined / abort), `editor-adapters.test.ts` (information, modal, detail, no close affordance),
   `scripted-adapters.test.ts` (decline gives undefined), `strings.test.ts` as it needs. The Dev Containers modal
   (`packages/remote-containers/src/surfaces/licence-modal.ts`) is F-1402's and stays out of this card.
2. **{0} of rule 8 is `applicationName`.** In `registerConnectOf`, `names.applicationName` becomes
   `(await editorProfile()).applicationName`. That is already async, and `editorProfile()` reads `product.json`. A unit
   row: the presenter's no-source text with names `{applicationName: 'code', displayName: 'Remote - SSH'}`
   is exactly §5a's `noServerSource`. If the extension's wiring test file pins `appName`, update it there too.

## 4. Rows: `tests/acceptance/genuine/server-source.test.ts`

Every row starts from `freshHost()` and notes the two logs' line counts. The window is
`openWindow('harness', 'genuine-<n>')`. "No other dialog or notification" means `dialogOf(name)` is undefined and
`notifications(name)` is `[]` once the row's dialogs are answered. The no-source message expected below is §5a's
`noServerSource` with {0} `code`, {1} `remote.SSH.serverDownloadUrlTemplate` and {2} remote-ssh's `displayName`
(read from `packages/remote-ssh/package.json`).

- **`F-3902 AC-8, AC-25 (genuine-no-source)`**: the setting unset. `waitForDialog` gives `{message: <noServerSource text>,
  details: '', buttons: ['Open Setting', 'Cancel']}` and `dialogKindOf` gives `'error'`; and the message contains neither "VSCodium" nor
  `editorProduct().nameLong`. Before answering: no new request and no new TLS line, and `homeNames()` equals its
  value before the connect, with no `.vscode-server`. Then Cancel.
- **`F-3902 AC-9 (genuine-open-setting)`**: as AC-8, then "Open Setting". `settingsEditorOf` gives `{tab: 'User',
  search: 'remote.SSH.serverDownloadUrlTemplate'}`, the remote indicator (`statusItem(name, 'status.host').text`)
  contains "Disconnected from SSH", and there's no other dialog or notification.
- **`F-3902 AC-9 (genuine-cancel)`**: as AC-8, then "Cancel". The dialog closes, the same indicator and nothing else
  shows, and there's no Settings editor.
- **`F-3902 AC-17 (genuine-workspace-only)`**: on the host, `/home/harness/genuine-ws/.vscode/settings.json` holds
  `{"remote.SSH.serverDownloadUrlTemplate": "<HARNESS_DOWNLOADS_HTTP>/ok/${os}-${arch}/${commit}"}` (the variable's
  value written in, the product's placeholders kept). The user settings hold no value. Open `genuine-ws`. Expect
  AC-8's dialog, exactly, with no request and no licence modal.
- **`F-3902 AC-12, AC-24 (genuine-licence-cancel)`**: user setting
  `remote.SSH.serverDownloadUrlTemplate` = `${HARNESS_DOWNLOADS_HTTP}/ok/${os}-${arch}/${commit}` (through
  `userSettings`, restored in `finally`). The first dialog has message "Accept the server's licence terms?" and
  buttons `['Accept and Continue', 'Cancel']`, and `dialogKindOf` gives `'info'`. Its `dialogDetailLines` joined with a space are
  `serverLicenseDetail` with {0} the display name and {1} `editorProduct().serverLicenseUrl`. **At that moment** there
  are no new requests (AC-12's "before any request"). Answer "Cancel". The next dialog is F-2601's failure dialog,
  whose message is `Could not establish connection to "harness": Connecting was canceled.`. Answer it with Escape
  and dismiss the pick that follows with Escape. Still no new request, and `homeNames()` is unchanged. Then
  `reloadWindow(name)`: the licence dialog shows again (same message). Cancel it as before.
- **`F-3902 AC-15 (genuine-mit-release)`**: §2.4's routing in place. User setting `remote.SSH.serverDownloadUrlTemplate` =
  `https://github.com/VSCodium/vscodium/releases/download/${version}/vscodium-reh-${os}-${arch}-${version}.tar.gz`.
  The first dialog is F-2601's failure dialog with the download-failed reason, the one `download-unreachable`
  expects (F-2403). It is not the licence dialog: with the real dialogs, a licence modal would block until answered.
  After the mark, the TLS log has at least one `github.com` line. No request reaches `update.code.visualstudio.com`.

If a row shows the product doing something else than the spec says, beyond §3's two fixes, mark it open and tell
me, with the measured outcome. Don't bend the row.

## 5. Coverage and tags

- `docs/architecture/catalogue/coverage-slice1.tsv`:
  F-3902's lines for AC-8, 9, 12, 15, 17, 24 and 25 go from `todo` to `acceptance`.
- `node tools/check-coverage.ts` passes. The criteria tags get the acceptance tag, as the tag tool derives it.
- `tests/acceptance/README.md`: a short "Genuine VS Code launch" section covering what `client` and `namedOnly` do,
  the real dialogs, the TLS log, the routing of AC-15 and how it's undone, and the command line.

## 6. Done when

- `node tools/acceptance.ts --editor vscodium --launches genuine` passes locally on x86_64, on a run that reaches
  neither Microsoft nor GitHub. Show the TLS log and the request log of that run in the PR.
- `node tools/acceptance.ts --editor vscodium --launches install-licence-update-service,install-template-placeholder`
  still passes (the scripted modal's `decline`, and AC-5's dialog).
- `pnpm test`, the whole diff linted, `jscpd` and `knip` clean, and `check-coverage` and `check-string-tables` passing.
- Proteus adds the CI job (dispatch input `genuine`, daily schedule, tags, X64, never on PRs) once this PR is up.
  The PR doesn't touch `.github/workflows`.

Open cards that touch the same files: tooling-38 (#798, launches declared in their suite folders) and tooling-44
(#804, scripted adapters per surface). Whichever lands second carries the other's shape over.
