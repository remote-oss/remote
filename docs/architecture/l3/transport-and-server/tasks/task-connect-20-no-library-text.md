# Task card connect-20: no library text in the failure dialog

Why: athena's finding while checking connect-18, ruled in contracts R1 (fb7516b), the same class as #253 Q10's
`ofAcquire` fix. remote-ssh's `pipeline/failure.ts` turns library failures into dialog reasons with `{text: …}`, so the
user sees library-internal English (`no end in time`, `the session ended`, `ssh ended by a signal …`) or a raw
identifier in F-2601's dialog (R-29). **Ruled:** no library detail is a dialog reason. It goes to the connect log
(F-2003). A reason is an id: `serverDownload` carries **S043**, `serverInstall` carries **S075**, and a kind with no
placement in the spec has **no reason** (S030). ssh's own lines still come through `classify` (ssh's words, which
F-2601 shows). Needed before F-2403 is recorded (a D-65 row). Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/pipeline/failure.ts` | every mapper of section 2.1; `detailOf` goes |
| `packages/remote-ssh/src/pipeline/server-steps.ts` | `sourceOf` passes the template problem whole (section 2.3); the install folder's reason (section 2.4) |
| `packages/remote-ssh/src/pipeline/connection-step.ts` | a `channelFor` that throws gives no reason (section 2.4) |
| `packages/remote-ssh/src/pipeline/host-settings.ts` | `InstallFolder`'s `invalid` keeps the value (section 2.4) |
| `packages/remote-ssh/test/unit/host-settings.test.ts`, `connection-step.test.ts`, `server-steps.test.ts` | rows (section 3) |
| `packages/lib-server/src/install/plan.ts` | `invalidOverride`'s `problem` is lib-product's `TemplateProblem` (section 2.3) |
| `packages/lib-server/test/unit/plan.test.ts` | the `invalidOverride` row passes a `TemplateProblem` (`{kind: 'notHttpUrl', value: 'x'}`) |
| `packages/remote-ssh/src/pipeline/connect.ts` | logs the library detail of a failure (section 2.2) |
| `packages/remote-ssh/src/surfaces/failure-strings.ts` | S043, S075, `templateUnknownPlaceholder`, `templateNotHttp` and `installPathProvided` in `FailureStringId` and `FAILURE_TEMPLATES` |
| `packages/remote-ssh/l10n/bundle.l10n.json` and the 14 locale bundles | the five templates as keys |
| `packages/remote-ssh/test/unit/failure.test.ts`, `connect.test.ts`, `failure-strings.test.ts`, `strings.test.ts` | rows (section 3) |

## 2. Contract

### 2.1 The mappers

Each mapper returns a `FailureDetail` with **no `{text}` reason**, and gives the library's text separately as a
`logDetail` for 2.2. `FailureDetail` gains `/** What the library said, for the log only; never shown. */ logDetail?:
string`.

| Mapper | Case | Kind | Reason | `logDetail` |
|---|---|---|---|---|
| `ofChannel` | `channelClosed` | `channelClosed` | none | the detail |
| | `timeout` | `timeout` | none | the detail |
| | `cancelled` | `cancelled` | none | — |
| | `copyToolMissing` | `prerequisiteMissing` | none | the detail |
| | `copyFailed` | `serverInstall` | `{id: 'S075'}` | the detail |
| | any other | `unknown` | none | the detail |
| `ofProbe` | `unsupportedPlatform`, `unsupportedArch` | `unsupportedPlatform` | none | `reported: <the host's value>` |
| | `prerequisiteMissing` | `prerequisiteMissing` | none | `missing: <the list>` |
| | (the other cases) | unchanged | unchanged | — |
| `ofConnection` | `spawnFailed` (client vanished) | `prerequisiteMissing` | none | the detail |
| | `spawnFailed` (other) | `unknown` | none | the detail |
| | `helperRefused` | `unknown` | none | the reason |
| | (the other cases) | unchanged | unchanged (a `loginFailed` keeps classify's reason) | — |
| `ofPlan` | `invalidOverride` | `invalidServerTemplate` | see 2.3 | the problem |
| | `invalidInstallPath` | `invalidSetting` | none | the reason |
| `ofTransfer` | `serverDownload`, `localDownload`, `downloadTimeout`, `verification` | `serverDownload` | `{id: 'S043'}` | the cause / detail / reason / mismatch |
| | `unpack` | `serverInstall` | `{id: 'S075'}` | — |
| | (the other cases) | unchanged | unchanged | — |

`ofStatus` (a script status word) gains the ids for its two download and install kinds: a status that maps to
`serverDownload` gets `{id: 'S043'}`, one that maps to `serverInstall` gets `{id: 'S075'}`. The others keep no reason.
`detailOf` is deleted (nothing builds a `{text}` reason any more).

### 2.2 The log

In `connect.ts`, where a step's failure becomes the connect's `Failed`, a `logDetail` present on it is written to the
connect log as `the <kind> failure: <logDetail>` (F-2003). `failedWith` never copies it into `Failed`.

### 2.3 The template dialog's `{3}` (ruled)

`invalidServerTemplate` shows remote-ssh's own dialog, "The value of {1} is not a usable server download URL template:
{3}." (contracts §3.2, ruled 2026-10-09). Today `{3}` is filled with `resolution.problem.kind`, a raw identifier
(`unknownPlaceholder`, `notHttpUrl`), so the user reads "…template: notHttpUrl." The ruled template has a `{3}` but no
ruling says what fills it. Proposal: two named entries of ours, chosen by the problem's kind, with its value:
`unknownPlaceholder` → `the placeholder {0} is not known` (`{0}` = the placeholder's name), `notHttpUrl` → `it does not
give an http or https address`. `ofPlan` then gives the reason `{id: <that entry>, values: […]}`, and the presenter's
`reasonText` fills `{3}` with it.

**Ruled (athena, 2026-10-12): the proposal, with one refinement.** The dialog is our own text (F-3902 rule 8, no
reference counterpart; remote-ssh#87 fixes only the template and calls `{3}` "the problem"), so `{3}`'s wording is ours.
- `unknownPlaceholder` → `the placeholder {0} is not known`, with `{0}` the placeholder **as the user wrote it, braces
  included** (`${name}`; lib-product's `name` is the bare name, so the reason builds `` `${${name}}` ``), so the user can
  find it in their setting.
- `notHttpUrl` → `it does not give an http or https address`. It names no value: the expanded address may carry the
  user's own host names and isn't needed to see the fault.
- Both are named entries in `FAILURE_TEMPLATES` (`templateUnknownPlaceholder`, `templateNotHttp`) and keys in all 15
  bundles. Rows: each problem kind gives its entry; the placeholder row's text holds `${name}`; and the dialog reads
  `The value of remote.SSH.serverDownloadUrlTemplate is not a usable server download URL template: the placeholder
  ${foo} is not known.`

**Carrying the problem whole.** Today `server-steps.ts`'s `sourceOf` flattens the problem to its `kind`
(`problem: resolution.problem.kind`), and lib-server's `PlanInput.source` and `PlanFailure` carry it as a `string`, so
the placeholder's name is lost before `ofPlan`. They carry lib-product's `TemplateProblem` instead:
`packages/lib-server/src/install/plan.ts`'s `{kind: 'invalidOverride'; problem: string}` (in both `PlanInput.source`
and `PlanFailure`) becomes `problem: TemplateProblem` (imported from lib-product, which lib-server already depends on),
and `sourceOf` passes `resolution.problem` itself. `ofPlan` maps it:
- `unknownPlaceholder` → `{id: 'templateUnknownPlaceholder', values: ['${' + name + '}']}`;
- `notHttpUrl` → `{id: 'templateNotHttp', values: []}`;
- `unsupportedPlatform` → no reason (S030's rule: unplaced). It can't reach remote-ssh's override, since only the
  base-URL form (`acceptsBaseUrl`, false for remote-ssh) gives it, but the type allows it, so the mapping is total.
The problem's own values go to `logDetail` as before.

### 2.4 The other text reasons (amended 2026-10-12, iris on #367)

iris's sweep of the whole pipeline found three more `{text}` reasons outside the mappers. `git grep "{text:"` over
`packages/remote-ssh/src/pipeline` then finds none but `failure.ts`'s `detailOf`, which this card deletes.

- **`connect.ts`, a step that throws:** `failure({kind: 'unknown', reason: {text: messageOf(caught)}})` gives no
  reason; the message is its `logDetail` (logged by 2.2).
- **`connection-step.ts`, `channelFor` throwing:** `{kind: 'unknown', reason: {text: String(caught)}}` gives no reason;
  the message is its `logDetail`.
- **`server-steps.ts`, an invalid install folder:** today it shows the setting key (`{text:
  'remote.SSH.serverInstallPath'}`). F-2407 7.E1 says the dialog reads `Could not establish connection to "<alias>":
  Provided: "<value>".`, the user's value as stored, and calls `Provided: "<value>"` the extension's own unlocalized
  literal with no string id. So it becomes a named entry of ours in `FAILURE_TEMPLATES`, `installPathProvided`, with
  the template `Provided: "{0}"`, and the reason `{id: 'installPathProvided', values: [<value>]}`; the key goes in all
  15 bundles. (That's athena's rule: "our own named entry, set per kind where the spec places it".) For the value,
  `host-settings.ts`'s `InstallFolder` variant `{kind: 'invalid'}` becomes `{kind: 'invalid'; value: string}`, the
  entry exactly as stored.

## 3. Test table

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| contracts R1 | `ofChannel({kind: 'channelClosed', detail: 'the session ended'})` | `{kind: 'channelClosed', logDetail: 'the session ended'}`: no `reason` |
| contracts R1 | `ofChannel({kind: 'timeout', detail: 'no end in time'})` | no `reason` |
| F-2403 7.E2 | `ofChannel({kind: 'copyFailed', detail: 'x'})` | `reason` `{id: 'S075'}` |
| F-2403 7.E1 | each of `ofTransfer`'s four download cases | `reason` `{id: 'S043'}`, and the library text as `logDetail` (one `it` each) |
| F-2403 7.E2 | `ofTransfer({kind: 'unpack'})` | `reason` `{id: 'S075'}` |
| F-2403 7.E1 | `ofStatus` of `ServerDownloadFailed` (through `ofProbe` or `ofTransfer`'s `scriptFailed`) | `reason` `{id: 'S043'}` |
| F-2403 7.E3 | `ofStatus` of `UnpackFailed` | `reason` `{id: 'S075'}` |
| contracts R1 | `ofProbe({kind: 'unsupportedPlatform', reported: 'aix'})` | no `reason`; `logDetail` `reported: aix` |
| contracts R1 | `ofConnection` `spawnFailed` with a detail | no `reason`; the detail is the `logDetail` |
| contracts R1 | `ofConnection` `loginFailed` with classify's reason | the reason is kept (ssh's words) |
| F-2003 | a connect whose transfer fails with a cause `boom` | the log has `the serverDownload failure: boom` |
| contracts R1 | the same | `Failed.reason` is `{id: 'S043'}`, and no `Failed` field contains `boom` |
| #299 (athena) | `ofPlan` of `invalidOverride` with `{kind: 'unknownPlaceholder', name: 'foo'}` | `reason` `{id: 'templateUnknownPlaceholder', values: ['${foo}']}` |
| #299 | `ofPlan` of `invalidOverride` with `{kind: 'notHttpUrl', value: 'ftp://h/x'}` | `reason` `{id: 'templateNotHttp', values: []}`; `ftp://h/x` only in `logDetail` |
| #299 | `ofPlan` of `invalidOverride` with `{kind: 'unsupportedPlatform', …}` | no `reason` |
| F-3902 rule 8 | the dialog for the `unknownPlaceholder` case | `The value of remote.SSH.serverDownloadUrlTemplate is not a usable server download URL template: the placeholder ${foo} is not known.` |
| contracts R1 (iris) | a connect whose step throws `new Error('boom')` | `Failed` has no `reason`; the log has `boom` |
| contracts R1 (iris) | the connection step whose `channelFor` throws `new Error('gone')` | `{kind: 'unknown'}` with no `reason`, and `logDetail` `Error: gone` |
| F-2407 7.E1 | `validate` with `serverInstallPath` `{devbox: 'relative/inst'}` | `reason` `{id: 'installPathProvided', values: ['relative/inst']}` |
| F-2407 7.E1 | the dialog for it | `Could not establish connection to "devbox": Provided: "relative/inst".` |
| F-2407 7.E1 | a value holding quotes, `"/x/q"` | the dialog shows `Provided: ""/x/q"".` (the value as stored, F-2407 7.E1) |
| F-2407 | `installFolderFor` of an invalid entry | `{kind: 'invalid', value: <the entry>}` (the existing rows gain the value) |
| R-29 | every mapper's every case | no result has a `reason` with a `text` field (one sweep row over a table of every case) |
| F-2403 | `FAILURE_TEMPLATES.S043` / `.S075` | `Downloading VS Code Server failed. Please try again later.` / `Failed to install the VS Code Server` |
| F-2601 | the dialog for `serverDownload` with S043 | ends with one full stop (`…later.`), not two (the presenter's existing stop rule) |
| string tables | the default bundle | has both keys |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `remote-ssh: no library text in the failure dialog (card connect-20)`.

## 6. Open rows

None: section 2.3 is ruled (athena, 2026-10-12). Everything else is ruled too (contracts
R1, fb7516b).
