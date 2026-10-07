# Coding brief: lib-ssh process side (S3, S9, S10) — slice 1, build-order step 8

> Issued by `remote-architect` 2026-10-07; the PM allocates the seat (a Claude task; S9's pure lease and ownership
> logic may become a card once S3 exists). Design: `contracts.md` §4 (S3, S9, S10; S7 and S8 are slice 2 except the
> askpass environment S3 needs), `local-connection-server.md`, `adr-drafts/local-connection-server.md` and
> `adr-drafts/host-channel.md`. Depends on: `lib-host` (H1, the contract suite), `lib-helper` (X1–X3; the Claude
> remainder #56 must be in), the pure parts of `lib-ssh` (S1, S2, S4, S5, S6; cards #50–#55), `lib-log`, and the
> acceptance harness (#47) for the real-`sshd` tests. Binding: ADR-0002, 0003, 0004 (the native client, spawned;
> never an SSH implementation), 0007, 0008.

## What is built

| Component | Content |
|---|---|
| S3 session-spawner | `spawn(invocation, askpassEnvironment)`: the editor's environment passed unchanged, stdin a pipe, `SSH_ASKPASS_REQUIRE` never set; a session with output, error and input streams and the exit status; failures `spawnFailed`, `clientVanished` as values. The connect wait: timeout plus 2 s, started at spawn in shared mode, paused while a prompt is open, restarted after each answer, counting external-askpass time, stopped at the first setup report; `ConnectTimeout 0` bounded per R-79 (the bound is a policy value, not a literal in code). |
| S9 connection-server | Over `lib-helper`: one helper per host string exactly as written (per-profile registry, `graceAfterLastLease` with the SSH value 2–4 s that carries a reload); `acquire` returns a lease with the SOCKS port, the shared record (remote port, OS, architecture, temp folder, connection token; written only after the connection completes) and an S10 over the connection; `release`, `kill` (silent, also when nothing runs), events `waitingForOtherWindow`, `ownerChanged`, `transportLost`; login ownership by the oldest live lease and hand-over; not used when `remote.SSH.useLocalServer` is off or socket mode is on. The helper script: a bundled entry (esbuild, separate entry point) that embeds `lib-helper`'s runtime and S3, and nothing of the UI. |
| S10 ssh-host-channel | H1 over a lease of S9 or a direct S3 session: `runScript` runs `sh` (POSIX; `powershell` per V1's interpreter later), input as text on stdin or a streamed local file; `copyToHost` by `scp` through S2 and S3 as a hidden task so core's trust gate applies; `identity` = the host string; `platformHint` from R4 (passed in); the per-operation failure-kind table (H1 follow-up) added here and checked by the contract suite. |
| Askpass endpoint (the part of S7 that S3 needs) | The `SSH_ASKPASS` route: a bundled askpass script that forwards the prompt text to the owning extension host through the helper and returns the answer; the external askpass kept only in shared mode; no `DISPLAY` injected; nothing stored or logged. The UI itself (S7's pickers and inputs) is slice 2: in slice 1 the harness answers prompts through the recording adapter, and key-based login needs none. |

## Behaviour to get right

- Unit, with fakes (a fake process spawner recording options and feeding scripted stdout/stderr/exit; the lib-helper
  fake endpoint; the lib-host recording channel): every rule in `contracts.md` §4 S3 and S9, each a named test; the
  connect-wait state machine with a fake clock (start, pause on prompt, restart on answer, external-askpass time
  counted, stop at setup report, the `ConnectTimeout 0` bound); the S9 lease order and hand-over on owner release
  (F-2102 BR-5); the record written only after completion; `kill` idempotent; `acquire` refused by configuration
  (useLocalServer off, socket mode).
- Contract: S10 passes the `lib-host` contract suite against (a) the recording fake of a session and (b) in the
  harness, the real `sshd` container (the suite's harness flag `reachesClientFiles` false for SSH).
- Acceptance (harness, slice 1 ACs that this step proves end to end once R1 exists; written now against S10 directly):
  F-2101 (client lookup and `-V` check), F-2102 (one connection server per host string across two windows; kill),
  F-2105 (connect timeout: an unreachable TEST-NET address fails within timeout plus 2 s), F-2305/F-2306 are slice 2
  (key login in slice 1 shows no prompt), F-2401/F-2403/F-2409 belong to `lib-server`'s brief but run over this S10.
- Security rules the tests assert: no prompt answer in any log line or record; the askpass endpoint accepts only the
  helper's nonce; the control socket mode 0600; no `SSH_ASKPASS_REQUIRE`.

## Open, decided for this brief

- Windows clients (named pipes, a script as `SSH_ASKPASS`, the helper's survival): provisional (lab), D-60; implement
  the POSIX forms, leave the Windows forms behind the same ports with a clear failure, and list them in the PR body.
- The login-shell mode of `runScript` (dossier question 10): the two-mode bootstrap confirmed by the room (script on
  stdin to a POSIX login shell; otherwise `sh` after sourcing `~/.profile`) lives in V1; S10 only runs what V1 hands
  it with the interpreter it names.

## Done

Gates green; the contract suite green against the fake and the container; the slice-1 acceptance tests above green in
CI; library convention; ADR-0008 in comments and README; PR body answers R1–R6 and lists the provisional Windows forms.
