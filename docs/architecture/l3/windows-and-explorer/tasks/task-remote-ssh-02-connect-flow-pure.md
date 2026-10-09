> Note (2026-10-08): open row 9 is closed: `lib-authority`'s `ssh-remote` codec encodes by F-2301 BR-4 (plain unless a
> user, a port, an upper-case letter or `/`, `+`, `\`; the decoded plain text is `{kind:'plain', text}`); the connect
> flow builds targets and calls the codec, never a form of its own.

# Task card remote-ssh-02: the pure decisions of the connect flows

Brief: area B, component `ssh.connect-flows` (components.md). Contracts: `../contracts.md` §3.1 and §3.3 for the
authority and the window opener (not built here); `../../transport-and-server/contracts.md` §3 S4 (the host list) and
S2 (`validateTarget`). Reviewing coder: `remote-coding-worker-1`. Depends on card remote-ssh-01 (the package manifest
and tsconfig pair of `packages/remote-ssh`) being merged, and on `lib-ssh` being an allowed import of `remote-ssh`
there; if it is not, stop (section 6, row 1). No `vscode` import anywhere in this card.

## 1. Dependencies added by this card: `lib-ssh` and `lib-authority` as `workspace:*` in packages/remote-ssh/package.json (the first import adds the dependency; knip).

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/remote-ssh/src/connect/typed-input.ts` | `parseTypedHost` |
| `packages/remote-ssh/src/connect/picker-model.ts` | `pickerModel`, `outcomeOfPick`, the item and outcome types |
| `packages/remote-ssh/src/connect/window-target.ts` | `windowTargetOf`, `argumentChoice`, `activeHostTarget`, `isActiveHostAvailable` |
| `packages/remote-ssh/test/unit/connect-typed-input.test.ts` | new |
| `packages/remote-ssh/test/unit/connect-picker-model.test.ts` | new |
| `packages/remote-ssh/test/unit/connect-window-target.test.ts` | new |

Nothing else may change (no `package.json`, no `coverage.json` except by `pnpm coverage:update`, no
`src/index.ts` export: the extension entry that uses these modules comes in a later card). No fixtures.

Reuse, stated once. Host-name validation (rules for a leading `-`, the six forbidden characters, control characters,
the user name, the check order, the reported character) already exists as `validateTarget` in
`packages/lib-ssh/src/arguments/target.ts` and is exported by `lib-ssh`. This card writes no second validator. It
imports `SshTarget` and `validateTarget` from `lib-ssh` only: `parseTypedHost` returns an `SshTarget`, and the tests
of the "composition" block below prove that typed text reaches `validateTarget` with the right fields. The typed text
is NOT parsed as an ssh command line, so `parseAddHostCommand` (the add-host parser of S4, owned by F-2204) is not
used here; the spec for the typed row fixes its own splitting rules.

## 2. Contract

```ts
import type {HostListResult, SshTarget} from 'lib-ssh';

// typed-input.ts
export function parseTypedHost(text: string): SshTarget;   // never throws; no trimming; no validation

// picker-model.ts
export interface StringRef { id: string; values: string[] }
export type PickerItem =
  | { kind: 'host'; label: string; keepVisible: boolean }                      // label = the alias, nothing else
  | { kind: 'typed'; label: string; text: string; keepVisible: true }          // text = what was typed, exactly
  | { kind: 'addHost'; label: StringRef; keepVisible: true }
  | { kind: 'configure'; label: StringRef; keepVisible: true };
export interface PickerModel { placeholder: StringRef; items: PickerItem[] }
export function pickerModel(listing: HostListResult, typedText: string): PickerModel | { parseError: { file: string; reason: string } };
export type PickOutcome = { connect: SshTarget } | { handOver: 'addHost' | 'configure' };
export function outcomeOfPick(item: PickerItem): PickOutcome;

// window-target.ts
export type ConnectSource =
  | 'opensshremotes.openEmptyWindow'
  | 'opensshremotes.openEmptyWindowInCurrentWindow'
  | 'opensshremotes.openEmptyWindowOnCurrentHost'
  | 'hostAddedConnect';
export type WindowTarget = 'new' | 'current';
export function windowTargetOf(source: ConnectSource): WindowTarget;
export type ArgumentChoice = { picker: true } | { host: string };
export function argumentChoice(argument: unknown): ArgumentChoice;     // for the two picker commands
export function activeHostTarget(current: SshTarget): SshTarget;        // the host the "on active host" command rebuilds
export function isActiveHostAvailable(remoteName: string | undefined, connectionState: string | undefined): boolean;
```

Rules (decided by the specs; where a row cites a rule, the row is the test).

`parseTypedHost`, in this order, on the text exactly as typed (no trim, no case change):
1. Split at the LAST `@`. User = the part before it when that part is not empty; host part = the part after it.
   When nothing follows the last `@` the whole text is the host and there is no user (`lab@` is the host `lab@`).
2. Host part in brackets (`[` inner `]`, then optionally `:` and digits): when the inner text is a valid IPv6 address
   the brackets are removed, with or without the port. Brackets around anything else stay in the host.
3. Otherwise, when the whole host part is a valid IPv6 address in its textual form (use `isIPv6` of `node:net`), it
   is the host and no port is split off, whatever its last group is.
4. Otherwise a trailing `:` followed by one or more ASCII digits is the port (a number, no range check), and only
   the last such suffix is taken; a non-numeric or empty suffix stays in the host.

`pickerModel`: placeholder `{id:'S127', values:[]}`. Items in this order: one `host` item per entry of the listing's
`hosts`, in the listing's order, none removed or merged (the listing already decided repeats); then the `typed` item
when `typedText` is not empty; then `addHost` with label `{id:'S167', values:['$(plus)']}`; then `configure` with
label `{id:'S024', values:[]}`. The `typed` item has label `➤ ` (U+27A4 and one space) plus the text, and `text` the
text; for text that is only whitespace (`typedText.trim() === ''`) the label is `➤` alone, the text is kept as
typed, and every `host` item gets `keepVisible: true` (otherwise `false`). The order after typing is the base order;
VS Code's own match sorting is applied later and is not decided here. A listing with `parseError` returns
`{parseError}` with the same file and reason.

`outcomeOfPick`: `host` gives `{connect: {host: label}}` (an alias never carries a user or a port); `typed` gives
`{connect: parseTypedHost(text)}`; `addHost` and `configure` give the hand-overs. No validation here.

`windowTargetOf`: `...openEmptyWindow` is `new`; `...openEmptyWindowInCurrentWindow` is `current`;
`...openEmptyWindowOnCurrentHost` is `new`; `hostAddedConnect` (the "Connect" button after a host was added) is
`new`, also when the add-host flow was started from the current-window command. No modifier key changes any of
these (the specs name none).

`argumentChoice`: an object (not null, not an array) with an own `host` property of type string gives `{host}` with
the string unchanged (also `''`, also `lab@x.invalid:2222`: not split); everything else gives `{picker: true}`.

`activeHostTarget`: the same host, user and port, except that port 22 is dropped. `isActiveHostAvailable`: true only
for remote name `ssh-remote` and connection state `connected`.

## 3. Test table

A row marked (each) is one `it` per listed input. A test name starts with the cite. "No port" means the property is
absent (compare with `deepStrictEqual`, so an `undefined` property fails).

### 3.1 `parseTypedHost`

| Cite | Given | Expected |
|---|---|---|
| F-2301.BR-3 | `plainhost.invalid` | `{host:'plainhost.invalid'}` |
| F-2301.AC-9 | `lab@host.invalid` | `{host:'host.invalid', user:'lab'}` |
| F-2301.AC-10 | `lab@host.invalid:2222` | `{host:'host.invalid', user:'lab', port:2222}` (port is a number) |
| F-2301.BR-3 | `lab@dom@host.invalid` | user `lab@dom`, host `host.invalid` |
| F-2301.BR-3 | `lowhost.invalid:2200` | host `lowhost.invalid`, port 2200 |
| F-2301.BR-3 | ` lab@trim.invalid ` (spaces kept) | user ` lab`, host `trim.invalid ` |
| F-2301.BR-3 | `ssh lab@cmd.invalid` | user `ssh lab`, host `cmd.invalid` |
| F-2301.BR-3 | `@onlyhost.invalid` | host `onlyhost.invalid`, no user |
| F-2301.BR-3 | `lab@` | host `lab@`, no user |
| F-2301.BR-3 | `porthost.invalid:abc` | host `porthost.invalid:abc`, no port |
| F-2301.BR-3 | `porthost.invalid:99999` | host `porthost.invalid`, port 99999 |
| F-2301.BR-3 | `lab@porthost.invalid:` | host `porthost.invalid:`, user `lab` |
| F-2301.BR-3 | `lab@porthost.invalid:22:33` | host `porthost.invalid:22`, port 33 |
| F-2301.BR-3 | `LAB@lower.invalid`; `Mixed.invalid` | user `LAB`; host `Mixed.invalid` (case kept) |
| F-2301.BR-3 | (each, no port, host = the whole part) `lab@fe80::1` (user `lab`, host `fe80::1`); `lab@::1`; `lab@a::22`; `lab@fe80::1:22`; `lab@1:2:3:4:5:6:7:8`; `lab@::ffff:1.2.3.4`; `lab@A::1`; `fe80::1` (no user); `fe80::1:22`; `::1` | host is the part after `@` (or the whole text), no port |
| F-2301.BR-3 | `lab@10.0.0.1:22:33` | host `10.0.0.1:22`, port 33 |
| F-2301.BR-3 | `lab@a:1:2:3`; `a:1:2` | host `a:1:2` port 3; host `a:1` port 2 |
| F-2301.BR-3 | `lab@x::22` | host `x:`, port 22 (`x` is not a hexadecimal digit) |
| F-2301.BR-3 | `lab@1:2:3:4:5:6:7:8:9`; `lab@1:2:3:4:5:6:7` | host `1:2:3:4:5:6:7:8` port 9; host `1:2:3:4:5:6` port 7 |
| F-2301.BR-3 | `lab@[fe80::1]:22` | user `lab`, host `fe80::1`, port 22 |
| F-2301.BR-3 | `lab@[fe80::1]`; `[fe80::1]` | host `fe80::1` (user `lab` in the first), no port |
| F-2301.BR-3 | `lab@[x.invalid]`; `lab@[x.invalid]:22` | host `[x.invalid]` no port; host `[x.invalid]` port 22 |
| F-2301.AC-11 | `:abc`; `:` ; `:22:33` | host `:abc`; host `:`; host `:22`, port 33 |
| F-2301.AC-29 | three spaces | host of three spaces, no user, no port |
| F-2301.6.7 | empty text | `{host:''}` |
| F-2301.BR-3 | (each) every input of the rows above | no exception thrown |

### 3.2 Composition with the existing validator (no new validator)

Each row is `validateTarget(parseTypedHost(input))` from `lib-ssh`.

| Cite | Input | Expected |
|---|---|---|
| F-2301.AC-23 | `-oProxyCommand=x` | `{kind:'invalidHost', reason:'S119', character:'-'}` |
| F-2301.AC-23 | `a%b.invalid`; `a\b.invalid` | `invalidHost`, `S120`, character `%`; character `\` |
| F-2301.AC-23 | `a b.invalid` | undefined (the S079 refusal is ssh's, later) |
| F-2205.AC-9 | `-h:22`; `u@a%b:2222` | `S119` with `-`; `S120` with `%` |
| F-2205.AC-6 | `-u@h.invalid` | `{kind:'invalidUser', reason:'S121', character:'-'}` |
| F-2205.AC-7 | `u!x@h.invalid` | `invalidUser`, `S122`, character `!` |
| F-2205.AC-8 | `-u@-h`; `u%@a%b` | `S119` (host first); `S120` with `%` (host before user) |
| F-2205.AC-32 | `@-h`; `u@` | `S119`; undefined (host `u@`) |
| F-2205.AC-37 | `a` + line feed + `b`; `a` + U+007F | `invalidHost`, `S120`, character `U+000A`; `U+007F` |
| F-2205.AC-31 | `u*x@h.invalid`; `.u@h.invalid` | undefined |
| F-2301.AC-31 | `porthost.invalid:99999`; `lab@[fe80::1]:22` | undefined |

### 3.3 `pickerModel` and `outcomeOfPick`

`HOSTS` = a listing with entries `alpha` (file `A`) and `Beta-Upper` (file `A`). Items are written `host:alpha`,
`typed:<label>`, `add`, `conf`; `add` and `conf` carry the labels of the rules above.

| Cite | Given | Expected |
|---|---|---|
| F-2301.AC-4 | `pickerModel(HOSTS, '')` | placeholder `{id:'S127', values:[]}`; items `host:alpha`, `host:Beta-Upper`, `add`, `conf`; host items `keepVisible:false`; fixed items `keepVisible:true`; labels of the hosts are the aliases only (deep equality fixes that no other property exists) |
| F-2301.AC-5 | listing with no hosts, text empty | items `add`, `conf` only |
| F-2301.AC-8 | `HOSTS`, `lab@x` | `host:alpha`, `host:Beta-Upper`, typed label `➤ lab@x` with text `lab@x`, `add`, `conf` |
| F-2301.AC-8 | no hosts, `zzz` | typed label `➤ zzz`, `add`, `conf` |
| F-2301.AC-29 | `HOSTS`, three spaces | host items with `keepVisible:true`; then typed with label `➤` and text of three spaces; then `add`, `conf` |
| F-2301.6.1 | `HOSTS`, a single tab | the same shape as the three-spaces row |
| F-2301.AC-30 | `HOSTS`, `alpha` | `host:alpha`, `host:Beta-Upper`, typed `➤ alpha`, `add`, `conf` |
| F-2301.6.1 | `HOSTS`, ` lab@x ` | typed label is `➤  lab@x ` and text ` lab@x ` (kept exactly) |
| F-2301.BR-2 | listing with `dup` from file `A` and `dup` from file `B` | two `host:dup` items in that order |
| F-2301.AC-25 | `pickerModel(HOSTS, '')` called twice, with different text between | the two results are deep-equal (no memory) |
| F-2301.AC-24 | listing `{parseError:{file:'F', reason:'R'}}` | `{parseError:{file:'F', reason:'R'}}` |
| F-2301.AC-6 | `outcomeOfPick` of `host:alpha` | `{connect:{host:'alpha'}}` (no user, no port) |
| F-2301.AC-33 | `outcomeOfPick` of `host:Beta-Upper` | `{connect:{host:'Beta-Upper'}}` |
| F-2301.AC-10 | typed item with text `lab@h:2222` | `{connect:{host:'h', user:'lab', port:2222}}` |
| F-2301.BR-7 | (each) typed items with text `-oProxyCommand=x`; `a%b.invalid`; `a b.invalid` | `{connect:{host:<the text>}}`, nothing refused |
| F-2301.AC-29 | typed item with three spaces | `{connect:{host:'   '}}` |
| F-2301.AC-16 | `outcomeOfPick` of `add` | `{handOver:'addHost'}` |
| F-2301.AC-18 | `outcomeOfPick` of `conf` | `{handOver:'configure'}` |

### 3.4 Window target and arguments

| Cite | Given | Expected |
|---|---|---|
| F-2301.BR-1 | `windowTargetOf('opensshremotes.openEmptyWindow')` | `'new'` |
| F-2302.BR-1 | `windowTargetOf('opensshremotes.openEmptyWindowInCurrentWindow')` | `'current'` |
| F-2303.BR-1 | `windowTargetOf('opensshremotes.openEmptyWindowOnCurrentHost')` | `'new'` |
| F-2302.AC-28 | `windowTargetOf('hostAddedConnect')` | `'new'` |
| F-2301.AC-20 | `argumentChoice(undefined)`; `('alias')`; `({})` | `{picker:true}` (each) |
| F-2301.AC-20 | `argumentChoice({host:'alpha'})` | `{host:'alpha'}` |
| F-2301.AC-34 | `argumentChoice({host:'UPPER-Alias'})`; `({host:'lab@x.invalid:2222'})` | `{host:'UPPER-Alias'}`; `{host:'lab@x.invalid:2222'}` (not split) |
| F-2301.AC-34 | `argumentChoice({host:''})` | `{host:''}` |
| F-2301.AC-34 | `argumentChoice({host:'unknown.invalid', extra:1})` | `{host:'unknown.invalid'}` |
| F-2302.AC-27 | `argumentChoice({host:'lab@h:22'})` | `{host:'lab@h:22'}` |
| F-2303.AC-19 | `activeHostTarget({host:'h', user:'u', port:22})` | `{host:'h', user:'u'}` |
| F-2303.AC-10 | `activeHostTarget({host:'h', user:'u', port:2222})` | `{host:'h', user:'u', port:2222}` |
| F-2303.AC-5 | `activeHostTarget({host:'alias'})` | `{host:'alias'}` |
| F-2303.AC-12 | `activeHostTarget({host:'UPPER-F2303'})` | `{host:'UPPER-F2303'}` |
| F-2303.BR-2 | `activeHostTarget({host:'h', port:22})` | `{host:'h'}` |
| F-2303.AC-1 | `isActiveHostAvailable('ssh-remote','connected')` | true |
| F-2303.AC-2 | (each) `(undefined,undefined)`; `('','')`; `('ssh-remote','disconnected')`; `('ssh-remote', undefined)`; `('wsl','connected')`; `('ssh-remote2','connected')`; `('xssh-remote','connected')` | false |

Row count: 3.1 has 26 rows, 3.2 has 11, 3.3 has 18, 3.4 has 17: 72 rows.

## 4. Rule for the worker

- Tests first. Write all tests from section 3, one `it` per row (per input for an (each) row), the name starting with
  the cite. Run `pnpm test:unit`, then write the modules to the signatures of section 2, exactly; no behaviour
  beyond the table, no export that no test uses.
- Do not change a signature or this contract. Do not add behaviour or tests for anything in section 6; stop and
  report at such a case.
- Names (ADR-0003): every identifier, properties included, at least four characters; `now` is the only short name
  allowed and is not needed here. No `const` arrow helpers (`func-style`). Comments only where the guide requires
  them; none of them carries a feature, rule or decision id or says where a rule came from (ADR-0008); ids may
  appear in test names.
- No duplicated code (table loops in the tests, one helper where two tests share a build step).
- Coverage of the three modules: 100 % lines, branches and functions; run `pnpm coverage:update` for the new package
  entry only if card remote-ssh-01 left none.
- Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `remote-ssh: connect flows, pure decisions (card remote-ssh-02)`. The
description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each cite to its test name; it lists
the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

1. `lib-ssh` is not an allowed import of `remote-ssh` after card remote-ssh-01. Question: who adds it? (Stop before
   writing anything.)
2. Text whose host part is `:99999` or `:22` (the suffix leaves an empty host): host `''` with the port, or the
   whole text as the host? The spec lists `:` and `:abc` and `:22:33` and gives the rule only for those. Not tested.
3. A host part with a zone (`fe80::1%eth0`): is it an IPv6 address for rule 3 (`isIPv6` says yes)? Not tested.
4. Brackets followed by something that is not `:` and digits (`[fe80::1]:abc`, `[fe80::1]x`): the spec only says
   brackets around an IPv6 address are removed. Not tested.
5. A port suffix of very many digits, or non-ASCII digits: the spec says "digits, no range check". Not tested.
6. `argumentChoice` with a `host` that is not a string (`{host:1}`, `{host:null}`), or an array: picker or direct?
   The spec records only string values. Not tested.
7. A modifier key (a click with Ctrl or Alt on a picker row) changing current to new or the reverse: the specs name
   none, so `windowTargetOf` has no modifier parameter. Question: is one wanted?
8. `isActiveHostAvailable` is false where the command is invoked anyway (local window, failed window, reconnecting
   window): do nothing, or open one empty window on the current authority? The spec allows both outcomes; this
   card only decides the availability, not the handler.
9. The authority text of a picked or typed host (plain `ssh-remote+<host>` or the hex form, F-2301 BR-4) is not
   built here. `lib-authority`'s `encode` for `ssh-remote` (card authority-01) uses the bare pattern `[a-z0-9.:-]`
   for the plain form, while F-2301 BR-4 lists many more plain hosts (`a_b.invalid`, `a%b.invalid`, `a b.invalid`,
   `ü.invalid`, `lab@`) and encodes only on an upper-case letter, `/`, `+`, `\`, a user or a port. Question for the
   lead: which module produces the byte-for-byte form, and does authority-01's rule change?
10. Recent folders per host in the picker rows: the spec says the picker keeps no memory of hosts or folders, so
    there are none. Question: confirm that no row variant is wanted.
