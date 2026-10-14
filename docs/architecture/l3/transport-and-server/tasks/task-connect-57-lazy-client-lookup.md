# Task card connect-57: a reload through a running local connection server runs no client lookup

Issue: #815. Release 0.2, **gating**: F-2101 AC-14 (`remote-oss/remote-ssh#19`; 6.4 step 2, BR-9) is a slice-1
criterion. Ruled by athena on #714 (2026-10-14). Size: M. Builder: assigned by hermes (`task:claude`: lib-helper and
the acquire change). Measured by selene in coverage-31 (#813). Its windows row 2 is this card's acceptance proof.

## 1. The defect

**The rule:**
- **6.4 step 2:** "No lookup and no version check happen at all, and the configured program is not run, even when
  `remote.SSH.path` has meanwhile been changed to an invalid value; the window connects through the existing server."
- **BR-9:** the lookup runs once per resolver run, "before a new local connection server" is started, and is
  "skipped entirely when a running local server for the host is reused".
- **F-2105 6.7 and AC-27:** a reload or a second window that reuses the running connection starts no new ssh and no
  new connect-timeout wait.

**What main does** (selene, `tests/acceptance/windows/client-search.test.ts`, row 2, with `remote.SSH.path` set to a
failing fake and the window reloaded):
- the helper is kept: the same pid before and after;
- but the reload ran `fails/ssh check`, and logged `Checking ssh client: …/fails/ssh` and `Checking ssh client: ssh`.

**The cause:** `pipeline/connect.ts` runs `steps.locateClient(input)` before `steps.openConnection(...)` on every
connect, in both modes. The shared connection step then builds the acquire request from what the lookup left in
`ConnectState` (`connectionRequestOf` → `runBaseOf`, which throws when `programs` or `effective` is missing).
`wiring.ts` computes the helper limits from `lookedUp(state).connectTimeout` before the acquire as well.

## 2. The design (athena: lazy, never a "is a helper running?" pre-check)

A separate check before the acquire races with the helper's end. So the decision is the acquire's own claim: the
lookup runs inside the acquire, only on the path that claims the key and starts a helper.

### 2.1 lib-helper (`client/acquire.ts`)

- `AcquireRequest` replaces `options` and `payload` with
  `prepare: () => Promise<PreparedStart<Refusal>>`, where
  `PreparedStart<Refusal> = {kind: 'ready'; options: Record<…>; payload: Record<…>} | {kind: 'refused'; refusal: Refusal}`.
  `AcquireRequest` and `AcquireOutcome` take the type parameter `Refusal`.
- **The record:** the claim writes the record with an **empty payload, `{}`**, and nothing rewrites it. A per-user
  registry holds no secret beyond the nonce (`types.ts`; athena on #816). The prepared payload may hold effective ssh
  options such as `ProxyCommand`, `SetEnv` or `RemoteCommand`, so it never goes into the registry file.
- **The prepared payload's path:** `start(environment, request, record)` calls `request.prepare()` after the claim and
  before the spawn, once. Its `options` and `payload` reach the helper only through the spawn's parameters:
  `spawnSpecification`'s `HelperParameters`, carried in `REMOTE_OSS_HELPER_PARAMETERS` (`client/spawn.ts`), never in
  argv. The helper serves the payload in its welcome (`runtime/serve.ts`), as it does today.
- **Joiners** read the payload from the welcome, `lease.payload` (`client/lease.ts`), exactly as `socksPort` is read
  today. `HelperRecord.payload` is no longer read by any client.
- `{kind: 'refused', refusal}` → remove the record, as the `spawnFailed` path does, so the key is free at once, and
  return the new `AcquireOutcome` member `{kind: 'refused'; refusal: Refusal}`.
- A cancellation that lands during `prepare` → remove the record, then `{kind: 'failed', failure: 'cancelled'}`.
- The `existing` and `replaceStale` → `existing` paths never call `prepare`.
- **Other callers of `acquire`:** on main, lib-ssh's `acquireConnection` is the only one (grep `acquire(` in
  `packages/*/src`). If another has appeared, it passes `prepare: async () => ({kind:
  'ready', options, payload})` with today's values, so its behaviour is unchanged.

### 2.2 lib-ssh (`connection-server/client.ts`)

- `ConnectionAcquireRequest.options` becomes
  `prepare: () => Promise<{kind: 'ready'; options: Omit<ConnectionHelperOptions, 'socksPort' | 'recordFile'>; runFacts: RunFacts} | {kind: 'refused'; refusal: Refusal}>`.
- `RunFacts` is a new exported type: `{sshProgram: string; scpProgram: string; effective: EffectiveOptions}`, the
  lookup's results.
- `acquireConnection` passes a `prepare` to lib-helper. When it's called:
  - it takes the free SOCKS port;
  - it calls the request's `prepare`;
  - on `ready`, it adds `socksPort` and `recordFile` to the options, and returns the payload
    `{socksPort, runFacts: JSON.stringify(runFacts)}` to lib-helper. lib-helper hands it to the helper through the spawn
    parameters, never into the record (§2.1).
- `AcquireConnectionOutcome` gains `{kind: 'refused'; refusal: Refusal}`.
- `ConnectedState` (the `connect` outcome) gains `runFacts: RunFacts`, read from `this.lease.payload.runFacts` (the
  welcome's payload) and parsed. A missing or unparsable value fails the connect as `{kind: 'helperRefused', reason: 'no run facts'}`, as a
  missing SOCKS port does today.
- `ConnectionLimits` reach `SharedConnection` as a function, `limits: () => ConnectionLimits`, called when the login
  wait starts, so a joining window's limits can be decided after the acquire (§2.3).

### 2.3 remote-ssh

- **`ConnectSteps.lookupBeforeConnection(): boolean`** (`steps.ts`): true in terminal mode
  (`ports.locate.mode() === 'terminal'`), false in shared mode. In `connect.ts`:
  - **true:** `locateClient` runs where it runs today, and its `waits` are used. Terminal mode is unchanged.
  - **false:** `locateClient` isn't called before `openConnection`. The shared step runs it inside `prepare`, and
    `ConnectionLease` gains `waits: ConnectWaits`, which `connect.ts` uses instead.
- **The shared connection step** (`connection-step.ts` and `wiring.ts`):
  - `requestFor(input, terms)` returns `{folder, script, policy, prepare}`.
  - `prepare` runs the locate step (the same `locateClientStep`, with its logs). A failed lookup is
    `{kind: 'refused', refusal: <the StepFailure>}`. A done lookup builds `connectionRequestOf(...)`'s options from the
    state the lookup filled, and returns `runFacts` from `state.programs` and `state.effective`.
  - **`refused` from the acquire** → `{kind: 'failed', failure: <the refusal>}`, so the lookup's own failure (S009,
    the classifier's reason, a timeout) reaches the dialog as it does today.
  - **`acquired`, then `connected`:** if `state.effective` is still unset (a joining window), fill `state.programs`
    and `state.effective` from `outcome.runFacts`. Every later `lookedUp(state)` then has the running connection's
    values: the first window's lookup, the same as the helper's own ssh.
  - **`waits`:** `connectWaitsFor(effectiveConnectTimeoutSeconds(state.effective.connectTimeout,
    connectionSettings().connectTimeout))`, computed after `connected`.
- **The limits:** `limits: () => connectionLimitsFor(state.effective?.connectTimeout,
  connectionSettings().connectTimeout)`.
  - When this window starts the helper, `prepare` has filled `state.effective`, so it's today's value.
  - When it joins, it's the setting's value alone. The joining window waits on the other window's login under the
    helper's own wait, and F-2105 6.7 starts no new wait for a reuse. This bound only stops a joiner waiting forever.
- **`locate-step.ts`** doesn't change.

## 3. Rows

**lib-helper (`acquire.test.ts`):**

| Cite | Given | Expected |
|---|---|---|
| F-2101 BR-9 | a free key | `prepare` called once, before the spawn; the spawn's parameters carry the prepared options and payload |
| lib-helper `types.ts` (no secret in the registry) | a start, then a join | the record file's `payload` is `{}`; the starter's and the joiner's `lease.payload` both hold the prepared values (from the welcome) |
| F-2101 6.4 | an existing, live helper | `prepare` never called; the lease joins |
| F-2101 6.4 | a stale record replaced by a live one (`replaceStale` → `existing`) | `prepare` never called |
| F-2101 BR-9 | `prepare` refusing `'r'` | outcome `{kind: 'refused', refusal: 'r'}`; no spawn; the record file is gone |
| contracts | cancellation during `prepare` | `cancelled`; the record file is gone; no spawn |

**lib-ssh (`connection-client.test.ts` or the file that tests `acquireConnection`):**

| Cite | Given | Expected |
|---|---|---|
| F-2101 BR-9 | a start | the spawn parameters' payload holds `socksPort` and `runFacts` (JSON of the prepared facts); the record file's payload is `{}` |
| F-2101 6.4 | a join, then `connect` | `connected.runFacts` equals the starter's facts |
| contracts | a payload without `runFacts` | `connect` fails `helperRefused` `no run facts` |
| contracts | `refused` from `prepare` | `acquireConnection` gives `{kind: 'refused', refusal}` |

**remote-ssh:**

| File | Cite | Given | Expected |
|---|---|---|---|
| `connect.test.ts` (pipeline fixture) | F-2101 AC-14 | shared mode; the acquire joins a running helper whose facts set `connectTimeout 7` | `locateClient` never called; the connect completes; the probe's bound is `connectWaitsFor(7).probeMilliseconds` |
| `connect.test.ts` | F-2101 BR-9 | shared mode; the acquire starts a helper | `locateClient` called once, inside the acquire, before the spawn |
| `connect.test.ts` | F-2101 7.E4 (S009) | shared mode; the lookup finds no client | the connect fails with `prerequisiteMissing` `S009`, as today; no helper spawned |
| `connect.test.ts` | F-2101 6.5 step 3 | terminal mode | `locateClient` is called before `openConnection`, as today |
| `wiring.test.ts` | F-2105 6.7 | a joining window, the setting 15 | the limits are `connectionLimitsFor(undefined, 15)`; a starting window's are those of its lookup |

**Defect rule:** the first remote-ssh row must fail on main and pass with the fix. Paste both runs.

**Acceptance proof:** selene's coverage-31 windows row 2, `F-2101 AC-14: a reload through a running helper runs no
client and keeps the helper, and the close ends it` (`tests/acceptance/windows/client-search.test.ts`). It's taken out
of #813 and handed to this card (athena on #714). Add it in this PR as it stands in #813, with its fake clients (#813's
`tools/acceptance-clients.ts`, if #813 has merged; otherwise wait for #813). It must fail on main and pass with the
fix. In the same PR, `F-2101.AC-14` goes from `todo` to `acceptance` in `coverage-slice1.tsv`.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-consumed,
check-coverage, check-licences and coverage, with the changed files at 100 %. Also run the full VSCodium run, and
`pnpm test:acceptance:server` (the real helper). Use the PR title
`lib-helper, lib-ssh, remote-ssh: a reuse of a running local connection server runs no client lookup (card connect-57, #815)`.
Request athena only; hermes assigns the peer.

## 5. Open rows (stop and report on #815)

1. A step after `openConnection` needs `state.programs` or `state.effective` before `connected` returns, on the join
   path. Name it.
