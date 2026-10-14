# Task card containers-17: Open Folder in Container (Flow B) and the resolve-time trust request

Issue: #936. Milestone 0.4, containers release 1. Size: L. Builder: `task:claude` (daedalus).

**Builds after:**
- containers-12 (#882: `ensureTrusted`, `TrustPort`, S265);
- containers-13 (#883: `chooseConfiguration`);
- containers-22 (#921: the canonical mapping, which the trust request needs first);
- containers-24 (#929: `beforeReload`, S087 after 500 ms).

Sources:
- F-0403 (remote-oss/remote-containers#22): 3.1, 3.4 (S259), 4, 5.1, 6.1, 6.2, 6.6, 7.E1, 7.E3, 7.E5, AC-1, AC-12 to
  AC-14, AC-17, AC-20;
- F-0106 (remote-oss/remote-containers#46): 6.3, 6.4a, 6.12, BR-2, AC-41, AC-42, S360, S377;
- F-0501 7.E6 (the recent entry meets the same resolve-time check);
- windows contracts §3.2 (ea31011: the canonical mapping, and the race this card measures, athena on #921);
- the brief: F-0403's Flow B only; Flow A (the wizard), attach and the OS legs are later.

## 1. What release 1 builds

1. **The command `remote-containers.openFolder`** ("Dev Containers: Open Folder in Container...", S259 after the
   category). In order:
   1. C2's first check, before any dialog (7.E3);
   2. core's folder dialog;
   3. Flow B: `chooseConfiguration` through `beforeReload`;
   4. the reload of the same window.

   A folder with no configuration gets containers-13's interim notice, since Flow A is later. Re-picking the folder the
   container window shows does nothing (7.E1).
2. **The resolve-time trust request (C10).** Open Folder asks for trust after the window has switched (F-0106 6.3,
   BR-2), and so do a reload after "Don't Trust" (6.12) and a recent entry (F-0501 7.E6). So the check lives in the
   resolve, not in the command:
   - **Untrusted:** core's modal with S265.
   - **Declined:** S360/S377 with OK, then the folder reopens locally in the same window (6.4a).
   - **Trusted:** the connect goes on with no dialog.

## 2. The design

### 2.1 The manifest (`package.json`, `package.nls.json`)

- `contributes.commands` gains `{"command": "remote-containers.openFolder", "title":
  "%commands.Openfolder.title%", "category": "Dev Containers"}`, with the nls value `Open Folder in Container...`
  (S259).
- **The Command Palette's `when`, release 1's scope** (brief ruling 8: the manifest holds release 1's contributions
  only): `!hideConnectCommands && remoteName =~ /^(dev-container)?$/ && !remote-containers:standingDown`. The spec's
  clause also lists `attached-container`, `exec`, `k8s-container`, `apple-container`, `wsl`, `ssh-remote` and
  `tunnel` (6.5). Those window kinds aren't built in release 1, and each joins the clause with its own card.
- **`statusBar/remoteIndicator`:** `{"command": "remote-containers.openFolder", "group":
  "remote_30_dev-container_2_actions@8", "when": "!hideConnectCommands && workspaceFolderCount == 0 && !remoteName &&
  !virtualWorkspace && !remote-containers:standingDown"}`. That's the spec's clause plus the stand-down guard every
  command of ours carries.
- **Gate row 10's expected set** (#917, #918) gains the id. Update its expectation in the same PR.

### 2.2 The command (`src/open/open-folder.ts`, new)

```ts
export interface OpenFolderPorts {
  window: {
    remoteName(): string | undefined;
    /** The window's `vscode-remote` authority, when it has one. */
    remoteAuthority(): string | undefined;
    folders(): ReadonlyArray<{scheme: string; fsPath: string}>;
    homeFolder(): string;
  };
  engine: {firstCheck(base: string | undefined): Promise<FirstCheckResult>};
  /** Core's folder dialog: `window.showOpenDialog`, folders only, one, opened at `start`. */
  pickFolder(start: string): Promise<{scheme: string; fsPath: string} | undefined>;
  preReload: PreReloadPorts;          // containers-24, with its own `firstCheck` answering 'proceed'
  serializedFile(file: string): SerializedUri;
  currentContext(dockerFile: string): Promise<string | undefined>;
  settings: {dockerPath(): unknown};
  opener: OpenerHost;
  logger: Logger;
}

export function openFolderInContainer(ports: OpenFolderPorts): () => Promise<void>;
```

**In order, with a re-entry guard like Reopen's** (a second call while one runs logs `Open Folder in Container is
already running` and returns):
1. **The window's own folder** (`own`):
   - in a `dev-container` window, the payload's `hostPath`, decoded from `remoteAuthority()` with
     `devContainerTargetOf`. A legacy or volume payload has none (F-0403 6.2 step 1);
   - in a local window with one `file` folder, its `fsPath`;
   - otherwise none.
2. **The engine:** `await engine.firstCheck(own)`. `stopped` returns (7.E3, AC-20). C2 shows its own dialog.
3. **The dialog:** `pickFolder(own ?? homeFolder())`. `undefined` (Escape, 7.E5) logs at info `Open Folder in
   Container was cancelled` and returns. A result whose scheme isn't `file` logs at info `Open Folder in Container
   needs a local folder` and returns.
4. **7.E1:** in a `dev-container` window, a chosen `fsPath` equal to `own` logs at info `the folder is already open in
   this container` and returns. Nothing is shown (AC-13).
5. **Flow B:** `beforeReload(preReload, {folder: chosen, dockerPath, cancellation})`. Its `firstCheck` port answers
   `Promise.resolve('proceed')`, since step 2 ran it before the dialog, as F-0403 requires.
   - `chosen` goes on;
   - every other answer returns, after containers-24's logs and surfaces. A folder with no configuration is
     `noConfiguration`, which shows containers-13's notice: Flow A is later.
6. **The reload:** close the progress, then build the payload exactly as Reopen does (`devContainerPayloadOf({kind:
   'folder', hostPath: chosen, localDocker: false, context?, configFile: serializedFile(configFile)})`). Then
   `openRemote(opener, <authority>, {path: workspaceFolder, pathKind: 'folder', target: 'current'})`. A rejection logs
   at warn, as Reopen does.

   **No trust request here** (F-0106 6.3: the window switches first). Core's save prompt for an untitled workspace
   comes from the reload itself (6.7, core's).

**Reopen's payload code isn't copied** (dupes): move the payload-and-open steps of `reopen.ts` into one function,
`reloadIntoContainer(…)`, in `src/open/reload.ts`, which both commands call.

### 2.3 The resolve-time trust request (`connector.ts`)

`ContainerConnectorDependencies` gains:

```ts
trust: TrustPort;                              // containers-12, `served.trust`
trustNeeds: Omit<TrustNeeds, 'commandTitle'>;  // translate, logger, setupAgain
/** S360 with S377 as detail and one OK button, modal; resolves when it closes. */
showDeclined(message: string, detail: string): Promise<void>;
/** Opens `hostPath` as a local folder in this window (`vscode.openFolder`, `forceReuseWindow`). */
reopenLocally(hostPath: string): Promise<void>;
```

**In `connectFresh`**, after the folder is decoded and before `phases.tell({name: 'initializing'})`:
1. `await readWithinCap(payload, folder)` (containers-22). Core then has the canonical answer before trust is read,
   which is athena's ordering on #921.
2. `const trust = await ensureTrusted(dependencies.trust, {...dependencies.trustNeeds, commandTitle: 'the connect'})`.
3. **`trusted`:** go on, as today.
4. **`declined`:**
   - `await showDeclined(translate(S360), translate(S377))`;
   - then `await reopenLocally(folder.hostPath)`;
   - then return `trustDeclined()`, a new failure in `failures.ts`: kind `trustDeclined`, silent, not retryable. The
     window is already going local, and nothing else shows.
5. **`unavailable`:** `ensureTrusted` has shown the setup notice. `await reopenLocally(folder.hostPath)`, then return
   `trustDeclined()`.

**The strings** (`TRUST_TEMPLATES` of containers-12 gains them; this card owns them, as containers-12 §1 says):

| Id | English template |
|---|---|
| S360 | `The local folder is currently not trusted.` |
| S377 | `Trust is required to build a dev container from it. The folder will now reopen locally.` |

Add both to the l10n bundles, as containers-03 did.

**The adapters (`extension.ts`):**
- `showDeclined`: `window.showInformationMessage(message, {modal: true, detail}, {title: translate('OK')…})`. The one
  button must be "OK" and nothing else. Measure what core shows first (§6 open row 2) and use the form that gives one
  "OK".
- `reopenLocally`: `commands.executeCommand('vscode.openFolder', Uri.file(hostPath), {forceReuseWindow: true})`.

**What doesn't change:** containers-12's Reopen still asks before its reload (F-0106 6.1). Its new window then passes
step 2 with no dialog, because the folder is trusted and the canonical answer maps it. A second dialog there means
containers-22's mapping failed, and T1 of containers-22 catches it.

## 3. Files

| File | What |
|---|---|
| `package.json`, `package.nls*.json` | §2.1 |
| `src/open/open-folder.ts`, `src/open/reload.ts` (new); `src/open/reopen.ts` | §2.2 |
| `src/connect/connector.ts`, `src/connect/failures.ts`, `src/trust/trust-gate.ts`, `l10n/bundle.l10n*.json` | §2.3 |
| `src/extension.ts`, `src/activation.ts`'s handler table | the ports, the command's handler |
| `test/unit/open-folder.test.ts` (new), `reopen.test.ts`, `connector.test.ts`, `manifest.test.ts` | §4.1 |
| `tests/acceptance/windows/renderer.ts` | `answerFolderDialog(name, path)` (§4.2) |
| `tools/acceptance-launches.ts` | `CONTAINERS_LAUNCH.settings` gains `files.simpleDialog.enable: true`, so the dialog is the in-window one the renderer can drive (F-0403 3.2) |
| `tests/acceptance/containers/open-folder.test.ts` (new) | §4.2 |

## 4. Rows

### 4.1 Unit

| Name | Expected |
|---|---|
| `F-0403 7.E3: the engine check runs before the dialog, and a stop shows no dialog` | `firstCheck` called with `own`; on `stopped`, no `pickFolder` |
| `F-0403 5.0 step 2: the dialog opens at the window's folder, the container's host folder, or home` | a local folder window: its path; a dev-container window: the payload's `hostPath`; an empty window: `homeFolder()` |
| `F-0403 7.E5: a cancelled dialog does nothing` | no `beforeReload`, the info line |
| `F-0403 7.E1: re-picking the container's own folder does nothing` | no `beforeReload`, the info line |
| `F-0403 5.1: a configured folder reloads the window through the shared reload` | `openRemote` got the payload of the chosen folder and `target: 'current'`; `beforeReload`'s `firstCheck` answered `proceed` without a second engine query |
| `F-0403 5.1: no configuration shows containers-13's notice and reloads nothing` | `noConfiguration`: no `openRemote` |
| `F-0403 6.1: a dismissed picker reloads nothing` | `dismissed`: no `openRemote` |
| `F-0403: a second call while one runs does nothing` | one dialog; the "already running" line |
| `F-0403: a non-file pick does nothing` | the info line |
| `F-0106 6.3: the connect asks for trust after the canonical read, before the engine check` | the order of calls: the read, `isTrusted`/`request`, then `secondCheck` |
| `F-0106 6.2: a trusted folder connects with no dialog` | `isTrusted` true: no `request`, no `showDeclined` |
| `F-0106 6.4a, AC-42: a decline shows S360/S377, reopens locally, and ends silent` | `request` false: `showDeclined(S360, S377)`, then `reopenLocally('/work/proj')`, then a `trustDeclined` failure, silent; no `prepare` |
| `F-0106 BR-2: trust granted in the resolve goes on` | `request` true: `prepare` runs |
| `brief ruling 9: an unavailable trust request reopens locally without S360` | `request` rejects: `setupAgain` called, `reopenLocally` called, no `showDeclined` |
| `F-0403 3.1: the command is contributed with release 1's when, and the indicator item only in an empty local window` | `manifest.test.ts` |
| Reopen's existing rows | pass unchanged through `reloadIntoContainer` |

### 4.2 Acceptance (`tests/acceptance/containers/open-folder.test.ts`, the containers launch; the trust rows in containers-12's `containers-trust` launch)

**The renderer helper:** `answerFolderDialog(name, path)` sets the simple dialog's input (`.quick-input-widget
input`) to `path`, dispatches `input`, and presses Enter (F-0403 5.0 step 3: Enter equals "Open" with no item focused).

| # | Launch | Steps | Assertions |
|---|---|---|---|
| O0, first (athena's race, #921) | containers-trust | trust the folder `open-trusted` first (core's trust editor through `workspace.trust`, as containers-12's rows do), then from an empty window run Open Folder and pick it | **no modal dialog at any poll** (every 100 ms from the pick until connected: `dialogOf` is `undefined`), and the window connects. If a modal shows, stop and report on #936 (§6 open row 1) |
| O1 | containers | from an empty window, Open Folder, and pick `devContainerFolder('open-b', {name: 'Open B'})` | connected; title `[open-b [Dev Container: Open B]]`; no second container for the folder (AC-12) |
| O2 | containers | in O1's connected window, Open Folder, and pick the same folder | for 5 s, nothing: the title, the indicator and the notification centre are unchanged (AC-13) |
| O3 | containers | from an empty window, Open Folder, then Escape | the window is unchanged, and no container exists for the folder (AC-14) |
| O4 | containers | `dev.containers.dockerPath` set to a missing program, then Open Folder | S146's dialog shows, and no folder dialog (AC-20). Restore the setting |
| O5 | containers-trust | from an untrusted empty window, Open Folder, and pick an untrusted configured folder | the window switches first (indicator "Opening Remote..."), then core's trust dialog with S265's detail; `Trust Folder & Continue` connects (AC-17) |
| O6 | containers-trust | as O5, but answer `Cancel` | the modal S360 with detail S377 and one button `OK`; after `OK` the same window is the local folder in Restricted Mode, and no container exists for it (AC-17, F-0106 6.4a) |
| O7 | containers-trust | in a connected trusted window, `workbench.trust.manage`, click `Don't Trust` (containers-22's `clickButton`), then `Cancel` in the trust dialog | the S360/S377 modal; after `OK` the window is local in Restricted Mode, and the container still exists (F-0106 AC-41, AC-42) |

## 5. Catalogue

- `acceptance`: F-0403 AC-12, AC-13, AC-14, AC-17, AC-20; F-0106 AC-41, AC-42.
- `acceptance`, the release-1 half: F-0403 AC-1. The six other window kinds stay `todo` with their cards.
- `todo`, with the reason "Flow A, later (brief)": F-0403 AC-4 to AC-11 and AC-23. The rest are `todo`, each with its
  later feature: AC-18, AC-19, AC-22, AC-24 to AC-27 (other window kinds and OS legs). AC-2, AC-3, AC-15, AC-16 and
  AC-28 are core's dialog and prompts: `core`, with the reason "core's folder dialog / save prompt".

## 6. Gates, review and open rows

Run all gates, both launches (`docker ps` first), and the VSCodium run. The PR title is `remote-containers: Open
Folder in Container (Flow B), and the trust request in the resolve (card containers-17, #936)`. Request athena only;
hermes assigns the peer.

**Open rows (stop and report on #936):**
1. **O0 shows a modal for a trusted folder.** This is the race athena named: core's `updateWorkspaceTrust` after the
   canonical promise, against the request. Report the timing (the debug line of containers-22, the modal's first
   poll). Don't add a delay or a retry without a ruling.
2. **The decline modal shows more than one button** (core adds Cancel to a modal with items). Report what each form
   gives, and use the one that gives exactly `OK`.
3. **`vscode.openFolder` with `forceReuseWindow` from a resolving window** opens a new window, or doesn't open the
   folder. Report what happens.
4. **The folder dialog opens on the container's filesystem** in a dev-container window despite a `file:` start. Report
   it; F-0403 6.2 says the start is the local host path.
