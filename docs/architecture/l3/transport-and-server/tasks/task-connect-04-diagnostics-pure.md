> Lead's rulings on §6 (2026-10-08): O1 a second record with the same `started` replaces the first (same resolve);
> O2 a corrupt persisted store is treated as empty and logged once; O3 a cancelled prompt stores no answer field at
> all; O4 the record never carries settings values or environment values (only ids and statuses), so there is
> nothing to redact beyond the token rule, and a test asserts the record type has no free-text fields except the
> reason text; O5 line breaks in a reason text are replaced by a space before the line is written; O6 the skeleton
> card declares `lib-ssh` as a dependency (added to card remote-ssh-00).

# Task connect-04: the pure parts of the SSH diagnostics (R2)

Base: main, after card remote-ssh-00 (the `packages/remote-ssh` skeleton) has merged. Brief: `../brief-remote-ssh-connect.md`, task connect-04. Neither module exists yet; this card writes both, tests first.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/diagnostics/log-content.ts` | `resolveLogLines` and the record types it reads |
| `packages/remote-ssh/src/diagnostics/hint-store.ts` | `emptyHintStore`, `addHint`, `clearAll` and the store types |
| `packages/remote-ssh/test/unit/log-content.test.ts` | new |
| `packages/remote-ssh/test/unit/hint-store.test.ts` | new |

Nothing else may change: no `package.json`, no `tsconfig*`, no `coverage.json`, no `knip.jsonc`, no `src/index.ts`. The skeleton card declares the dependency on `lib-ssh`; `log-content.ts` imports `logLinesOf` from `lib-ssh`. No fixtures: every input is a literal in the test, built by one helper per test file that returns the canonical record below with the named fields overridden.

Neither module imports `vscode`, `lib-log` or the file system. Both are pure: no clock, no randomness, no input mutated.

## 2. Contract

`contracts.md` section 7, heading "### R2 ssh-diagnostics": `recordResolve` (the log content of F-2003 BR-6, without secrets) and `storeHints` (the two newest records, F-2605). `showTroubleshooting` is not in this card. The contract governs.

Signatures (fixed):

```ts
export function resolveLogLines(record: ResolveRecord): string[];
export function emptyHintStore(): HintStore;
export function addHint(store: HintStore, record: SessionRecord): HintStore;
export function clearAll(store: HintStore): HintStore;
```

`hintsFor(store, hostKey?)` does not exist: the store is application-wide and a record carries no host key (F-2605 BR-8, BR-9). `emptyHintStore` is the only name added to the fixed list; the tests need an empty store.

Types. Only `ResolveRecord`, `SessionRecord` and `HintStore` are exported (knip); the interfaces they use are declared in the same file without `export`. If `tsc` refuses that, stop and report.

```ts
interface ResolveRecord {
  authority: string;              // the host part of ssh-remote+<host>
  attempt: number;
  reconnection: boolean;
  level: 'debug' | 'trace';
  windowStart?: {                 // present only when this resolve is the window's first operation
    editorVersion: string; extensionName: string; extensionVersion: string;
    platform: string; architecture: string;
    searchedFolders: string[]; clientBanner: string;
  };
  settings: {name: string; value: string}[];   // name without the `remote.SSH.` prefix, value already as text
  sshStarted: boolean;
  sshLines: string[];             // ssh's error-stream lines, one per element, in order
  prompts: {text: string; answer: string}[];
  connectionToken?: string;
  remoteOutput: string[];
  listeningPort?: number;
  resolvedPort?: number;
  failure?: string;               // the message the resolve ended with, already localised
  summary:
    | {kind: 'none'}
    | {kind: 'disabled'}
    | {kind: 'issues'; issues: {status: string; message: string}[]};
  serverOutput: string[];
}

interface HintStore { records: SessionRecord[] }   // oldest first
interface SessionRecord { started: string; hints: SessionHint[] }   // started: ISO time of the resolve start
type SessionHint =
  | {kind: 'environment'; message: string; details?: string}
  | {kind: 'error'; status: string; message: string; details?: string; mitigations?: string[]; resources?: string[]}
  | {kind: 'log'; text: string};
```

The error hint's `status` is the code name (`OfflineError`), the table's Status cell (F-2605 BR-5); the reference's numeric statuses are reference data and not stored (F-2603 BR-11). The log wording is free in F-2003 (BR-6: "the wording is free"); the formats below are this card's choice, and the tests pin them. They are internal constants, not exported. The caller (the sink) adds the time of each entry (BR-4); `resolveLogLines` writes none.

Line formats, `resolveLogLines` in this order. `{x}` is a field; `SCRUB` means: each occurrence of a non-empty `connectionToken` in the text is replaced by the token with every digit changed to `1` and every ASCII letter to `a`, other characters kept.

| # | Item (F-2003 BR-6) | Line(s), written when | Text |
|---|---|---|---|
| 0 | level (AC-11) | `windowStart` present | `Log level: {level}` |
| 1 | 1 | always | `Resolving ssh-remote+{authority}, attempt {attempt}`; with `reconnection` true the line ends `, reconnection` |
| 2 | 2 | one per setting, in the given order | `remote.SSH.{name} = {value}` (SCRUB) |
| 3 | 3 | `windowStart` present | `VS Code version: {editorVersion}`, `Extension: {extensionName} {extensionVersion}`, `Platform: {platform} {architecture}` |
| 4 | 4 | `windowStart` present | one `Searched for ssh in: {folder}` per folder, then `ssh client: {clientBanner}` |
| 5 | 5 | `sshStarted` | `Started ssh` |
| 6 | 6 | one per kept line | `[ssh] {line}` (SCRUB). `debug`: the lines of `logLinesOf(sshLines)`; `trace`: every line |
| 7 | 7 | per prompt, in order | `Prompt: {text}` (SCRUB), then `Answer: ***` whatever the answer is |
| 8 | 8 | one per line | `[remote] {line}` (SCRUB) |
| 9 | 9 | `listeningPort` present | `Remote server listening on port {listeningPort}` |
| 10 | 10 | `resolvedPort` present | `Resolved ssh-remote+{authority} to local port {resolvedPort}` |
| 11 | 11 | `failure` present | `Resolution failed: {failure}` (SCRUB) |
| 12 | 12 | always | 40 hyphens (`RULE`), four empty strings, then by `summary`: `none` gives `No hints found in the recent session.`; `disabled` gives `Enhanced session logs are disabled.`; `issues` gives `---------- [Session Summary] ----------` (ten hyphens each side), one `[{status}]: {message}` (SCRUB) per issue in order, then `RULE` |
| 13 | 13 | one per line | `[server] {line}` (SCRUB) |

`addHint` appends the record to the records and, when more than two remain, drops from the front until two remain. `clearAll` returns an empty store. Both return a new store; neither changes its argument or the record.

Never: write an answer typed at a prompt, the connection token, or any environment value (F-2003 BR-14).

## 3. Test table

Rows marked (provisional) rest on a spec reading, not a confirmed answer; they are tested like any other row. A row asserts the lines it names; "R0" is the canonical record below with the named fields overridden. Test names start with the Cite.

R0: `authority 'host1.invalid'`, `attempt 1`, `reconnection false`, `level 'debug'`, `windowStart {editorVersion '1.2.3', extensionName 'remote-ssh', extensionVersion '0.1.0', platform 'linux', architecture 'arm64', searchedFolders ['/usr/bin', '/usr/local/bin'], clientBanner 'OpenSSH_9.9p1'}`, `settings [{useLocalServer, 'true'}, {path, 'undefined'}]`, `sshStarted true`, `sshLines ['debug1: Server host key: ssh-ed25519 SHA256:abc', 'debug1: Authenticating to host1.invalid:22', 'Warning: Permanently added host1.invalid']`, `prompts [{text 'Password: ', answer 'hunter2'}]`, `connectionToken 'ab12-cd34'`, `remoteOutput ['installing', 'token ab12-cd34 ready']`, `listeningPort 40000`, `resolvedPort 50000`, no `failure`, `summary {kind 'none'}`, `serverOutput ['Downloading 50%']`.

### 3.1 `log-content.test.ts`

| Cite | Given | Expected |
|---|---|---|
| F-2003.AC-11 / F-2003.BR-6 | R0 | exactly, in order: `Log level: debug`; `Resolving ssh-remote+host1.invalid, attempt 1`; `remote.SSH.useLocalServer = true`; `remote.SSH.path = undefined`; `VS Code version: 1.2.3`; `Extension: remote-ssh 0.1.0`; `Platform: linux arm64`; `Searched for ssh in: /usr/bin`; `Searched for ssh in: /usr/local/bin`; `ssh client: OpenSSH_9.9p1`; `Started ssh`; `[ssh] debug1: Server host key: ssh-ed25519 SHA256:abc`; `[ssh] Warning: Permanently added host1.invalid`; `Prompt: Password: `; `Answer: ***`; `[remote] installing`; `[remote] token aa11-aa11 ready`; `Remote server listening on port 40000`; `Resolved ssh-remote+host1.invalid to local port 50000`; forty hyphens; four `''`; `No hints found in the recent session.`; `[server] Downloading 50%` |
| F-2003.BR-6 item 1 | R0, attempt 2, reconnection true | line 2 is `Resolving ssh-remote+host1.invalid, attempt 2, reconnection` |
| F-2003.BR-6 item 1 | R0, reconnection false | line 2 does not contain `reconnection` |
| F-2003.BR-5 | R0 without `windowStart` | no line starts with `Log level:`, `VS Code version:`, `Extension:`, `Platform:`, `Searched for ssh in:` or `ssh client:`; the first line is `Resolving ssh-remote+host1.invalid, attempt 1`, followed by the two setting lines |
| F-2003.BR-6 item 2 | R0, `settings []` | no line starts with `remote.SSH.` |
| F-2003.BR-6 item 2 | R0, 23 settings named `setting01` to `setting23`, value `v` plus the number | 23 lines `remote.SSH.setting01 = v1` ... in that order, between the resolver line and the versions |
| F-2003.BR-6 item 4 | R0, `searchedFolders []` | no `Searched for ssh in:` line; the `ssh client:` line is still written |
| F-2003.BR-6 item 5 | R0, `sshStarted false` | no `Started ssh` line |
| F-2003.BR-8 | R0, level debug, `sshLines` `debug1: Server host key: ssh-ed25519 SHA256:abc`, `debug1: other`, `debug2: x`, `Warning: y`, `Authenticated to h ([127.0.0.1]:22) using "publickey".` | the `[ssh] ` lines are the first, third, fourth and fifth, in order |
| F-2003.BR-9 | the same lines, level trace | all five, `[ssh] `-marked, in order |
| F-2003.AC-24 | level debug, `channel 2: open failed: administratively prohibited: open failed` and `ssh: connect to host 192.0.2.1 port 22: Connection refused` | `[ssh] ` plus each line verbatim, in order |
| F-2003.BR-6 item 6 | R0, `sshLines []` | no line starts with `[ssh]` |
| F-2003.BR-6 item 7 | two prompts `Enter passphrase for key '/k': ` answer `pw1` and `Are you sure you want to continue connecting (yes/no)? ` answer `yes` | `Prompt: Enter passphrase for key '/k': `, `Answer: ***`, `Prompt: Are you sure you want to continue connecting (yes/no)? `, `Answer: ***`, in that order |
| F-2003.BR-6 item 7 | one prompt with answer `''` | `Answer: ***` |
| F-2003.BR-6 item 7 | `prompts []` | no `Prompt:` and no `Answer:` line |
| F-2003.BR-6 item 8 | `remoteOutput ['a', 'b']`, no token | `[remote] a`, `[remote] b` |
| F-2003.7.E6 | (each) token `Ab1-9z` appearing in a setting value, an ssh line, a prompt text, a remote line, the failure and a server line | the field's line holds `aa1-1a` and not `Ab1-9z` |
| F-2003.7.E6 | token `Ab1-9z` appearing twice in one remote line | both occurrences masked |
| F-2003.7.E6 | token `''` (empty) | every line unchanged |
| F-2003.AC-16 / F-2003.BR-14 | prompts `Password: ` answer `p4ss w0rd` and `Enter passphrase for key '/k': ` answer `hunter2`; token `tok-9f8e7d` in a remote line and in a server line | joined output contains none of `p4ss w0rd`, `hunter2`, `tok-9f8e7d`; it contains `Answer: ***` twice and `aaa-1a1a1a` twice |
| F-2003.AC-21 | token `tok-9f8e7d` as `connectionToken` and in no line | joined output does not contain it |
| F-2003.BR-6 item 9 | `listeningPort 40000`, no `resolvedPort` | the listening line, no `Resolved` line |
| F-2003.BR-6 item 10 | `resolvedPort 50000`, no `listeningPort` | the `Resolved` line, no listening line |
| F-2003.BR-6 item 9 | neither port | neither line |
| F-2003.BR-6 item 11 | `failure 'Could not resolve hostname.'`, no ports | `Resolution failed: Could not resolve hostname.` after the last `[remote]` line and before the 40 hyphens; no listening and no `Resolved` line |
| F-2003.BR-7 | `failure 'The connection timed out.'` with `listeningPort 40000` | the listening line, then the `Resolution failed:` line |
| F-2003.BR-6 item 12 | R0, summary none | the 40 hyphens, four empty strings and `No hints found in the recent session.` follow the last line of item 11 or 10 |
| F-2605.6.5 | summary disabled | the four empty strings, then `Enhanced session logs are disabled.` |
| F-2003.AC-23 | summary issues `[{OfflineError, 'Error: OfflineError (The connection timed out)'}]` | forty hyphens; four `''`; `---------- [Session Summary] ----------`; `[OfflineError]: Error: OfflineError (The connection timed out)`; forty hyphens |
| F-2605.BR-6 | summary issues with two entries | the two `[status]: message` lines in the given order between the heading and the closing rule |
| F-2605.AC-26 | summary issues `[]` | heading and closing rule with no line between |
| F-2003.AC-23 | failed record: `failure 'The connection timed out.'`, no ports, summary issues as above, `serverOutput []` | the lines in order: resolver, settings, ..., `Resolution failed: ...`, rule, four `''`, summary block; and nothing after the closing rule |
| F-2003.BR-6 item 13 | R0 with `serverOutput ['a', 'b']` | `[server] a`, `[server] b` are the last two lines, after the summary |
| F-2003.BR-6 item 13 | R0 with `serverOutput []` | the last line is `No hints found in the recent session.` |
| F-2003.BR-4 | R0 | no line matches `/^\[\d/` (no time is written) |
| F-2003.BR-6 | R0 frozen with `Object.freeze` on the record and every array in it | no throw; a second call gives equal lines |

### 3.2 `hint-store.test.ts`

Records are built by one helper `recordAt(started, hints)` with a default hint list.

| Cite | Given | Expected |
|---|---|---|
| F-2605.AC-16 | `emptyHintStore()` | `{records: []}` |
| F-2605.AC-16 | two calls of `emptyHintStore()` | two different objects (`notStrictEqual`) |
| F-2605.AC-16 | `addHint` of record A to the empty store | `records` is `[A]` |
| F-2605.BR-10 | add A, then B | `[A, B]`, oldest first |
| F-2605.AC-16 | add A, B, C | `[B, C]` |
| F-2605.BR-10 | add A, B, C, D | `[C, D]` |
| F-2605.BR-10 (provisional) | add a record with `started` `2026-10-08T10:00:00Z` after one with `2026-10-08T11:00:00Z` | the later call is the newest: order by call, not by `started` |
| F-2605.BR-10 | a store frozen with two records, `addHint` of a third | the returned store is a different object; the argument still holds its two original records |
| F-2605.AC-17 | a record with 23 environment hints, three more (editor version, extension version, platform), one error hint (`OfflineError`, message, details) and one log hint | `addHint` keeps all 28 hints, in the given order, each field equal |
| F-2605.AC-17 | an error hint with `mitigations ['m1', 'm2']` and `resources ['r1']` and no details | stored with both lists and no `details` |
| F-2605.BR-9 | a log hint of 30,000 characters | stored with the same length (not truncated) |
| F-2605.AC-17 | a record of an attempt whose resolve never ended: environment and error hints, no log hint | stored as given; no log hint is added |
| F-2605.6.4 | a record with environment and log hints and no error hint (a success) | stored as given |
| F-2605.7.E2 | a record whose hints are environment, log, error in that order | stored in that order |
| F-2605.BR-12 / F-2605.AC-20 | `clearAll` of a store with two records | `{records: []}` |
| F-2605.AC-21 | `clearAll` of the empty store | `{records: []}`, no throw |
| F-2605.BR-12 | `clearAll` applied twice to a store with one record | `{records: []}` both times |
| F-2605.6.6 | `clearAll` of a frozen store with two records | the returned store is a different object; the argument still holds its two records |
| F-2605.AC-22 | `clearAll` of a store with two records, then `addHint` of A | `records` is `[A]` |
| F-2605.AC-16 | add A, B, then `clearAll`, then C, D, E | `[D, E]` |

## 4. Rule for the worker

- Write both test files first from the table, one `it` per row (per input for an (each) row), the name starting with the Cite; run `pnpm test:unit` and see them fail; then write the two modules to make them pass. Nothing exists yet, so there is nothing to fix: the modules are the work.
- Never change a signature or a format of section 2. Do not add behaviour or tests for anything in section 6. Do not add `hintsFor` or any export beyond section 2.
- `resolveLogLines` calls `logLinesOf` from `lib-ssh` for the `debug` filter; it does not copy that logic. No other code of `lib-ssh` or `lib-log` is imported.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier at least four characters, properties included. No duplicated code (one helper builds the lines of each channel; one table loop for the (each) rows); no unused exports; no `const` arrow helpers.
- Coverage for both files at least 90 % lines, 85 % branches, 90 % functions; report unreached branches, do not delete them.
- Full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `remote-ssh: pure diagnostics, log content and hint store (task-connect-04)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each Cite to its test name; it lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

The worker stops at a case below and reports; it neither tests nor implements it. Each carries the card author's proposal for the lead.

| # | Case | Question | Proposal |
|---|---|---|---|
| O1 | `addHint` of a record whose `started` equals one already in the store (the same attempt written twice, for example the log hint at the end of the resolve and a later error hint, F-2605 7.E2 b) | Append, or replace the earlier record in place? The spec says only that the third record drops the oldest (BR-10) | Replace in place, keeping the position; otherwise the same attempt takes both slots and pushes out the previous attempt |
| O2 | A stored value that is not a valid store (a corrupt or older global-state entry) | What does the caller get? The spec is silent | A third function `readHintStore(raw: unknown): HintStore` that returns the empty store for anything that is not `{records: [...]}` of valid records, written by a later card |
| O3 | A prompt that was cancelled (Escape on the host-key prompt, F-2605 7.E3): there is no answer | What does the log show? The record type has `answer: string` | `answer?: string`; absent gives the line `Answer: (none)` instead of `Answer: ***` |
| O4 | A secret that is not the token appears inside free text: a typed answer echoed in an ssh or remote line, or credentials in a proxy URL setting (`httpProxy`, `httpsProxy`) | F-2003 BR-14 bans answers and tokens from the channel; only the token has a stated mask (7.E6) | Replace every occurrence of a non-empty answer by `***` in all free-text lines; remove the `user:password@` part of a URL in a setting value |
| O5 | An element of `sshLines`, `remoteOutput` or `serverOutput` that holds line breaks | One entry with continuation lines, or several lines each marked? BR-4 says continuation lines carry no time | Split on `\r?\n`, mark every part, so each line of the log carries its source |
| O6 | The skeleton does not declare `lib-ssh` as a dependency of `packages/remote-ssh` when the worker starts | The card may not touch `package.json` | Stop and report; the integrator adds the dependency before this card runs |
