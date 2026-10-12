# Task card remote-ssh-06: the proposed-API gate at Remote - SSH's activation (#139)

Why: Remote - SSH must probe its proposed APIs at every activation and, when one is missing, show the family's one
setup notification, while every command that needs no proposal keeps working (F-3903 rule 4, F-1403 §6,
`../contracts.md` §3.4, `../brief-lib-authority.md` "Behaviour to get right" and "Adapters"). The gate's flow
(`runSetup`, `decide`, `windowClaimOf`) is on main; this card adds its editor side to lib-authority, for every family
extension, and wires it into Remote - SSH. Implemented by PR #260 (iris); this card records the agreed design and the
rulings made on it (#253, athena 2026-10-12). Reviewers: `themis`; runtime review `daedalus`; design check `athena`.

## 1. Package and file boundary

lib-authority:

| File | Role |
|---|---|
| `src/gate/argv.ts` | new: `argvPath`, `enabledProposedApiIds` |
| `src/gate/save-watch.ts` | new: `savedAndClosed` |
| `src/gate/setup-ports.ts` | new: `SetupTexts`, `GateEditor`, `GateIdentity`, `setupPortsOf` |
| `src/gate/vscode-setup.ts` | new: `gateEditorOf`, the only file of the gate that touches `vscode` |
| `src/testing/recording-setup-ports.ts` | new: a recording `SetupPorts` for the extensions' tests |
| `src/index.ts` | export lines for the above |
| `package.json` | unchanged: the existing `./testing/*` entry covers the new testing file |
| `test/unit/gate-argv.test.ts`, `gate-save-watch.test.ts`, `gate-setup-ports.test.ts`, `gate-vscode-setup.test.ts`, `recording-setup-ports.test.ts` | new |

remote-ssh:

| File | Role |
|---|---|
| `identifiers.json` | add one `internal` entry: `{"id": "remote-oss.gate.claim", "role": "called", "kind": "query"}`, appended by hand after the last entry; no other line of the file changes |
| `src/activation.ts` | the gate between the log channel and the commands (section 2) |
| `src/extension.ts` | the editor wiring (section 2) |
| `l10n/bundle.l10n.json` and the 14 `l10n/bundle.l10n.<locale>.json` | six new keys, each with its English text as the value in every file (the stand-down strings' pattern) |
| `test/unit/activation.test.ts`, `test/unit/skeleton.test.ts` | rows added or adjusted |

Nothing else. No new dependency: no package gains a third-party runtime dependency (#253 Q2).

## 2. Contract

### Order at activation (`activation.ts`)

Stand-down guard, then the log channel, then the gate, then the commands. Nothing is registered before the gate has
probed; on `standing` nothing at all opens. Opening the log channel registers nothing (accepted #253, recorded in
`brief-lib-authority.md` 4ed9569).

```ts
// ActivationInputs gains:
gate: (logFailure: (message: string) => void) => SetupPorts;
// the 'serving' result gains:
proposals: {granted: readonly ProposalName[]; missing: readonly ProposalName[]};  // from the probes, in probe order
setup: SetupRun['interaction'];  // the user's part; activation does not wait for it
```

- The ports are made once the channel is open, `logFailure` writing to it.
- `runSetup(ports, true)` runs once. The probes are captured by wrapping `ports.probe`, never probed twice.
- When `missing` is not empty, one line at info: `Missing proposed APIs: <names joined by ", ">` (provisional text,
  remote-oss/remote-ssh#88 question 4).
- Every command this package serves today is registered whatever the probe found (F-3903 rule 4: Show Log, the help
  commands). No resolver, tunnel factory or terminal listener is registered by this card.

### argv.json (`argv.ts`)

- `argvPath`: `<portable folder>/argv.json` when the portable folder is set and not empty, else
  `<home>/<dataFolderName>/argv.json` (F-1403 §3).
- `enabledProposedApiIds(text, report)`: the in-house reader (#253 Q2). It strips `//` and `/* */` comments and drops a
  trailing comma before `]` or `}`, all **only outside strings**, in one scan that honours escapes, then
  `JSON.parse`. A leading BOM is dropped. No text (no file) lists nothing silently. A parse error, or an
  `enable-proposed-api` that is not an array, lists nothing and reports once. An array keeps its string entries and
  reports once if it dropped any. Never throws.

### Ports over the editor (`setup-ports.ts`, `vscode-setup.ts`)

- The location is resolved **lazily, inside `argvEnabled`**, never at activation (athena 2026-10-12): when the
  editor's `dataFolderName` cannot be found (product.json unreadable), `argvEnabled` reports one line through
  `logFailure` and lists nothing; the probe still decides. Activation never fails because of it.
- `argvEdited` settles `true` only for a save and then a close of **the resolved argv.json itself**: the document's
  path compared with the resolved path after `path.resolve`, case-folded when the platform is `win32` or `darwin`
  (the platform passed in, not read inside the module). A file of the same name elsewhere is ignored.
- The window claim is `windowClaimOf` over `registerCommand`/`executeCommand` with the extension's own
  subscriptions (§3.4).
- The family list: installed extensions whose id starts with `remote-oss.` and whose manifest declares at least one
  proposal.
- The flags: two booleans in the extension's global state (dismissed, attempt pending), never synced.

### Texts (`extension.ts`, `l10n/`)

The six texts of F-1403 §6, with Remote - SSH's own id in the failed-attempt text, are keys of the l10n bundle and
reach `setupPortsOf` through `vscode.l10n.t` (athena 2026-10-12; not plain constants). They stay provisional until
remote-oss/remote-ssh#88 answers; a change of wording is then a change of these keys.

| Name in `SetupTexts` | Text |
|---|---|
| `setup` | `{0} needs proposed VS Code APIs that {1} has not enabled for it. Add {2} to 'enable-proposed-api' in argv.json, then restart {1}.` |
| `failedAttempt` | `The previous setup attempt did not enable the proposed APIs {0} needs. Check that 'enable-proposed-api' in argv.json lists '{2}', then restart {1}.` |
| `restart` | `Quit and start {1} again to apply the changes to argv.json.` |
| `configureButton` | `Configure Runtime Arguments` |
| `notNowButton` | `Not Now` |
| `quitButton` | `Quit {1}` |

`{0}` is the display name, `{1}` the editor's application name (`env.appName`), `{2}` the quoted id list or the
extension's own id. `l10n.t` is called with the template only; the placeholders are filled by `setupPortsOf`.

## 3. Test table

Rows the PR must show, besides the existing ones (one assertion per `it`):

| Given | Expected |
|---|---|
| activation with the other extension running | `standing`; no channel, no probe, no registration |
| activation, all proposals granted | `proposals.missing` `[]`; no `Missing proposed APIs` line; the six commands registered |
| activation, `resolvers` and `tunnels` missing | the line `Missing proposed APIs: resolvers, tunnels`; the six commands still registered |
| the event order of a serving activation | channel lines, then the probe, then the registrations |
| a gate whose `argvEnabled` cannot find the data folder | activation serves; one failure line; commands registered |
| `enabledProposedApiIds('{"enable-proposed-api": ["a,]"]}')` | `['a,]']` |
| athena's list (#253 Q2): a comment inside a string; `//` in a URL; a block comment over lines; a trailing comma in an array and in an object; a BOM; an empty file; a missing key; a key that is not an array; an array with non-strings | as section 2 says, one report at most per read |
| `argvEdited`: the resolved file saved then closed / closed unsaved / a same-named file elsewhere saved and closed | `true` / `false` / not settled by it |
| `argvEdited` on `win32` with the path in another case | `true` |
| `identifiers.json` | `pnpm check-identifiers` green with the claim entry |
| the string tables | `pnpm check-layout` green: the six keys in all 15 bundles |

## 4. Rule for the worker

As card log-01; coverage at the packages' ratchets (100/100/100); `extension.ts` and `vscode-setup.ts` stay thin
enough that the ports carry every branch.

## 5. Gates and review

PR #260, title `Remote - SSH: the proposed-API gate runs at activation`, Part of #139.

## 6. Open rows

None for the code. The texts and the log line wait on remote-oss/remote-ssh#88 and change by key when it answers.
