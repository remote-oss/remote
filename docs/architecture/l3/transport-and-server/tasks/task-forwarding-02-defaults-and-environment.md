# Task card forwarding-02: default forwarded ports and environment tunnels (pure decisions)

Brief: slice 2 (build-order). Contract: `../contracts.md` §6 W3 (`environmentTunnels`) and W4 (`applyDefaults`), §3 S4
(`LocalForward` entries as `effectiveOptions` returns them). Reviewing coder: `remote-coding-worker-1`. Depends on
card forwarding-01 (the package `packages/lib-forwarding`, its `src/index.ts`, tsconfig pair and `coverage.json`)
being merged. This card builds the pure parts of W3 and W4 only: reading the setting value, mapping the forwards,
and the rule of when defaults apply. Opening tunnels (`openTunnel`) and reading the configuration belong to the
extension and are not here.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-forwarding/src/defaults/entries.ts` | `parseDefaultForwards` and its types |
| `packages/lib-forwarding/src/defaults/environment.ts` | `environmentTunnels` and its types |
| `packages/lib-forwarding/src/defaults/policy.ts` | `shouldApplyDefaults` |
| `packages/lib-forwarding/src/index.ts` | add the exports of the three modules (the only edit to an existing file) |
| `packages/lib-forwarding/test/unit/defaults-entries.test.ts` | new |
| `packages/lib-forwarding/test/unit/defaults-environment.test.ts` | new |
| `packages/lib-forwarding/test/unit/defaults-policy.test.ts` | new |

Nothing else may change (no `package.json`, no `tsconfig*`, no `knip.jsonc`; `coverage.json` only through
`pnpm coverage:update`). No `node:net`, no `vscode`, no `lib-ssh` import: the forwards arrive as plain strings.

## 2. Contract

```ts
// entries.ts
export interface TunnelRequest { remoteHost: string; remotePort: number; localPort: number; label?: string }
export type SkipReason = 'notAnObject' | 'missingRemotePort' | 'invalidRemotePort' | 'duplicateRemotePort';
export interface SkippedEntry { index: number; reason: SkipReason }
export interface DefaultForwards { requests: TunnelRequest[]; skipped: SkippedEntry[]; settingProblem?: 'notAnArray' }
export function parseDefaultForwards(settingValue: unknown): DefaultForwards;

// environment.ts
export interface EnvironmentAddress { host: string; port: number }
export interface EnvironmentTunnel { remoteAddress: EnvironmentAddress; localAddress: EnvironmentAddress }
export type ForwardSkipReason = 'badShape' | 'badPort' | 'localSocket' | 'remoteSocket' | 'bracketedIpv6';
export interface SkippedForward { index: number; reason: ForwardSkipReason }
export interface EnvironmentTunnels { tunnels: EnvironmentTunnel[]; skipped: SkippedForward[] }
export function environmentTunnels(localForwards: readonly string[]): EnvironmentTunnels;

// policy.ts
export function shouldApplyDefaults(attempt: number, isReconnection: boolean): boolean;
```

The reasons are the log reason ids of W4 ("invalid entries are skipped and logged"); the caller logs them. `index` is
the position in the input list.

`parseDefaultForwards` rules. The setting holds objects `{remotePort, localPort?, name?}`; the specs name no other
entry shape (no bare numbers, no `local:remote` strings, no host-qualified strings). `undefined` gives empty lists.
A value that is not an array gives empty lists and `settingProblem: 'notAnArray'`. For each entry in list order:
- not an object (a number, string, `null`, array) is skipped, `notAnObject`;
- `remotePort` absent (or `undefined`) is skipped, `missingRemotePort`;
- `remotePort` that is not a whole number from 1 to 65535, or a string of ASCII digits (no sign, no blanks) that
  reads to such a number, is skipped, `invalidRemotePort`; a numeric string is accepted and read as the number;
- a `remotePort` already taken by an earlier accepted entry (after reading numeric strings) is skipped,
  `duplicateRemotePort`; the first stays;
- otherwise a request: `remoteHost` `'localhost'`, `remotePort`, `localPort` = the entry's `localPort` when it is a
  whole number from 1 to 65535, else the remote port, and `label` = `name` when it is a non-empty string (the
  property is absent otherwise).

`environmentTunnels`: each input is the text `<listen> <target>` as `LocalForward` appears in S4 (single or repeated
blanks between the two). `<listen>` is `port`, `bind:port` or `[bind]:port`; `<target>` is `host:port` or
`[host]:port`. A bracketed part is unwrapped when its inside holds no `:`. Output per accepted input, in input order:
`remoteAddress` = the target host and port as written; `localAddress` = host `'localhost'` when there is no bind
address or the bind is `localhost`, otherwise the bind as written, and the listen port. Skips, with the index:
`badShape` (not exactly two blank-separated parts, or a part without the needed pieces), `badPort` (a port that is
not ASCII digits reading to 1 to 65535), `localSocket` (a listen part containing `/`), `remoteSocket` (a target
part containing `/`), `bracketedIpv6` (a bracketed part whose inside holds `:`). Checks run in the order listed.

`shouldApplyDefaults`: true when the resolve is not a reconnection; false on a reconnection, whatever the attempt.

## 3. Test table

A row marked (each) is one `it` per listed input. A test name starts with the cite. Rows marked (provisional) rest on
a spec reading (the choice of option (b) in the spec's open question on invalid entries), not a confirmed answer;
they are tested like any other row.

### 3.1 `parseDefaultForwards`

| Cite | Given | Expected |
|---|---|---|
| F-2507.BR-2 | `[{name:'web', remotePort:8000, localPort:18000}]` | requests `[{remoteHost:'localhost', remotePort:8000, localPort:18000, label:'web'}]`, no skipped |
| F-2507.AC-3 | `[{remotePort:8001}]` | `[{remoteHost:'localhost', remotePort:8001, localPort:8001}]` (no `label` property) |
| F-2507.AC-3 | `[{remotePort:8005, localPort:8003}]` | local port 8003 |
| F-2507.BR-2 | the three entries of the spec's example in one list | three requests, in list order |
| F-2507.AC-14 | `[{remotePort:'8001'}]` | remote port 8001 (a number), local port 8001 |
| F-2507.AC-15 | `[{remotePort:8000, localPort:1}, {remotePort:8000, localPort:2}]` | one request (local port 1); skipped `[{index:1, reason:'duplicateRemotePort'}]` |
| F-2507.AC-15 | `[{remotePort:'8000'}, {remotePort:8000}]` | one request; skipped index 1 `duplicateRemotePort` |
| F-2507.AC-13 (provisional) | `[{name:'missing', localPort:18010}, {remotePort:8001}]` | requests `[8001]`; skipped `[{index:0, reason:'missingRemotePort'}]` |
| F-2507.AC-13 (provisional) | `[{remotePort:undefined}]` | skipped index 0 `missingRemotePort` |
| F-2507.7.E4 (provisional) | (each) `remotePort` of `0`, `65536`, `-1`, `80.5`, `'80x'`, `''`, `' 80'`, `'+80'`, `null`, `true`, `{}` | skipped index 0 `invalidRemotePort` |
| F-2507.7.E4 (provisional) | (each) entries `8000`, `'8000'`, `null`, `[]`, `undefined` in a list | skipped `notAnObject` at their index |
| F-2507.BR-2 (provisional) | `[{remotePort:'x'}, {remotePort:8000}, {remotePort:8000}]` | one request; skipped index 0 `invalidRemotePort` and index 2 `duplicateRemotePort`, in that order |
| F-2507.BR-2 (provisional) | `[{remotePort:'x'}, {remotePort:'x'}]` | both skipped `invalidRemotePort` (an invalid entry takes no port) |
| F-2507.BR-2 (provisional) | (each) entry with `name` of `''`, `5`, `null` | request without a `label` property |
| F-2507.BR-2 (provisional) | (each) entry with `localPort` of `0`, `70000`, `8000.5`, `'9000'`, `null` | request whose local port equals the remote port |
| F-2507.BR-2 | `[]` | `{requests:[], skipped:[]}` |
| F-2507.BR-5 | `undefined` | `{requests:[], skipped:[]}` (no `settingProblem`) |
| F-2507.BR-5 (provisional) | (each) `null`, `'8000'`, `8000`, `{remotePort:8000}` | requests `[]`, skipped `[]`, `settingProblem:'notAnArray'` |
| F-2507.BR-7 | the same list parsed twice | deep-equal results, input list not modified |

### 3.2 `environmentTunnels`

| Cite | Given | Expected |
|---|---|---|
| F-2507.AC-23 | `['127.0.0.1:13000 127.0.0.1:8000']` | `[{remoteAddress:{host:'127.0.0.1', port:8000}, localAddress:{host:'127.0.0.1', port:13000}}]` |
| F-2507.AC-24 | `['13002 localhost:8000']` | remote `localhost:8000`, local `localhost:13002` |
| F-2507.BR-10 | `['localhost:13003 127.0.0.1:8001']` | remote `127.0.0.1:8001`, local `localhost:13003` |
| F-2507.AC-24 | `['13004 db.invalid:22']` | remote `db.invalid:22`, local `localhost:13004` |
| F-2507.AC-35 | `['13002 localhost:8000']` | one tunnel only (no second one for another loopback) |
| F-2507.BR-10 | `['8080 [127.0.0.1]:80']` (the form `ssh -G` prints) | remote `127.0.0.1:80`, local `localhost:8080` |
| F-2507.BR-10 (provisional) | `['[127.0.0.1]:13000 [127.0.0.1]:8000']` | remote `127.0.0.1:8000`, local `127.0.0.1:13000` |
| F-2507.BR-10 | `['13000   h.invalid:80']` (repeated blanks) | remote `h.invalid:80`, local `localhost:13000` |
| F-2507.BR-10 | two valid inputs | two tunnels in input order |
| F-2507.6.2 (provisional) | `['/tmp/f.sock 127.0.0.1:8000']` | no tunnel; skipped `[{index:0, reason:'localSocket'}]` |
| F-2507.6.2 (provisional) | `['13005 /tmp/r.sock']` | no tunnel; skipped `remoteSocket` |
| F-2507.6.2 (provisional) | (each) `['[::1]:13006 [::1]:8000']`, `['13007 [::1]:8000']`, `['[::1]:13008 h.invalid:80']` | no tunnel; skipped `bracketedIpv6` |
| F-2507.BR-10 (provisional) | (each) `'70000 h:80'`, `'0 h:80'`, `'abc h:80'`, `'13000 h:abc'`, `'13000 h:0'`, `'13000 h:'`, `'-5 h:80'` | skipped `badPort` |
| F-2507.BR-10 (provisional) | (each) `''`, `'13000'`, `'13000 h:80 extra'`, `'13000 h80'`, `':13000 h:80'`, `'13000 :80'`, `'[h 13000'` | skipped `badShape` |
| F-2507.BR-10 (provisional) | `['13000 h:80', 'x', '13001 h:81', '/s h:1']` | tunnels for the first and third; skipped `[{index:1, reason:'badShape'}, {index:3, reason:'localSocket'}]` |
| F-2507.BR-10 | `[]` | `{tunnels:[], skipped:[]}` |
| F-2507.BR-7 | the same list mapped twice | deep-equal results, input not modified |

### 3.3 `shouldApplyDefaults`

| Cite | Given | Expected |
|---|---|---|
| F-2507.BR-4 | `(1, false)` | true |
| F-2507.6.1 | `(1, false)` after a reload (the same call as a fresh connect) | true |
| F-2507.6.5 | `(2, true)`; `(3, true)` | false (each) |
| F-2507.BR-5 | `(1, true)` | false |
| F-2507.BR-5 (provisional) | `(2, false)`; `(3, false)` | true (each; a retry is not a reconnection) |
| F-2507.AC-33 | (each) `(attempt, true)` for attempt 1 to 5 | false |

Row count: 3.1 has 19 rows, 3.2 has 17, 3.3 has 6: 42 rows.

## 4. Rule for the worker

- Tests first. Write all tests from section 3, one `it` per row (per input for an (each) row), the name starting with
  the cite. Run `pnpm test:unit`, then write the modules to the signatures of section 2, exactly; no behaviour
  beyond the table, no export that no test uses.
- Do not change a signature or this contract. Do not add behaviour or tests for anything in section 6; stop and
  report at such a case.
- Names (ADR-0003): every identifier, properties included, at least four characters (the reason ids, `host` and
  `port` are fine). No `const` arrow helpers (`func-style`). Comments only where the guide requires them; none of them
  carries a feature, rule or decision id or says where a rule came from (ADR-0008); ids may appear in test names.
- No duplicated code: the two port checks (entries and forwards) share one helper if their rules are the same
  whole-number test, and the bracket unwrapping for the listen and the target part is one function.
- Coverage of the three modules: 100 % lines, branches and functions; run `pnpm coverage:update`.
- Gates: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
  `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: `remote-coding-worker-1`. PR title `lib-forwarding: default forwards and environment tunnels (card
forwarding-02)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each cite to its
test name; it lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

1. The spec leaves the choice between reproducing the reference's rough edges and skipping invalid entries and
   Unix-socket or bracketed IPv6 forms open. This card follows the lead's contract line (invalid entries skipped and
   logged) and the spec's recommended option; every skip row is marked (provisional). Question: confirm option (b)
   and the reason ids.
2. `localPort` that is present but invalid (`0`, `70000`, a string): skip the entry, or fall back to the remote
   port as the card does (provisional, the row exists in 3.1)? Question: confirm the fallback, or a new reason.
3. `shouldApplyDefaults` ignores `attempt`. Question: should the parameter go (the contract of W4 names only
   reconnection)? The rows hold with it.
4. Two `LocalForward` inputs with the same destination: the reference shows one row. This card returns both
   tunnels. Question: does the function drop one (which), or does the consumer?
5. A default entry whose remote port is already statically forwarded takes the static local address. That is decided
   by the tunnel service of the editor and not here; confirm that `applyDefaults` needs no input from
   `environmentTunnels`.
6. Listen parts with a wildcard or empty bind (`*:13000`, `:13000`, `0.0.0.0:13000`): the card writes the bind as
   written into the local host. Not tested. Question: map `*` and the empty bind to something?
7. The exact text OpenSSH prints for a `LocalForward` with a bind address (`ssh -G`): bracketed or bare. The card
   accepts both; the bracketed row is (provisional) until a recording from card ssh-03's fixtures confirms it.
8. The setting's accepted entry shapes: only objects are specified. Question: are bare port numbers or
   `local:remote` strings wanted as an extension?
9. Setting precedence (user, remote, folder) and reading the setting are the extension's; not part of this card.
