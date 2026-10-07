# Task ssh-05: the stderr classifier (S5)

Base: branch `feature/lib-ssh-pure` (HEAD_SHA), brought to the contract. The modules exist; this card writes their tests and fixes what fails.

## 1. Package and file boundary

| File | Role |
|---|---|
| `packages/lib-ssh/src/diagnostics/classify.ts` | `classify`, `logLinesOf`, `endWithFullStop` |
| `packages/lib-ssh/src/diagnostics/rules.ts` | the texts and the priority table (data; tested through `classify`, no test file of its own) |
| `packages/lib-ssh/test/unit/diagnostics-classify.test.ts` | new |
| `packages/lib-ssh/test/fixtures/stderr/recorded.json` | new, a list of `{source, errorLines, exitStatus}` |

Nothing else may change. Fixture origin: recorded with the worker's own OpenSSH against `nosuch.invalid`, 127.0.0.1 port 1, and 192.0.2.1 (TEST-NET-1) with `-F /dev/null -o BatchMode=yes -o ConnectTimeout=1`; `source` holds the command and the `ssh -V` banner. Keep the lines exactly as printed; nothing local appears in them. Expected values of the recorded rows are those of the table row for the text found in the line (a local network may print "Operation timed out" where another prints "Connection timed out"; record what is printed and take the matching row).

## 2. Contract

`contracts.md` section 3, heading "### S5 stderr-classifier", operation `classify` ("ssh's error lines of one run, in order; the run's exit status; the purpose; the connection mode (`shared` or `terminal`)" to a kind, a reason and hints). The contract governs. Branch signature:

`classify(errorLines: readonly string[], exitStatus: number | undefined, purpose: 'connection'|'tunnel'|'oneShot'|'copy', mode: 'shared'|'terminal'): Classification` with `Classification = {kind, reason?: {id}|{text}, hints: FailureHint[], logLines: string[]}`; `FailureHint = {status, message: string|{id,values}, details?: {id}|{text}, mitigations: {id,values}[], resources: string[]}`. `logLinesOf(errorLines: readonly string[]): string[]`; `endWithFullStop(text: string): string`. Reasons are string ids (`S094`...); a test pins ids, not texts.

Defaults: exit status 255, purpose `connection`, mode `shared`. `OFF(Sxxx)` stands for the hint list `[{status:'OfflineError', message:'Error: OfflineError', details:{id:'Sxxx'}, mitigations:[], resources:[]}]`. A row asserts the fields it names; "plain" means `hints []` and `logLines []`. (each) means one `it` per listed input.

## 3. Test table

| Cite | Given (error lines) | Expected |
|---|---|---|
| F-2603.BR-3 | `ssh: connect to host 192.0.2.1 port 22: Network is unreachable` | kind unreachable, reason S094, hints OFF(S094) |
| F-2603.BR-3 | `ssh: Could not resolve hostname nosuch.invalid: Name or service not known` | unreachable, S032, OFF(S032) |
| F-2603.BR-3 | `ssh: connect to host h port 22: The process tried to write to a nonexistent pipe` | unreachable, S142, OFF(S142) |
| F-2105.BR-10 | `ssh: connect to host 192.0.2.1 port 22: Connection timed out` | kind timeout, S137, OFF(S137) |
| F-2105.BR-10 | `ssh: connect to host 192.0.2.1 port 22: Operation timed out` | timeout, S140, OFF(S140) |
| F-2603.BR-3 | `ssh: connect to host h port 22: No route to host` | unreachable, S097, OFF(S097) |
| F-2603.BR-3 | `ssh: connect to host h port 22: Can't assign requested address` | unreachable, S014, OFF(S014) |
| F-2603.BR-1 | `prefix Network is unreachable suffix` | S094 (any position in the line) |
| F-2603.7.E2 | (each, both line orders) Network is unreachable + Could not resolve hostname; Network is unreachable + No route to host; Could not resolve hostname + the pipe text | S094; S094; S032 |
| F-2603.7.E2 | (each, both orders) the pipe text + Connection timed out; Connection timed out + No route to host; Connection timed out + Operation timed out; Operation timed out + No route to host; No route to host + Can't assign requested address | S142; S137; S137; S140; S097 |
| F-2603.7.E2 | all seven texts, one per line, in table order and in reverse | S094 both times |
| F-2603.7.E1 | (each) `network is unreachable`; `no route to host`; `Cannot assign requested address`; `Connection refused`; `Host is down` | kind unknown, plain |
| F-2603.BR-1 | `ssh: Could not resolve host x` (no `name`) | unknown, plain |
| F-2205.BR-6 / F-2205.9 | purpose connection, `ssh: hostname contains invalid characters` | kind unreachable, reason S079, hints `[{status:'InvalidHostName', message:'Error: InvalidHostName', details:{id:'S079'}, mitigations:[], resources:[]}]` |
| F-2205.BR-6 | (each) purpose oneShot, tunnel, copy, the same line | kind unknown, plain |
| F-2306.BR-13 | `debug1: x`, `lab@127.0.0.1: Permission denied (publickey,password).` | kind authentication, reason `{text:'Permission denied (publickey,password).'}` |
| F-2306.BR-13 | `Permission denied, please try again.`, `x@h: Permission denied (password).  ` (trailing blanks) | authentication, `{text:'Permission denied (password).'}` |
| F-2306.BR-13 | `x@h: Permission denied (publickey).`, then `x@h: Permission denied (password).` | the later line: `Permission denied (password).` |
| F-2306.BR-13 | `Permission denied (keyboard-interactive).` (no prefix) | `{text:'Permission denied (keyboard-interactive).'}` |
| F-2306.BR-13 | `Permission denied, please try again.` alone | unknown, plain |
| F-2305.AC-16 | mode shared: `@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@`, `Host key verification failed.` | kind hostKeyChanged, reason S111 |
| F-2305.AC-18 | mode terminal, the same two lines | kind hostKeyRejected, no `reason` |
| F-2305.BR-6 | mode shared, the first line alone | hostKeyChanged, S111 |
| F-2305.BR-6 | mode terminal, the first line alone | unknown, plain |
| F-2305.AC-21 | (each) mode shared, mode terminal: `Host key verification failed.` | hostKeyRejected, no `reason`, plain |
| F-2604.BR-1 | mode shared: `channel 2: open failed: administratively prohibited: open failed` | kind forwardingDisabled, no `reason`; one hint with status `AllowTcpForwardingDisabled`, message `{id:'S150', values:[]}`, mitigations `[{id:'S005', values:['AllowTcpForwarding yes','/etc/ssh/sshd_config']}, {id:'S116', values:[]}]`, exactly one entry in `resources`; `logLines ['S046']` |
| F-2604.AC-11 | the same line in mode terminal | the same result as in mode shared |
| F-2604.BR-2 | the same line three times, with different channel numbers | one hint, `logLines ['S046']` once |
| F-2604.BR-6 | mode terminal: `Warning: Port forwarding is disabled to avoid man-in-the-middle attacks.` | forwardingDisabled, reason S107, hints `[{status:'MitmPortForwardingDisabled', message:'Error: MitmPortForwardingDisabled', details:{id:'S107'}, mitigations:[], resources:[]}]`, `logLines []` |
| F-2604.BR-6 | mode shared, the same line | unknown, plain |
| F-2305.AC-19 | mode terminal: the changed-key warning line, then the port forwarding line above | forwardingDisabled, S107 |
| F-2603.7.E3 | `packet_write_wait: Connection to x port 22: send disconnect: Broken pipe` | kind brokenPipe, no `reason`; one hint `{status:'SendDisconnectBrokenPipe', message:'Error: SendDisconnectBrokenPipe', mitigations:[], resources:[]}`, no `details` |
| F-2603.7.E3 | the Windows pipe text (above) | unreachable S142, not brokenPipe |
| F-2105.BR-10 | no lines, with exit status 255, 0 and `undefined` (each) | kind unknown, no `reason`, plain |
| F-2109.BR-5 | a debug line and a notice line that match no text | unknown, plain |
| S5 contract | lines `Enter passphrase for key '/home/dev/.ssh/id_x': `, `Password: hunter2`, `Network is unreachable` | S094; `JSON.stringify` of the result contains neither `hunter2` nor `/home/dev` |
| S5 contract | the same two prompt lines and no other text | unknown; the result contains neither |
| F-2603.BR-10 | `endWithFullStop('The connection timed out')`; `('Permission denied (password)')` | the text plus `.`; the text plus `.` |
| F-2603.BR-10 | (each) `endWithFullStop` of `Der Hostname konnte nicht aufgelöst werden.`, `Really?`, `Wow!`, `日本語。`, `x．`, `x！`, `x？` | unchanged |
| F-2603.BR-1 | recorded fixture lines | each classified as the matching row above |
| F-2604.7.E1 | `Connection closed.` | kind channelClosed, reason `{text:'Connection closed.'}`, plain |
| F-2604.BR-1 | `channel 3: open failed: connect failed: open failed` | kind unknown, no `reason`, plain |
| F-2604.7.E1 | `Connection closed by 192.0.2.1 port 22` | kind unknown, no `reason`, plain |
| F-2605.6.2 | `x@h.invalid: Permission denied (password).` | kind authentication, hints `[{status:'PermissionDenied', message:'Error: PermissionDenied', details:{text:'Permission denied (password).'}, mitigations:[], resources:[]}]` |
| F-2601.5.0 | `Host key verification failed.` | kind hostKeyRejected, plain |
| F-2305.BR-6 | mode shared: `@@@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @@@`, then `Warning: Port forwarding is disabled to avoid man-in-the-middle attacks.` | kind unknown, no `reason`, plain |
| F-2109.BR-4 | `logLinesOf` of `debug1: Server host key: ssh-ed25519 SHA256:abc`, `debug1: Authenticating to h.invalid:22`, `debug2: x`, `Warning: y` | `['debug1: Server host key: ssh-ed25519 SHA256:abc', 'debug2: x', 'Warning: y']` |
| F-2109.BR-4 | `logLinesOf([])` | `[]` |

## 4. Rule for the worker

- Record the fixture first; write all tests from the table, one `it` per row (per input for an (each) row), the name starting with the Cite. Run `pnpm test:unit`; fix a module only where a row fails and only to meet that row.
- Never change an exported signature or the contract. Do not add behaviour or tests for anything in section 6.
- Comments only where the Google TypeScript guide requires them; no F-/R-/D- ids or origin framing in code comments or JSDoc (ids may appear in test names). Every identifier at least four characters, properties included. No duplicated code (table loops, one helper for the two line orders); no unused exports.
- Coverage for both files at least 90 % lines, 85 % branches, 90 % functions; report unreached branches, do not delete them.
- Full gate list: `pnpm identifiers`, `pnpm check-layout`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test:unit`, `pnpm dupes`, `pnpm dead`, `pnpm coverage`, `pnpm check-licences`.

## 5. Gates and review

Reviewer: remote-coding-worker-1. PR title: `lib-ssh: tests and fixes for the stderr classifier (task-ssh-05)`. The description answers R1 to R4 and R6 in one line each, and R5 by a list mapping each Cite to its test name; it states the OpenSSH version of the recording, lists the section 6 rows hit and the tail of each gate's output.

## 6. Open rows (stop and report)

Sent to the lead with a proposed answer; until the answer is written into section 3, the worker stops here.

| # | Case | Question and proposed answer |
|---|---|---|
| 3 | Priority between classes beyond the decided pairs (changed key over rejected key in shared mode, F-2305.AC-16; the forwarding warning in terminal mode, F-2305.AC-19): a denied line with a network text, a changed key with a network text | Proposed: keep the branch order (changed key, rejected key, denied, invalid name, network, forwarding, broken pipe, closed connection); a denied line with `No route to host` is `authentication` |
| 6 | The identifier of the forwarding hint's documentation resource (F-2604.AC-3 asks for the project's own URL, still open) | Proposed: keep the topic key `hangingOrFailingConnections`; the extension maps it to the URL |
| 8 | The exit status: does a status of 0 or `undefined` with a recognised line classify? | Proposed: yes, the status never changes the result (F-2604.BR-3 records the hint while the window still waits) |
| 10 | `hostKeyChanged` hints: no spec lists one | Proposed: none |
