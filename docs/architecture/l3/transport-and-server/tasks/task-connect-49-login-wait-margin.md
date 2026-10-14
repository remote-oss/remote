# Task card connect-49: a login shell that never answers fails after the connect wait, not at the timeout

Issue: #771. Release 0.2, **gating** (F-2206 AC-28; F-2105 BR-3 and 7.E3, `remote-oss/remote-ssh#23`). Size: S.
Builder: selene. Found by iris in coverage-12 (#551), case `platform-mute-default`.

## 1. The defect

**The rule:**
- **F-2105 BR-3:** "Wait = effective timeout + 2 seconds, started when ssh is started." 7.E3 then fails the attempt
  once "timeout + 2 seconds have passed since ssh was started". The cases it lists include "a slow host whose login
  takes longer than the timeout although ssh's TCP connect succeeded".
- **F-2202 6.4:** the timeout the extension uses is the matched `ConnectTimeout` plus 2 seconds, or 17 at the default
  15.
- **F-2206 7.E5:** a login shell that doesn't answer fails "after the connect timeout (17 s, F-2304)".
- **ssh-38 (#538):** its own row says the `mute` alias fails "with the timeout failure after the connect wait".

**What main does:**
- lib-ssh's `sessionStartFor` (`packages/lib-ssh/src/connection-server/session-bootstrap.ts`) bounds the login shell's
  startup (layer 1) at `connectTimeoutSeconds`, rounded up and clamped to 1–600. A host's own `ConnectTimeout 0`
  takes the ceiling. There's no margin.
- **Shared mode:** the helper (`connection-server/helper.ts`) starts its `ConnectWait` (timeout + 2 s, from
  `connectWaitMilliseconds` in `process/connect-wait.ts`) at the spawn. Layer 1 starts only after the login and fires
  at login + timeout. So for any login under 2 s, `LAYER1-TIMEOUT` comes first.
- **Terminal mode** (`remote-ssh/src/pipeline/terminal-connection-step.ts`): `startSession` restarts the wait at the
  authentication, "which the bootstrap's bound ends first" (its comment). The same `sessionStartFor` bound makes layer
  1 fire 2 s before the wait.
- **What iris measured** on the `mute` alias (`ConnectTimeout 10`): the connect fails with `connect failed: timeout`
  10.24 s after the first progress line. The spec says 12 s.

## 2. The fix

**One length for both timers.** `sessionStartFor` takes its seconds from the connect wait itself:
`Math.ceil(connectWaitMilliseconds(settings) / 1000)`, clamped to `LAYER_ONE_SECONDS` (1–600) as today.

**Why here, not a new margin in remote-ssh:** the 2 s grace of F-2105 BR-3 already lives in one place, the
`GRACE_MILLISECONDS` of `connect-wait.ts`, which `ConnectWait` uses. Layer 1's bound and the wait must be the same
number. Deriving one from the other can't drift. A second `+ 2` in remote-ssh's bounds would put the grace in two
places.

**The consequences:**
- **A host's own `ConnectTimeout 0`:** `connectWaitMilliseconds` gives `unboundedWaitSeconds` with no grace, so the
  bound stays the ceiling (600), as today.
- **The setting's `0`:** the bound becomes 2 s (today 1). That matches F-2105 BR-4's "0 + 2 s" wait.
- **Which timer fires:** layer 1 starts after the wait in both modes, so the client's `ConnectWait` now fires first, or
  at the same moment, at timeout + 2 s. That's the 7.E3 failure. A `LAYER1-TIMEOUT` still ends a session the helper
  keeps for later windows, and its log line stays.
- **The header stays consistent:** remote-ssh's `connection-request.ts` builds the remote program's byte count from
  `sessionStartFor(connectWait).remoteProgram`, and the helper builds the prelude from `sessionStartFor(waitSettings)`.
  Both go through the same function, so the prelude and its length still agree. The existing `connection-request.test.ts`
  rows show it.
- **Comments:** fix the doc comments of `sessionStartFor` ("the login shell may take as long as the connect wait") and
  `terminal-connection-step.ts`'s comment at `wait.start()`, which says the bootstrap's bound ends first. Nothing else
  changes.

## 3. Rows

**`packages/lib-ssh/test/unit/session-bootstrap.test.ts`:** the `#443` rows change their expected bound. Rename them
to cite `F-2105 BR-3`.

| Name | Given (`ConnectWaitSettings`) | Expected |
|---|---|---|
| `F-2105 BR-3: a host's ConnectTimeout 10 bounds the login shell at the wait, 12` | `{connectTimeoutSeconds: 10, fromHost: true, unboundedWaitSeconds: 600}` | `sessionStart(12)` |
| `F-2105 BR-3: the default 15 bounds it at 17` | `{15, fromHost: false, 600}` | `sessionStart(17)` |
| `F-2105 BR-3: a setting of 7 bounds it at 9` | `{7, false, 600}` | `sessionStart(9)` |
| `F-2105 BR-3: a wait of 20 s is a bound of 22` (was 20) | `{20, false, 600}` | `sessionStart(22)` |
| `F-2105 BR-4: the setting's 0 is a bound of 2` (was 1) | `{0, false, 600}` | `sessionStart(2)` |
| `F-2105 BR-4: a host's own 0 takes the unbounded wait` (unchanged) | `{0, true, 600}` | `sessionStart(600)` |
| `F-2105 BR-3: a wait of 7.5 s rounds up to 10` (was 8) | `{7.5, false, 600}` | `sessionStart(10)` |
| `F-2105 BR-3: a wait past the ceiling is the ceiling` (unchanged) | `{5000, false, 600}` | `sessionStart(600)` |

**`packages/lib-ssh/test/unit/connection-helper.test.ts` (shared mode):** find the helper's existing request rows with
`grep -n "sessionStart\|LAYER1" packages/lib-ssh/test/unit/*.ts`. The row is
`F-2105 BR-3: the shared session's login shell is bounded at the connect wait`. A request with
`effective.connectTimeout: '10'` gives a prelude starting `LAYER1_SECONDS=12\n`.

**`packages/remote-ssh/test/unit/terminal-connection-step.test.ts` (terminal mode):** the row is
`F-2105 BR-3: the terminal session's login shell is bounded at the connect wait`. A wait of `{10, fromHost: true}` gives
a prelude written to the terminal that starts `LAYER1_SECONDS=12\n`.

**Defect rule:** every row with a changed bound must fail on main and pass with the fix. Paste both runs.

**The acceptance row:**
- coverage-12's `F-2206 AC-28 (platform-mute-default)` row asserts 10 000 ≤ elapsed ≤ 15 000 ms today (iris, on #551).
  Once this card merges, it tightens to 12 000 ≤ elapsed ≤ 15 000 ms. Say so on #551; iris or the coverage-12 builder
  makes the change.
- ssh-38's real-host `F-2206 AC-28` row, in `tests/acceptance/server/`, keeps passing. Run
  `pnpm test:acceptance:server`, and paste its line.

## 4. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with the changed files at 100 %. Use the PR title
`lib-ssh: the login shell's bound is the connect wait, timeout + 2 s (card connect-49, #771)`. Request athena only;
hermes assigns the peer reviewer.

## 5. Not in this card

The failure dialog of this timeout reads `Could not establish connection to "<alias>".`, with no reason. F-2105 7.E3,
F-2206 7.E5 and F-2601 AC-28 show `… : Connecting with SSH timed out.`, an untranslated reason that isn't in the
string table. No product source holds that text: `ofConnection`'s `timeout` and the layer-1 timeout give no reason. It
goes to the lead as a separate defect, because where an untranslated reason text lives is a design point (contracts
R1).

## 6. Open rows (stop and report on #771)

1. A row on main other than those listed in §3 asserts layer 1's bound as the connect timeout. Name it, and don't change
   its meaning.
