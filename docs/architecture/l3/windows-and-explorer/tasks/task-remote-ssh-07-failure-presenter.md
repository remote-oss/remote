# Task card remote-ssh-07: Remote - SSH's failure presenter and progress titles (#140 part B)

Why: `registerResolver` (lib-authority, on main) needs from each extension a `FailurePresenter` and the progress
titles of `ResolverOptions` (`titleOf`, `startTitle`); `../contracts.md` §3.2 "Failure presenter" and "Phases". This
card builds Remote - SSH's, pure behind ports, from F-2601 (the connection-failure dialog) and F-2304 (the progress).
Part B of the #140 plan (issue comment 2026-10-12). Implementer: `iris` (judgement card). Reviewers: `themis`;
runtime review `daedalus`; design check `athena`.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | new: the English template of each string id below, and `textOf` over it (the pattern of `prompt-strings.ts`) |
| `packages/remote-ssh/src/surfaces/failure-presenter.ts` | new: `failurePresenterOf` |
| `packages/remote-ssh/src/surfaces/progress-titles.ts` | new: `startTitleOf`, `phaseTitleOf` |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | each new template as a key, its English text as the value in every file (the stand-down strings' pattern) |
| `packages/remote-ssh/test/unit/failure-presenter.test.ts`, `progress-titles.test.ts`, `failure-strings.test.ts` | new |
| `packages/remote-ssh/src/pipeline/connect.ts` and its test | one line: `failure({kind: 'licenceDeclined', reason: {id: 'S027'}})` (ruled 2026-10-12: the reason belongs to the failure, not the presenter) |
| `packages/remote-ssh/src/pipeline/failure.ts` | `FailureDetail.reason` takes lib-authority's `FailureReason` (`{id: string} \| {text: string}`, what `Failed.reason` takes) instead of lib-ssh's, whose `{id}` is the classifier's closed `DiagnosticStringId` without S027; the lib-ssh import of `FailureReason` goes (amended 2026-10-12 from iris's report; checked: typecheck and the 88 pipeline tests green) |

Nothing else. No `vscode` import in these modules: the editor is behind the ports of section 2. The activation wiring
is part E of #140, not this card. `feature/ssh-resolver-front` (#141's old branch) may be read as material; nothing is
copied from it without being checked against this card.

## 2. Contract

### Strings

| Id | English template | Spec |
|---|---|---|
| S129 | `Setting up SSH Host {0}` | F-2304 |
| S082 | `Initializing VS Code Server` | F-2304 |
| S041 | `Downloading VS Code Server` | F-2403 (via F-2304 §3.4) |
| S044 | `Downloading VS Code Server locally` | F-2405 |
| S029 | `Copying VS Code Server to host with scp` | F-2405 |
| S084 | `Installing VS Code Server` | F-2403 |
| S130 | `Setting up SSH tunnel` | F-2104 |
| S158 | `Waiting for port forwarding to be ready` | F-2104 |
| S030 | `Could not establish connection to "{0}"` | F-2601 |
| S031 | `Could not establish connection to "{0}": {1}` | F-2601 |
| S117 | `Retry` | F-2601 |
| S092 | `More Actions...` | F-2601 |
| S022 | `Close Remote` | F-2601 |
| S014 | `Can't assign requested address` | F-2603 (a reason of lib-ssh's classifier) |
| S032 | `Could not resolve hostname` | F-2603 (reason) |
| S079 | `Hostname contains invalid characters` | F-2105 (reason) |
| S094 | `Network is unreachable` | F-2603 (reason) |
| S097 | `No route to host` | F-2603 (reason) |
| S107 | `Port forwarding is disabled` | F-2305 (reason) |
| S111 | `Remote host key has changed, port forwarding is disabled` | F-2305 (reason) |
| S137 | `The connection timed out` | F-2104 (reason) |
| S140 | `The operation timed out` | F-2104 (reason) |
| S142 | `The process tried to write to a nonexistent pipe` | F-2603 (reason) |
| S027 | `Connecting was canceled` | F-2304 |
| S015 | `Cancel` | F-2601 |

The two F-3902 rule 8 dialogs use athena's ruled texts (contracts §3.2, 2026-10-09) as provisional keys, until
remote-oss/remote-ssh#87 (question 1) records them:
`{2} knows no download location for the server of {0}. Set {1} to a URL template for this editor's server builds.`
(`noServerSource`) and `The value of {1} is not a usable server download URL template: {3}.`
(`invalidServerTemplate`); their buttons are `Open Setting` and S015 `Cancel` (S015's template `Cancel`, as in
`prompt-strings.ts`). `licenceDeclined` shows F-2601's dialog with S027 as its reason (contracts §3.2, F-3902 rule
11): the pipeline sets that reason itself (`connect.ts`, amended in this card: the reason belongs to the failure, so the
presenter has no branch for this kind and any other reader of `Failed` sees it; athena 2026-10-12), and the presenter
applies the S031 rule as for every reason.

### Progress titles

```ts
export function startTitleOf(alias: string): StringRef;                  // S129 with [alias]
export function phaseTitleOf(phase: ConnectPhase): StringRef | undefined; // the phase message; undefined: keep the last one
```

`initializing` S082, `downloading` S041, `downloadingLocally` S044, `copyingWithScp` S029, `installing` S084,
`settingUpTunnel` S130, `waitingForForwarding` S158. `serverDownloadPercent` has no string id in F-2304 or F-2403:
`phaseTitleOf` returns `undefined` for it (the previous phase message stays), and the PR asks the spec on the
remote-ssh repo which text, if any, shows a percentage. Do not invent one.

### Presenter

```ts
export interface FailureDialogPort {
  /** Shows the modal error with the buttons in this order; resolves with the chosen button, or undefined for cancel. */
  showError(text: string, buttons: readonly string[]): PromiseLike<string | undefined>;
}
export interface FailureActions {
  reload(): PromiseLike<unknown>;       // Retry
  closeRemote(): PromiseLike<unknown>;  // Close Remote
  moreActions(failed: Failed): PromiseLike<unknown>;  // More Actions...: F-2602's picker, a later card; here a port
  openSetting(settingId: string): PromiseLike<unknown>;
}
export interface PresenterNames {
  /** The host alias of the window, as the user wrote it. */
  alias(): string;
  /** The client's application name (`env.appName`). */
  applicationName: string;
  /** The extension's display name. */
  displayName: string;
}
export function failurePresenterOf(
  dialog: FailureDialogPort,
  actions: FailureActions,
  translate: Translate,
  names: PresenterNames,
): FailurePresenter;
```

- `present(failed)` starts the dialog **without awaiting it** and returns `'handled'` at once (contracts §3.2: the
  buttons act later). A rejected dialog or action is swallowed (never an unhandled rejection) and leaves `'handled'`.
- The reason ids above are every id lib-ssh's classifier gives as a `reason` (checked in `classify.ts` and
  `rules.ts`, 2026-10-12). Its other ids (S005, S046, S116, S150) are hint and log texts for F-2605's view and the
  log, not this dialog. A `{id}` reason with no template in the table is a programming error: the presenter shows S030
  (no reason) and the test below pins it; it never shows a raw id.
- Text: no `reason` gives S030 with [alias] and a full stop appended; a reason gives S031 with [alias, reason text],
  where a `{id}` reason is translated through the table and a `{text}` reason is used as it is, and a full stop is
  appended unless the reason already ends with one (F-2601 §3.4 S030 and S031, and §6 "text").
- Buttons, in the order given to the port: S022 `Close Remote`, S117 `Retry`, S092 `More Actions...` (the cancel
  item; core reorders per platform). A choice of Close Remote calls `closeRemote`; Retry calls `reload`; More Actions...
  or a cancel (undefined) calls `moreActions(failed)`.
- `noServerSource` and `invalidServerTemplate` show their dialog instead (placeholders: {0} the client's application
  name, {1} `remote.SSH.serverDownloadUrlTemplate`, {2} the display name, {3} the reason text), buttons `Open Setting`
  (calls `openSetting('remote.SSH.serverDownloadUrlTemplate')`) and S015 `Cancel` (does nothing). {0} and {2} come
  from `names`.
- No "Diagnose with Copilot" button (F-2606; not built, R-28).

## 3. Test table

One assertion per `it`; the Cite starts the name. Fakes for the two ports record calls.

| Cite | Given | Expected |
|---|---|---|
| F-2304 S129 | `startTitleOf('box')` | `{id 'S129', values ['box']}` |
| F-2304 (each phase) | each of the seven phases above | its id, no values |
| F-2304 | `serverDownloadPercent` | `undefined` |
| F-2601 S030 | `present` of a failure without reason, alias `box` | the dialog text `Could not establish connection to "box".` (full stop appended) |
| F-2601 S031 | reason `{text 'Connection refused'}` | `Could not establish connection to "box": Connection refused.` |
| F-2601 S031 | reason `{text 'Host key changed.'}` | no second full stop |
| F-2601 S031 | reason `{id 'S027'}` | the reason is the translated S027 |
| F-2601 S031 | reason `{id 'S094'}`, alias `box` | `Could not establish connection to "box": Network is unreachable.` |
| F-2601 | reason `{id 'S999'}` (no template) | the S030 text, no raw id |
| F-3902 rule 11 | kind `licenceDeclined`, no reason, alias `box` | `Could not establish connection to "box": Connecting was canceled.` |
| F-2601 | any failure | buttons `['Close Remote', 'Retry', 'More Actions...']` |
| contracts §3.2 | a dialog that never resolves | `present` resolves `'handled'` |
| F-2601 | choice Retry / Close Remote / More Actions... / cancel | `reload` / `closeRemote` / `moreActions(failed)` / `moreActions(failed)` called once |
| contracts §3.2 | a dialog that rejects | no unhandled rejection; `'handled'` |
| F-3902 rule 8 | kind `noServerSource` | the provisional text with its four values; buttons `['Open Setting', 'Cancel']` |
| F-3902 rule 8 | kind `invalidServerTemplate`, choice Open Setting | `openSetting('remote.SSH.serverDownloadUrlTemplate')` |
| string tables | the new keys | `pnpm check-layout` green: every template in all 15 bundles |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet; ids and English templates exactly as section 2.

## 5. Gates and review

PR title `remote-ssh: failure presenter and progress titles (card remote-ssh-07, #140 part B)`; Part of #140.

## 6. Open rows

- The percentage phase (`serverDownloadPercent`): ask the spec, as section 2 says; until answered it shows no title.
- Any other phase or dialog text without an id: stop and report, do not invent.
