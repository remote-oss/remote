# Task card tooling-13: remote-ssh's scripted adapters for the acceptance harness

Why: #140 part F (part F brief and athena's rulings, #253). The connect suite drives the extension's dialogs from a
script and checks what was asked. The harness reserves one switch for this, `REMOTE_OSS_ACCEPTANCE`
(`tests/acceptance/README.md`): "dialogs answered from a script and recorded … A package reads it in exactly one
place, the adapter selection at activation". No extension implements it yet. This card does it for remote-ssh.
Reviewing coder: `remote-coding-worker-1`.

The constraints are athena's (#253), each held by a row of section 3:
1. The switch is read in exactly one place, the adapter selection at activation. Nothing else branches on it; no
   shipped string names it.
2. The adapters answer only from the script the test writes. With no script, or no matching entry, they fail closed:
   dismiss or cancel, never a default "yes", never a host key, trust or password.
3. The licence modal's scripted adapter can only decline. Accept is not in its vocabulary.
4. Every question asked, and its answer, is recorded.
5. (Ruling 4) All three variables are read in the one place.
6. (Ruling 5) The script is strict both ways: a question that does not match the next entry fails closed, and entries
   left unused fail the test.
7. Each adapter has a row showing it is off without the switch.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/remote-ssh/src/surfaces/scripted-adapters.ts` | new: `adaptersFor`, `scriptedAdapters`, the script and record types (section 2) |
| `packages/remote-ssh/src/extension.ts` | builds its adapters with `adaptersFor(process.env, real)` (section 2.4) |
| `packages/remote-ssh/test/unit/scripted-adapters.test.ts` | new (section 3) |
| `tests/acceptance/suite-local/script.ts` | new: the test side, writing a script and reading the record (section 2.5) |

Nothing else. The real adapters (`editor-adapters.ts`, `login-terminal.ts`) are untouched.

## 2. Contract

### 2.1 The script and the record

```ts
/** One expected question and its answer, in the order the test expects them. */
export type ScriptEntry =
  | {surface: 'pick'; match: string; answer: 'yes' | 'no' | 'dismiss'}
  | {surface: 'maskedInput'; match: string; answer: {text: string} | 'dismiss'}
  | {surface: 'platformPick'; match: string; answer: 'linux' | 'windows' | 'macOS' | 'dismiss'}
  | {surface: 'failureDialog'; match: string; answer: {button: string} | 'dismiss'}
  | {surface: 'mitigationPick'; match: string; answer: MitigationAction | 'dismiss'}
  | {surface: 'licenceModal'; match: string; answer: 'decline' | 'dismiss'};

/** One line of the record: the question as asked, and what the adapter answered. */
export interface RecordLine {
  surface: ScriptEntry['surface'];
  /** The question's text: a pick's title (or its placeholder when it has none), a masked input's placeholder, a dialog's message. */
  question: string;
  /** The answer given: the entry's answer, `'dismiss'` on fail-closed, and `'<supplied>'` for a masked input's text. */
  answer: string;
  /** Whether a script entry matched (false: failed closed). */
  matched: boolean;
}
```

The script file is JSON, `{"entries": ScriptEntry[]}`. The record file is JSON lines, one `RecordLine` per line, each
appended and flushed when the answer is given (`appendFileSync`).

A masked input's answer is never written to the record: `'<supplied>'` stands for it (contracts §S7, "Never: store or
log an answer").

### 2.2 `scriptedAdapters`

```ts
export function scriptedAdapters(
  scriptFile: string,
  recordFile: string,
  real: Pick<EditorAdapters, 'terminals'>,
  files: {read(file: string): string; append(file: string, text: string): void},
): EditorAdapters & {unusedEntries(): number};
```

It reads the script once, when made (a missing or unreadable file is an empty script). It keeps a cursor at the first
unused entry. For each question asked on any surface:
- **The next entry matches** (same `surface`, and `question` includes `match`): the cursor moves on, the entry's answer
  is given and recorded with `matched: true`.
- **Otherwise** (a different surface, a non-matching text, or no entries left): **fail closed**. The cursor does not
  move, the adapter answers `undefined` (dismissed), and that is recorded with `answer: 'dismiss'`, `matched: false`.
  Out-of-order questions therefore never consume an entry (ruling 5).

The answers per port:
- `prompts.pick(request)`: `'yes'`, `'no'`, or `undefined` for `'dismiss'`. The question is `request.title ??
  request.placeholder`.
- `prompts.maskedInput(request)`: the entry's `text`, or `undefined`. The question is `request.placeholder`.
- `prompts.translate`: the identity function. The script matches English texts.
- `platformPick.pick(pick)`: the entry's platform, or `undefined`. The question is the placeholder, made from
  `ownText(pick.placeholder, template => template)`.
- `failureDialog.showError(text, buttons)`: `button` when it is one of `buttons`, otherwise `undefined` (and recorded
  as `matched: false`). The question is `text`.
- `mitigationPick.pick(pick)`: the entry's action, or `undefined`. The question is `pick.placeholder`.
- `licenceDialog.showModal(message, detail, buttons)`: **`'decline'` answers the last button** (the modal's Cancel,
  which `licenceModalOf` passes last), and `'dismiss'` answers `undefined`. There is no way to answer the accept
  button; the type has no such answer (constraint 3). The question is `message`.
- `terminals`: `real.terminals`, passed through. Terminal output is the host's, and its questions go through `prompts`.

`unusedEntries()` is the number of entries after the cursor. The connect suite asserts it is 0 at the end of each test
(ruling 5).

### 2.3 `adaptersFor`, the one place

```ts
/** The variables the one place reads. */
const SWITCH = 'REMOTE_OSS_ACCEPTANCE';
const SCRIPT = 'REMOTE_OSS_ACCEPTANCE_SCRIPT';
const RECORD = 'REMOTE_OSS_ACCEPTANCE_RECORD';

export function adaptersFor(
  environment: Readonly<Record<string, string | undefined>>,
  real: EditorAdapters,
  files: {read(file: string): string; append(file: string, text: string): void},
): EditorAdapters;
```

With `environment[SWITCH] === '1'` and both `SCRIPT` and `RECORD` set, it returns `scriptedAdapters(...)`. In every
other case it returns `real` unchanged: the switch off, or on without the two files (fail closed: it does not answer
anything by itself).

These three names appear nowhere else in `packages/remote-ssh/src` (constraint 1, ruling 4). A unit row checks the
source.

### 2.4 `extension.ts`

`registerConnectOf` builds the real adapters as today, then passes `adaptersFor(process.env, real, nodeFiles)` to
`editorSurfacesOf`. `nodeFiles` is `{read: file => readFileSync(file, 'utf8'), append: appendFileSync}`.

### 2.5 The test side (`tests/acceptance/suite-local/script.ts`)

```ts
/** Writes the script for the next connect and gives the record's reader. */
export function scriptFor(entries: ScriptEntry[]): {record(): RecordLine[]};
```

It writes `{"entries": …}` to the file named in `REMOTE_OSS_ACCEPTANCE_SCRIPT`, empties the record file, and reads the
record back as parsed lines. The harness (card tooling-12) sets the two variables to files in the run's folder.

The script is read when the extension activates, which is once per window. So a test that needs its own script writes
it **before** the window that connects is opened. That is ruling 1's local-window flow: the test writes the script,
then opens the remote window. Say so in `tests/acceptance/README.md`.

## 3. Test table (`scripted-adapters.test.ts`, over in-memory `files`)

One assertion per `it`; the cite starts the name.

| Cite | Given | Expected |
|---|---|---|
| constraint 7 | `adaptersFor({}, real, files)` | returns `real` (the same object) |
| constraint 7 | `adaptersFor({REMOTE_OSS_ACCEPTANCE: '0', …both files}, real, files)` | returns `real` |
| constraint 2 | the switch on, no `SCRIPT` | returns `real` |
| constraint 1, ruling 4 | the text of every file under `packages/remote-ssh/src` except `scripted-adapters.ts` | none contains `REMOTE_OSS_ACCEPTANCE` |
| constraint 1 | the bundles' l10n and `package.nls.json` files | none contains `REMOTE_OSS_ACCEPTANCE` |
| constraint 2 | an empty script; `pick` of a fingerprint question | `undefined`, recorded `{answer: 'dismiss', matched: false}` |
| constraint 2 | an empty script; `maskedInput` | `undefined` |
| constraint 2 | an empty script; `failureDialog.showError(t, ['Retry'])` | `undefined` |
| #253 | `[{surface: 'pick', match: 'authenticity', answer: 'yes'}]`; a pick titled `The authenticity of host …` | `'yes'`, recorded `matched: true` |
| ruling 5 | `[{surface: 'pick', match: 'authenticity', answer: 'yes'}]`; first a `maskedInput`, then that pick | the masked input gets `undefined`, and the pick still gets `'yes'` (the out-of-order question did not consume the entry) |
| ruling 5 | `[{surface: 'pick', match: 'zzz', answer: 'yes'}]`; a pick titled `abc` | `undefined`, and `unusedEntries()` is 1 |
| constraint 3 | `[{surface: 'licenceModal', match: '', answer: 'decline'}]`; `showModal(m, d, ['Accept and Continue', 'Cancel'])` | `'Cancel'` |
| constraint 3 | an empty script; `showModal(…)` | `undefined` |
| §S7 | `[{surface: 'maskedInput', match: 'password', answer: {text: 's3cret'}}]`; a masked input with placeholder `alex@dev's password:` | the answer is `'s3cret'`, and the record line's `answer` is `'<supplied>'` |
| §S7 | the same | no record line contains `s3cret` |
| #253 | a `failureDialog` entry `{button: 'Close Remote'}` and buttons `['Close Remote', 'Retry']` | `'Close Remote'` |
| #253 | the same entry with buttons `['Retry']` | `undefined`, recorded `matched: false` |
| #253 | `platformPick` entry `'linux'` | `'linux'` |
| #253 | `mitigationPick` entry `'reloadWindow'` | `'reloadWindow'` |
| constraint 4 | three answered questions | the record has three lines, in order |
| #253 | `terminals` | is `real.terminals` |
| #253 | a missing script file | an empty script (every question fails closed) |

## 4. Rule for the worker

As card log-01; coverage at remote-ssh's 100/100/100 ratchet (`scripted-adapters.ts` is covered; `extension.ts` stays
excluded).

## 5. Gates and review

PR title `remote-ssh: scripted adapters for the acceptance harness (card tooling-13, #140 part F)`.

## 6. Open rows

None. Ruled on #253 (athena's six constraints and rulings 4 and 5).
