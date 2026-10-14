# Task card tooling-33: a trust-enabled launch and core's trust dialog over CDP

Issue: #716. Release 0.2, harness gap H1 of the gate's class-"b" ACs. Size: M–L. Builder: assigned by hermes
(task:claude). **Depends on:** tooling-30 (merged: `windows/renderer.ts`, the debugging port). Closes #456 when step 1
confirms the cause.

## 1. Why

**The gap:** no launch of the VSCodium run can open a folder untrusted. athena's ruling on #406 (2026-10-12, recorded on
#299 by hermes) left F-2405 AC-9's untrusted half "not observed", and #456 asks why the launch is trusted. The same gap
holds every criterion that needs Restricted Mode or core's trust dialog (§6).

**Two sources of the flag:**
- `tools/acceptance-plain.ts` `editorArguments` ends every launch's arguments with `--disable-workspace-trust`. That
  includes the runner launches, through `launchArgs` in `tools/acceptance.ts`.
- `@vscode/test-electron` 3.1.0, which test-cli drives, puts `--disable-workspace-trust` in the fixed argument list of
  every `runTests` call (`out/runTest.js`, beside `--skip-welcome` and `--extensionTestsPath`), whatever `launchArgs`
  say.

So #406's probe, which dropped our flag from a runner launch, still ran with the runner's. Core then reports trust
disabled, and `isTrusted` is true ([oss] `src/vs/workbench/services/workspaces/common/workspaceTrust.ts`:
`isWorkspaceTrustEnabled()` is false when `environmentService.disableWorkspaceTrust`, and `calculateWorkspaceTrust()`
returns true when the feature is off).

**The way out:** a plain launch. It starts the editor itself (`plainEditorOf`), so only our arguments reach it.

## 2. Step 1: measure before building (stop and report on #716)

On a scratch branch, with no row written yet:
1. **The runner's flag.** During a runner launch (`local`), read the editor's main process's command line from
   `/proc/<pid>/cmdline`, matching the run's user-data folder as `acceptance-run.ts`'s `pkill` pattern does. Record
   whether `--disable-workspace-trust` is there, and where it sits relative to `--extensionTestsPath`.
2. **A plain launch with trust on.** Use the `trust` launch of §3 with `editorArguments` leaving the flag out. Then:
   - `openWindow('harness', 't0')`;
   - read the agent's `trusted` (§3.3);
   - list the open dialogs with `dialogOf` (§3.4).

   Record the following, then delete the probe:
   - `trusted`;
   - each dialog's message and its buttons' labels, exactly as `textContent` gives them;
   - the selectors that found them in the pinned build (`VSCODIUM_RELEASE`).
3. **The terminal-mode request.** In `trust-terminal`, `openWindow('harness', 't0t')`. Record:
   - which dialog appears, and its message and buttons;
   - whether it comes before the connect's progress ends.

**Stop and report on #716, and build nothing, if:**
- (a) the plain launch still comes up `trusted: true` for `t0` with no dialog. Report the editor's argv, the user
  settings file, and the values of `security.workspace.trust.enabled`, `security.workspace.trust.startupPrompt` and
  `security.workspace.trust.emptyWindow` as `inWindow`'s `workbench.action.openSettingsJson` shows them. Don't add a
  setting by guess;
- (b) no dialog appears for `t0` within 10 s. First send `Page.bringToFront` to its page over the same CDP socket,
  since core shows the startup prompt only when the window has focus ([oss]
  `src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts`, `showModalOnStart` behind
  `hostService.hasFocus`). If the dialog then appears, that call becomes part of `dialogOf`'s wait (§3.4). If it still
  doesn't, stop;
- (c) in `trust-terminal`, the connect ends with no dialog at all.

When step 1 passes, post the three records on #456 with the cause, and build §3.

## 3. Changes

### 3.1 `tools/acceptance-launches.ts`

- `PlainLaunch` gains `workspaceTrust?: boolean`: true starts the editor with workspace trust on. Absent is today's
  launch.
- **One shared constant.** A constant `RENDERER_LAUNCH = {debuggingPort: true, settings: {'window.title':
  '[${rootName}]'}}` holds what the renderer helpers need. `EXPLORER_LAUNCH` is rebuilt from it, unchanged in value.
  `pnpm dupes` must not see the title setting twice.
- **Two launches** after `explorer-no-proposals`, each `kind: 'plain'`, `workspaceTrust: true` and `RENDERER_LAUNCH`:

  | Label | Suite | Settings beyond `RENDERER_LAUNCH`'s |
  |---|---|---|
  | `trust` | `trust` | `security.workspace.trust.startupPrompt: 'once'` (§3.1a) |
  | `trust-terminal` | `trust-terminal` | `remote.SSH.useLocalServer: false`, `remote.SSH.remotePlatform: {harness: 'linux'}` |

  `trust-terminal`'s other alias for a platform question is `refused` (no platform set, and the host is never reached
  once trust is refused). The connect timeout stays at its default of 15 s, which F-2601's "about 17 s" and F-2304
  AC-23's "+ 2 s" assume.
- **§3.1a, the startup prompt** (step 1, measured on #716): core's `security.workspace.trust.startupPrompt` defaults
  to `never` in OSS ([oss] `src/vs/workbench/contrib/workspace/browser/workspace.contribution.ts`). With that value,
  an untrusted folder shows the Restricted Mode banner and no dialog. The dialog of F-2501 AC-22 and F-2001 AC-14 is core's
  own rendering under that setting. Our half is that the resolver doesn't grant trust. So the `trust` launch turns the
  prompt on with `once`, which changes nothing of ours. `trust-terminal` keeps core's defaults, so that the request
  dialog a feature raises is observed with no setting.
- **The folders:** each row opens a folder of its own name, so no trust decision carries over. Apart from §3.1a, the
  `security.workspace.*` settings stay at their defaults.

### 3.2 `tools/acceptance-plain.ts`

`editorArguments(runFolder, proposedApi, launch?)` leaves out `--disable-workspace-trust` when `launch?.kind === 'plain'
&& launch.workspaceTrust === true`. Every other launch keeps it. Its doc comment drops "no trust prompt" for these
launches. Runner launches can't drop the flag, since test-electron adds it (§1), and the README says so (§3.5).

### 3.3 The window agent (`tests/acceptance/window-agent/`)

- **`package.json`:** add `"capabilities": {"untrustedWorkspaces": {"supported": true}}`. Without it, core disables the
  agent in Restricted Mode, and no row could drive an untrusted window. With trust disabled, as in every other launch,
  the field changes nothing.
- **`src/extension.ts`:** the `state` event gains `trusted: vscode.workspace.isTrusted`.
- **`windows/harness.ts`:**
  - `AgentEvent` gains `trusted?: boolean`;
  - a new `isTrusted(name)` runs `windowState(name)` and returns the last `state` event's `trusted`.

  `windowState`'s own result is unchanged, since rows compare it whole (`two-windows.test.ts`).

### 3.4 `tests/acceptance/windows/renderer.ts`

- **`dialogOf(name)`:** the one open `.monaco-dialog-box` of the page, as `{message, details, buttons}`:
  - `message` is the text of `.dialog-message-text`;
  - `details` is the text of `.dialog-message-detail`;
  - `buttons` is the `textContent` of each `.dialog-buttons .monaco-button`, in DOM order.

  It returns `undefined` when none is open. Selectors from [oss] `src/vs/base/browser/ui/dialog/dialog.ts`. Write the
  ones step 1 measured into the PR.
- **`waitForDialog(name, milliseconds = 60_000)`:** polls `dialogOf` every 200 ms. With step 1 (b)'s finding, it first
  sends `Page.bringToFront`. It fails naming the window, and listing every page's open dialog message.
- **`answerDialog(name, label)`:** clicks the one button whose text is exactly `label`. It fails naming the labels it
  found, and returns once the click is dispatched.

Both trust dialogs are custom (DOM) dialogs whatever `window.dialogStyle` says, because core passes `custom` with them
([oss] `src/vs/workbench/electron-browser/parts/dialogs/dialog.contribution.ts`, the `prompt` branch). So the run
leaves `window.dialogStyle` alone.

**Which dialog is which** (core's texts, [oss] `workspace.contribution.ts`):

| Dialog | Message | Buttons |
|---|---|---|
| Startup prompt (opening an untrusted folder) | `Do you trust the authors of the files in this folder?` | `Yes, I trust the authors`, `No, I don't trust the authors` |
| Trust request (a feature asks, such as a terminal) | the same | `Manage`, `Cancel`, `Trust Folder & Continue` (DOM order, measured on #716) |

The rows quote the labels step 1 measured, which should be these.

### 3.5 Suites, README and tooling

- `tests/acceptance/trust/` and `tests/acceptance/trust-terminal/`: each with a `tsconfig.json` like `explorer/`'s.
  `tests/acceptance/tsconfig.json` and `knip.jsonc` list them, as the README's "To add a launch" says.
- **README:** a paragraph "Trust" under "Launches":
  - every runner launch runs with workspace trust off, because test-electron adds the flag;
  - the two `trust` launches are plain launches with trust on, and the window agent supports untrusted workspaces;
  - rows read and answer core's dialogs with `dialogOf`, `waitForDialog` and `answerDialog`;
  - each row opens a folder of its own, so no decision carries over.

  Add the two labels to the launch list.

## 4. Rows

**Tools rows** (unit, `tools/acceptance-plain.test.ts`, `tools/acceptance-launches.test.ts`):

| Cite | Given | Expected |
|---|---|---|
| tooling-33 | `editorArguments(run, true, <trust>)` and `plainEditorOf` for `trust-terminal` | no `--disable-workspace-trust`; `--remote-debugging-port=0` present |
| tooling-33 | `editorArguments` with no launch, with `windows`, and with `explorer` | `--disable-workspace-trust` present, as today |
| tooling-33 | `launchesOf(...)` | `trust` and `trust-terminal` follow `explorer-no-proposals`, and are the only launches with `workspaceTrust`; `explorer`'s settings are unchanged in value |

**Smoke rows** (`tests/acceptance/trust/trust.test.ts`, names starting `tooling-33:`):

| Given | Expected |
|---|---|
| `openWindow('harness', 's1')` | `isTrusted('s1')` is false; `waitForDialog('s1')` gives the startup prompt of §3.4 |
| `answerDialog('s1', 'Yes, I trust the authors')` | the dialog is gone, and `isTrusted('s1')` becomes true within 10 s |
| `openWindow('harness', 's2')`; `answerDialog('s2', "No, I don't trust the authors")` | `isTrusted('s2')` stays false; `dialogOf('s2')` is `undefined` |
| in `trust-terminal` (core's defaults), `openWindow('harness', 's3')` | `isTrusted('s3')` false, and no dialog until the connect asks for trust; then `waitForDialog('s3')` gives the trust request of §3.4 |
| `answerDialog('s2', 'No such button')` | fails, listing the dialog's labels (when one is open; else naming the window) |

**Criterion rows written in this PR** (`trust/trust.test.ts`):

| Cite | Given | Expected |
|---|---|---|
| F-2501 AC-22 | `openWindow('harness', 'r22')` | `windowState('r22').remoteAuthority` is `ssh-remote+harness`; `isTrusted('r22')` false; `waitForDialog('r22')` gives the startup prompt |
| F-2001 AC-14 | `openWindow('harness', 'r14')`, the dialog left open | the window reports `remoteName` `ssh-remote` while `dialogOf('r14')` is still the startup prompt (the connect didn't wait); no record line of `r14` other than `progress` lines (no prompt of ours) |
| F-2001 AC-28 | `r14` after it connected | `isTrusted('r14')` false |

Catalogue: those three go from `todo` to `acceptance` in `coverage-slice1.tsv`.

## 5. Gates and review

All gates: `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm dupes`, `pnpm dead`, `pnpm check-layout`,
`pnpm coverage` (the changed tools files at 100 %), and `xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`
with every launch green. Paste its summary and step 1's three records in the PR. PR title `tools, tests: a
trust-enabled launch and core's trust dialog over CDP (card tooling-33, #716)`. themis or triton reviews. athena gives
the design check, and the tag check of §4's three rows.

## 6. Rows unblocked, and where they're written

| AC | Needs | Written in |
|---|---|---|
| F-2501 AC-22; F-2001 AC-14, AC-28 | `trust` | this PR |
| F-2001 AC-1 (untrusted folder), AC-9, AC-10, AC-11; F-2102 AC-2 | `trust`, a local folder window (coverage-23's `openLocalFolder`, #602), and for AC-9 a reader of the Extensions view's rows | the follow-up |
| F-2001 AC-16 | `trust`, a connected window in Restricted Mode, the palette | the follow-up |
| F-2101 AC-29; F-2206 AC-38; F-2304 AC-23, AC-32; F-2306 AC-28 | `trust-terminal`; AC-38 uses alias `refused` | the follow-up |
| F-2201 AC-27 | `trust-terminal`, and coverage-20's `userSettings` and config file `cfg-d` (#592) | the follow-up |

**The follow-up:** a coverage card daedalus writes once this merges, one row per AC above, each using only §3's
helpers.

**Outside the slice-1 catalogue:**
- F-2405 AC-9's untrusted half becomes observable once `copyToHost` runs in a hidden S8 terminal (#299's blocker,
  athena's Q11). The follow-up adds it then.
- Until then, the 0.2 notes keep "untrusted half not observed".

## 7. Open rows (stop and report on #716)

1. Any of step 1's stops (§2).
2. An earlier launch's row changes when the agent declares untrusted-workspace support. Report the row.
3. `trust-terminal`'s request dialog has buttons other than §3.4's. Report them, and don't map labels.
