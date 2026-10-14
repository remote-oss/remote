# Task card connect-55: terminal mode connects through a live ControlMaster

Issue: #814. Release 0.2, **gating**: F-2102 AC-26 (`remote-oss/remote-ssh#20`, 6.8 step 5) is a slice-1 criterion
that fails (athena's ruling on #576). Size: S. Builder: selene. Found by hestia's coverage-16 (#576, PR #797), and
measured by daedalus.

## 1. The defect

**The rule:** F-2102 AC-26. Given `remote.SSH.useLocalServer` is `false` and a live ControlMaster for the host, when the
window reloads, then it connects without a password.

**What happens** (measured on the `windows` launch, alias `master` = `ControlMaster auto`, a `ControlPath`, `ControlPersist
600`):
1. `m1` connects in shared mode, and the helper's `ssh` becomes the master.
2. The setting is set to `false`, and `m1` reloads.
3. The record shows `Setting up SSH Host master` and `Initializing VS Code Server` 1 ms apart, then nothing.
4. The connection log ends at `Using ssh client: ssh`, and `m1` isn't connected after 60 s.

hestia saw the same cycle repeat as core retried.

**Cause:**
- In terminal mode the window's `ssh` runs with `-v` in the `install` terminal (lib-ssh `buildInvocation`,
  `attemptOptions`). With a live master it doesn't log in: it's a **mux client**. Its `-v` output, measured with OpenSSH
  10.2p1, plain and with `-tt`, is only:

  ```
  debug1: auto-mux: Trying existing master at '<ControlPath>'
  debug1: mux_client_request_session: master session id: <n>
  ```

  So there's no `debug1: SSH2_MSG_NEWKEYS received` and no `Authenticated to … using "…".`
- `packages/remote-ssh/src/pipeline/terminal-connection-step.ts` (the `LineSplitter` callback, about line 241) starts
  the session only on `setupMarkerOf(line) === 'authenticated'` (lib-ssh `diagnostics/setup-report.ts`). That line
  never comes.
- The step's connect wait has already stopped at the first output (`onFirstOutput: wait.stop()`). `PromptReader`'s
  bound reports `unreachable` only for an unterminated partial line, and the mux client's lines all end. So nothing
  ever ends the attempt.

**Not the cause:**
- The tunnel's second `ssh` works through the mux: measured with `-v -L` and the tunnel command, the success line comes
  and the forward answers.
- connect-51's fix (#782, `node-spawner.ts`) doesn't touch this path. Terminal mode's `ssh` runs in an editor
  terminal, not through the spawner.

## 2. The fix

In `packages/lib-ssh/src/diagnostics/setup-report.ts`, `setupMarkerOf` also answers `'authenticated'` for a line that,
with one trailing `\r` removed, starts with `debug1: mux_client_request_session: master session id: `.

**Measured with the fix:** the same probe on the `windows` launch, with only this change applied locally, connects
`m1` after the reload. Without the fix it isn't connected after 60 s.

**Why that line counts:** a mux client prints it once the master has accepted its session request. The master is
already authenticated, so the session runs as a login's would. A mux client that can't reach the master (a stale
socket) falls back to a real login, which prints the usual `Authenticated to` line, so nothing else changes.

**What else stays as it is:**
- **Constants:** keep the prefix as a named constant beside `AUTHENTICATED_START`, with a one-line JSDoc.
- **Terminal step:** `terminal-connection-step.ts` doesn't change; it already starts the session on the marker.
- **The `handshake` marker:** unchanged. A mux client has no key exchange, and `PromptReader` uses `handshake` only to
  tell a question after the key exchange, which a mux client doesn't ask.

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| lib-ssh `setup-report.test.ts` | `F-2102 AC-26: a mux client's session line is the authenticated marker` | `debug1: mux_client_request_session: master session id: 7`, and the same with a trailing `\r` | `'authenticated'`, twice |
| lib-ssh `setup-report.test.ts` | `F-2102 AC-26: the mux client's other lines are no marker` | `debug1: auto-mux: Trying existing master at '/home/u/.ssh/cm/abc'`; `debug1: mux_client_request_session: entering` | `undefined`, twice |
| lib-ssh `setup-report.test.ts` | `F-2102 AC-26: the first marker of a mux client's run` | `firstSetupMarker` over the measured two lines above | `'authenticated'` |
| remote-ssh `terminal-connection-step.test.ts` | `F-2102 AC-26: a mux client's session line starts the session, as a login's would` | the fixture's terminal writes `debug1: auto-mux: Trying existing master at '/c'\ndebug1: mux_client_request_session: master session id: 3\n`, then the bootstrap's ready line, as the existing `#299` row does after its `AUTHENTICATED` | the step hands over its lease (`done`) |

**Defect rule:** all four rows fail on main and pass with the fix. Paste both runs.

**Acceptance proof:** hestia's AC-26 row (#576 §2 row 4, in `tests/acceptance/windows/controlmaster.test.ts` on
`coverage-16`) goes back in once this merges. Its builder runs it before tagging F-2102 AC-26 `acceptance`.

## 4. Catalogue

No tag changes here. coverage-16's row tags F-2102 AC-26.

## 5. Gates and review

Run all gates: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers, check-coverage and coverage,
with the changed files at 100 %. Use the PR title
`lib-ssh: terminal mode connects through a live ControlMaster (card connect-55, #814)`. Request athena only; hermes
assigns the peer.

## 6. Open rows (stop and report on #814)

1. A test on main asserts that a `mux_client_request_session` line is no marker. Name it.
