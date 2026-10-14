# Task card containers-12: C5, trust before the open commands run anything

Issue: #882. Remote - Containers release 1, increment 1b (milestone 0.4). Gate row 11 (`brief-release-1.md` §5).
Size: M (about 1.5 agent-days). Builder: `task:claude`.

**Depends on:**
- containers-01 (#759, merged): the activation, `ServedWindow`, `extension.ts`, the string tables;
- containers-07 (#766): `reopen.ts`, `reopen-ports.ts`, and Reopen's manifest entries. **Build on containers-07
  merged.** This card replaces its interim trust rule (containers-07 §4.2 step 3 and §5);
- for the acceptance rows (§6.2) only: containers-08 (#776, the connector) and containers-09 part 2 (#775, the
  helpers `reopenInContainer`, `devContainersOf`, the test folder of its §4.1 and `HARNESS_RUN_ID`). If they aren't on
  main when the unit part is done, open the PR with §6.1 and §5, and add §6.2 in a second PR on #882.

**Design:**
- brief-release-1 §2 ("One more is in": F-0106 for the open commands only) and ruling 9;
- components C5;
- containers contracts §4 (`TrustPort`);
- containers-01 §3.3: `workspaceTrust` can't be probed, so a missing grant only shows when the request fails.

**Spec (remote-oss/remote-containers):**
- F-0106: 5.0, 6.1, 6.1a, 6.2, 6.4, BR-1 to BR-3, BR-8 to BR-10, STR:S265;
- F-0401: PRE-7, 6.7, AC-21.

**API:** `[oss]` `src/vscode-dts/vscode.proposed.workspaceTrust.d.ts`:
`workspace.requestWorkspaceTrust(options?: {message?: string}): Thenable<boolean | undefined>`.
- In `[oss]` `src/vs/workbench/services/workspaces/common/workspaceTrust.ts`, `calculateWorkspaceTrust` gives `true`
  when `security.workspace.trust.enabled` is `false`, so `workspace.isTrusted` (stable API) is then `true`.
- `[oss]` `src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts`, the request handler: "Manage" and
  "Cancel" resolve the request with `undefined`, and "Trust Folder & Continue" with `true`. So a request never stays
  open after the dialog closes.

## 1. What this card builds, and what it leaves

**Builds:**
- `TrustPort` and its editor adapter (contracts §4);
- `ensureTrusted`, the one function every open command calls before it runs anything;
- its use in Reopen in Container, replacing containers-07's silent refusal. Reopen is listed again in Restricted Mode,
  as F-0401 PRE-7 says;
- S265, the message core shows in its trust dialog;
- gate row 11 (and a second row for F-0106 BR-8).

**Leaves:**
- **The rebuild commands (containers-14, #884):** they call `ensureTrusted` as written here (§3.4), first thing, as
  Reopen does (F-0106 6.1a, BR-2). Their rows (F-0106 AC-32, AC-33) are containers-14's.
- **Open Folder in Container (Flow B, a later card):** F-0106 BR-2 orders its trust request after the window has
  switched (6.3), and its decline shows S360 and S377 (6.4a). That card places the call and owns those two strings.
  `ensureTrusted`'s contract is the same for it.
- **Out of release 1:** the attach, clone and volume confirmations (S042, S075, S251, S252, BR-4), the multi-root
  wording (6.10, core's) and the revocation inside a connected window (6.12).

## 2. Files

All under `packages/remote-containers/`:

| File | What |
|---|---|
| `src/trust/trust-gate.ts` | new: `TrustPort`, `TrustOutcome`, `TrustNeeds`, `TRUST_TEMPLATES`, `ensureTrusted` (§3) |
| `vscode-dts/vscode.proposed.workspaceTrust.d.ts` | new: `[oss]` `src/vscode-dts/vscode.proposed.workspaceTrust.d.ts` verbatim, with its MIT header, from the tag of the pinned editor build, as lib-authority's `vscode-dts/` files are |
| `tsconfig.json` | `include` gains `"${configDir}/vscode-dts"`, as lib-authority's |
| `src/activation.ts` | `ContainersActivationInputs` gains `trust: TrustPort`; `ServedWindow` gains `readonly trust: TrustPort`, passed through unchanged (§3.3) |
| `src/extension.ts` | the adapter (§3.2) |
| `src/open/reopen-ports.ts`, `src/open/reopen.ts` | §4 |
| `package.json` | Reopen's two `menus` entries (containers-07 §5) lose `isWorkspaceTrusted` in their `when` (§4) |
| `l10n/bundle.l10n.json` and every `l10n/bundle.l10n.<locale>.json` | the key S265 (§3.1). Each locale bundle gets the English text, as containers-03's engine strings did |
| `test/unit/trust-gate.test.ts`, `reopen.test.ts`, `activation.test.ts`, the manifest test | §6.1 |

## 3. The design

### 3.1 `src/trust/trust-gate.ts`

```ts
/** What C5 reads and asks of the editor (containers contracts §4). */
export interface TrustPort {
  /** `workspace.isTrusted`: true also when the editor's workspace trust is turned off. */
  isTrusted(): boolean;
  /**
   * Core's modal trust request with `message` as its body; true only when the user trusted the folder. It rejects when
   * the editor refuses the `workspaceTrust` proposal.
   */
  request(message: string): Promise<boolean>;
}

/** How a trust check ended: go on, or stop with nothing run. */
export type TrustOutcome = 'trusted' | 'declined' | 'unavailable';

/** What `ensureTrusted` needs besides the port. */
export interface TrustNeeds {
  translate: Translate;            // from `../surfaces/engine-dialogs.ts`
  logger: Logger;                  // the window's log (`ServedWindow.logger`)
  /** Runs the proposed-API setup again, which shows its setup notice (`ServedWindow.setupAgain`). */
  setupAgain(): Promise<unknown>;
  /** The command's title as the log names it, for example `Reopen in Container`. */
  commandTitle: string;
}

/** The English template of the body the extension gives core's trust dialog, by its string id. */
export const TRUST_TEMPLATES = {
  S265: 'Opening a folder in a Dev Container may execute arbitrary code both inside and outside the container.',
} as const;

/**
 * Asks core to trust the window's folder when it isn't trusted yet (F-0106 BR-2), with S265 as the body. A command
 * goes on only on `trusted`, and does nothing else otherwise: the declined window is left as it was (6.4).
 */
export async function ensureTrusted(port: TrustPort, needs: TrustNeeds): Promise<TrustOutcome>
```

**`ensureTrusted`, in order:**
1. If `port.isTrusted()` is true, return `'trusted'` at once. It shows nothing and logs nothing. This covers F-0106 6.2
   (trusted earlier) and BR-10 (trust turned off, which core reports as trusted).
2. Otherwise call `port.request(needs.translate(TRUST_TEMPLATES.S265))`:
   - It resolves `true`: log at info `the folder is trusted now; <commandTitle> goes on` and return `'trusted'`.
   - It resolves `false` ("Cancel", Escape or "Manage"): log at info
     `the folder isn't trusted; <commandTitle> does nothing`, and return `'declined'`. Nothing is shown: 6.4 step 3,
     "no notification".
   - It rejects: log at warn `the trust request failed: <the error's message>`, then `await needs.setupAgain()`, and
     return `'unavailable'`. That's brief ruling 9: a missing `workspaceTrust` holds back the trust prompt, and the
     command answers with the gate's setup notice.
3. It never throws. A rejection of `setupAgain` is logged at warn `the proposed-API setup failed: <message>`, and the
   result is still `'unavailable'`.

### 3.2 The adapter (`src/extension.ts`, which is coverage-excluded)

```ts
trust: {
  isTrusted: () => vscode.workspace.isTrusted,
  request: async message => (await vscode.workspace.requestWorkspaceTrust({message})) === true,
},
```

Reading `requestWorkspaceTrust` without the grant throws inside the `async` function, so `request` rejects (§3.1 step
2).

### 3.3 The activation

`activateContainers` passes `inputs.trust` into `ServedWindow.trust` and does nothing else with it. Activation never
calls the port: F-0106 BR-1, opening a folder never triggers this feature (an `activation.test.ts` row, §6.1).

### 3.4 For containers-14 (the rebuild commands)

The rebuild commands call, first thing after their context check and before anything else (F-0106 6.1a, BR-2):

```ts
const trusted = await ensureTrusted(served.trust, {
  translate,
  logger: served.logger,
  setupAgain: served.setupAgain,
  commandTitle: '<the command's title>',
});
if (trusted !== 'trusted') {
  return;
}
```

## 4. Reopen in Container (replaces containers-07's interim rule)

- **`ReopenPorts`:** `window.isTrusted` is removed. The ports gain `ensureTrusted(): Promise<TrustOutcome>`, which the
  `handlers` factory in `extension.ts` binds:
  `() => ensureTrusted(served.trust, {translate, logger: served.logger, setupAgain: served.setupAgain, commandTitle:
  'Reopen in Container'})`.
- **containers-07 §4.2 step 3 becomes:** `if (await ports.ensureTrusted() !== 'trusted') return;`.
  - It stays after the re-entry and context checks (steps 1 and 2) and **before** the engine check (step 4). That
    order is F-0106's: 5.0 step 2 puts the dialog "immediately, … before any reload and before any
    configuration-selection UI", and BR-8 shows it even with no engine at all, with the engine's error coming only
    after the user accepts.
  - The re-entry flag of step 1 is held while the dialog is open, so a second invocation then returns at once.
  - Core resolves every closed dialog (see **API** above), so the flag always clears.
- **The `when` clauses** of Reopen's `commandPalette` and `statusBar/remoteIndicator` entries (containers-07 §5) lose
  `isWorkspaceTrusted`. They become
  `!hideConnectCommands && workspaceFolderCount != 0 && !remoteName && !virtualWorkspace && !remote-containers:standingDown`.
  So the command is listed in Restricted Mode (F-0401 PRE-7, AC-21).

## 5. The launch for gate row 11 (`tools/acceptance-launches.ts`)

One launch after `containers-no-proposals`:

```ts
{
  ...CONTAINERS_LAUNCH,
  label: 'containers-trust',
  suite: 'containers-trust',
  workspaceTrust: true,
  settings: {
    ...CONTAINERS_LAUNCH.settings,
    // A folder opens untrusted and silent, so the only trust dialog is the one Reopen asks for.
    'security.workspace.trust.startupPrompt': 'never',
  },
},
```

- **The suite:** `tests/acceptance/containers-trust/`, with a `tsconfig.json` like `containers/`'s. It's registered
  where the other containers suites are: the root `tsconfig.json`'s `references`, `eslint.config.ts`'s
  `TYPESCRIPT_PROJECTS`, `knip.jsonc`'s `containers-trust/*.test.ts`, and the README's launch list.
- **`tools/acceptance-launches.test.ts`:** the D-85 labels row gains `containers-trust` after
  `containers-no-proposals`, and its name says "the four containers launches".

## 6. Rows

### 6.1 Unit rows

**`trust-gate.test.ts`** (over a fake port that records each call):

| Cite | Given | Expected |
|---|---|---|
| F-0106 6.2, AC-5 | `isTrusted` true | `'trusted'`; no `request`; no log line; no `setupAgain` |
| F-0106 BR-2, STR:S265 | untrusted; `request` resolves true | `'trusted'`; one `request`, whose message is S265's text passed through `translate` (a fake that tags it, for example `«…»`); the info line |
| F-0106 6.4, AC-7 | untrusted; `request` resolves false | `'declined'`; the info line naming the command title; no `setupAgain` |
| brief ruling 9 | untrusted; `request` rejects `Error('proposal')` | `'unavailable'`; the warn line with `proposal`; `setupAgain` called once, after the request |
| brief ruling 9 | the same, and `setupAgain` rejects | `'unavailable'`; both warn lines; nothing thrown |

**`reopen.test.ts`** (containers-07's rows, changed):

| Cite | Given | Expected |
|---|---|---|
| F-0106 BR-2, BR-8, AC-27 (our half) | untrusted; `ensureTrusted` resolves `'trusted'` | `ensureTrusted` is called before `firstCheck`, and the rest of the flow is containers-07's first row |
| F-0106 6.4, AC-7, F-0401 AC-21 | `ensureTrusted` resolves `'declined'`, and in a second case `'unavailable'` | no `firstCheck`, no candidate lookup, no `readConfiguration`, nothing opened |
| F-0106 AC-1 (our half) | a folder with no configuration, and `ensureTrusted` resolving `'declined'` | `ensureTrusted` is the first port called after the context check, before the candidate lookup |
| F-0401 BR-7a | a second call while `ensureTrusted` hasn't resolved | the second calls nothing; after the first resolves `'declined'`, a third call asks again |
| (removed) | containers-07's `F-0401 PRE-7 (interim)` row | replaced by the rows above |

**`activation.test.ts`:**
- `F-0106 BR-1: activation never asks for trust`: over a fake `trust` port, a serving activation makes no call to it.
- `ServedWindow.trust` is the port it was given.

**The manifest test:** containers-07's `F-0401 BR-2, AC-5` row expects the `when` of §4, with no
`isWorkspaceTrusted`.

### 6.2 Acceptance rows (`tests/acceptance/containers-trust/gate.test.ts`, launch `containers-trust`)

**The folders.** Each row writes its own folder, as containers-09 §4.1 does (its folder helper, if part 2 put one in
`windows/harness.ts`):
- **Row 11:** folder `gate-trust`, with `"name": "Gate Trust"` and
  `"initializeCommand": "touch <run>/gate-trust-initialized"`. F-0415's host-side hook, which the CLI runs on the
  host during `up`, proves when anything runs on the host.
- **Row 11b:** folder `gate-trust-noengine`, the plain §4.1 configuration.

**The docker recorder.** Row 11 writes `<run>/docker-recorder`, mode `0755`:

```sh
#!/bin/sh
printf '%s\n' "$*" >>"<run>/gate-trust-docker-calls"
exec docker "$@"
```

and sets `dev.containers.dockerPath` to it, with `acceptance.agent.updateSetting`, then reads it back, as row 8 does.
Every engine call of C2, and every call the CLI makes through `--docker-path`, appends a line. **"Nothing ran on the
host"** means:
- `<run>/gate-trust-docker-calls` doesn't exist;
- `<run>/gate-trust-initialized` doesn't exist;
- `devContainersOf(<the folder>)` is `[]`.

**The dialog text.** tooling-33's `dialogOf` reads `.dialog-message-detail`. Core gives this dialog its body as
`custom.markdownDetails` (see **API** above), so measure where S265 lands in the pinned build:
- If `dialogOf(...).details` holds it, use `details`.
- Otherwise, add `dialogText(name): Promise<string | undefined>` to `windows/renderer.ts`, the whole `textContent`
  of the open `.monaco-dialog-box` (reusing `DIALOG_BOX`), and assert that it contains S265.

Write which one into the PR.

| # | Steps | Assertions |
|---|---|---|
| 11 | Open window `gate-trust` (as containers-09 §4.1). `isTrusted('gate-trust')` must be false; otherwise stop, because the launch isn't untrusted (§8 row 1). Note its `activated` count. **Decline:** start `const declined = inWindow('gate-trust', 'remote-containers.reopenInContainer')` without awaiting it; `const shown = await waitForDialog('gate-trust')`. While it's open, check "nothing ran". `answerDialog('gate-trust', 'Cancel')`; `await declined`. Do the decline a second time. **Accept:** `const reopened = reopenInContainer('gate-trust')`; `waitForDialog`; check "nothing ran" again; `answerDialog('gate-trust', 'Trust Folder & Continue')`; `await reopened` | **The dialog** (each time): `shown.message` is `Do you trust the authors of the files in this folder?` (core's, F-0106 5.0 step 2), its text contains S265 exactly, and `shown.buttons` are `Manage`, `Cancel` and `Trust Folder & Continue` in the DOM order you measure (the spec observes that order on Linux; write it into the PR).<br>**While the dialog is open:** nothing ran on the host; `windowState('gate-trust').remoteName` is `null`.<br>**After each Cancel**, after 2 s: `dialogOf('gate-trust')` is `undefined`; `isTrusted` is still false; `remoteName` is `null`; the `activated` count is unchanged; nothing ran on the host; `notifications('gate-trust')` is `[]`.<br>**After the accept:** `remoteName` is `dev-container`; `<run>/gate-trust-initialized` exists; `gate-trust-docker-calls` exists and isn't empty; `devContainersOf(<the folder>)` has exactly one id. Then set `dockerPath` back (`undefined`) and close the window |
| 11b | Set `dev.containers.dockerPath` to `<run>/no-such-docker`, as row 8 does. Open window `gate-trust-noengine`; it must be untrusted. Start Reopen (not awaited); `waitForDialog`; `answerDialog(…, 'Trust Folder & Continue')`; then `waitForDialog` again | The first dialog is the trust dialog of row 11, so trust comes before the engine check. The second is F-0201's pre-flight dialog (`Docker version 17.12.0 or later required.`, as in row 8). Answer it `Cancel`. Then `isTrusted('gate-trust-noengine')` is true (the trust stays, F-0106 AC-27 and AC-20), `remoteName` is `null`, and no container exists for the folder. Set `dockerPath` back and close the window |

**If a row fails because the product does something else, don't change the row; report it on #882.** They're release
gate rows.

## 7. Catalogue (`docs/architecture/catalogue/coverage-containers-r1.tsv`)

| AC | Tag | Why |
|---|---|---|
| F-0106 AC-3, AC-7, AC-4 | `acceptance` | row 11: the same dialog with a configuration, the decline leaving everything as it was, and the accept going straight to the connect with no pick |
| F-0106 AC-27 | `acceptance` | row 11b, the Reopen half. The attach and clone halves are later, so name them in the PR as halves |
| F-0401 AC-21 | `acceptance` | row 11 |
| F-0106 AC-1, AC-5 | `unit` | the trust-gate rows, and Reopen calling the gate before the lookup. The add-configuration flow that follows is increment 2 |
| F-0106 AC-8 | `unit` | the activation row: opening a folder never asks |
| F-0106 AC-20 | `core` | `core: the folder's trust decision persists; the extension never writes trust` |
| F-0106 AC-2 | `deferred` | `containers release 1: increment 2 (authoring)`. After trust, a folder with no configuration goes to the add-configuration flow |

These stay `todo`, for their cards:
- AC-6, AC-6a, AC-6b, AC-7a, AC-28 and AC-30: Open Folder in Container. AC-30 also needs Open Folder's half;
- AC-32 and AC-33: containers-14;
- AC-39: the connected window's trust, which isn't in this card.

## 8. Open rows (stop and report on #882)

1. A folder of the `containers-trust` launch opens trusted. Report the launch's arguments; `--disable-workspace-trust`
   must be absent.
2. `requestWorkspaceTrust` resolves `undefined` or `false` for "Trust Folder & Continue" in the pinned build, or core
   leaves the request open after "Manage". Report it with the build's commit, and don't add a timeout.
3. The pinned build shows a startup trust prompt despite `startupPrompt: 'never'`. Report what it shows.

## 9. Gates and review

- **Gates:** all of them: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers,
  check-string-tables, check-coverage (`trust-gate.ts` at 100 %), check-licences, check-consumed and coverage. The
  VSCodium run must be green for the four containers launches.
- **PR title:** `remote-containers: C5 asks for trust before the open commands run anything (card containers-12, #882)`.
- **Review:** request athena only; hermes assigns the peer.
