# Task card ssh-28: the window's `scp` gets `-v` and the connect timeout, as `ssh` does

Why: #253 Q13, ruled by athena (contracts §S2, 5e23b9c). `copyInvocation` (lib-ssh `arguments/invocation.ts`) gives
`scp` only `-F`, `--` and its two operands. Two of S2's rules for every run don't reach it:
- **`-v`**, which the copy terminal of Q11 (b) needs: the prompt reader arms its unreachable-question bound only after
  the handshake marker `debug1: SSH2_MSG_NEWKEYS received`, and `scp` prints it only with `-v` (checked on OpenSSH
  10.2p1 on a pty: both markers appear and the copy exits 0).
- **`-o ConnectTimeout=<n>`** when the host sets none: without it, a copy to an unreachable address waits for the
  system's own limit (still waiting at 25 s); with `-o ConnectTimeout=2`, it fails in 2.0 s, exit 255,
  `ssh: connect to host … Connection timed out`.

Ruled: both, by `ssh`'s own rules, before `--`. Nothing else reaches `scp`: no `-T`, no `RemoteCommand=none`, no
forwards. The process copy gets them too. Reviewing coder: `remote-coding-worker-1`.

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/arguments/invocation.ts` | one private helper for the two options, used by both paths (section 2) |
| `packages/lib-ssh/test/unit/invocation.test.ts` | the copy rows change, rows added (section 3) |

Nothing else.

## 2. Contract

A private function in `invocation.ts`:

```ts
/** The options every run of an attempt carries: the log level the diagnostics read, and the connect timeout when the host sets none. */
function attemptOptions(request: InvocationRequest): string[];
```

It returns `['-v']`, followed by `'-o', 'ConnectTimeout=<settings.connectTimeout>'` when
`request.effective.connectTimeout === undefined`. That is exactly the two steps `buildInvocation` does today for `ssh`
after the optional `-T`; `buildInvocation` now calls `attemptOptions` there instead (so the `ssh` arguments are
unchanged, in the same order).

`copyInvocation` builds `[...common, ...attemptOptions(request), '--', localFile, host:path]`, where `common` is the
`-F` part as today. The program, the environment and the IPv6 bracketing are unchanged.

## 3. Test table

One assertion per `it`; the cite starts the name. `makeCopyRequest()`'s settings have `connectTimeout` 15 and its
effective options no `connectTimeout`.

| Cite | Given | Expected arguments |
|---|---|---|
| F-2405 BR-6, #253 Q13 | `makeCopyRequest()` (the existing row) | `['-v', '-o', 'ConnectTimeout=15', '--', '/tmp/boot.sh', 'alias:/tmp/x/boot.sh']` |
| F-2405 BR-6 | `makeCopyRequest({configFile: '/etc/custom/config'})` (the existing row) | `['-F', '/etc/custom/config', '-v', '-o', 'ConnectTimeout=15', '--', '/tmp/boot.sh', 'alias:/tmp/x/boot.sh']` |
| F-2105 BR-2, #253 Q13 | a copy whose effective options carry `connectTimeout: '7'` | no `ConnectTimeout` option: `['-v', '--', '/tmp/boot.sh', 'alias:/tmp/x/boot.sh']` |
| F-2105 AC-9 | a copy with the setting's `connectTimeout: 0` | contains `'ConnectTimeout=0'` |
| #253 Q13 | a copy whose effective options carry a `remoteCommand` and `remoteCommandInEffect` false | no `RemoteCommand=none` |
| #253 Q13 | a copy with `permitPtyAllocation: false` | no `-T` |
| S2 | every existing `ssh` row | unchanged |

Update the other existing copy rows (`makeCopyRequest` is used 7 times) to the new arguments: each gains
`'-v', '-o', 'ConnectTimeout=15'` right before `'--'`. The IPv6 row keeps its bracketed host.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: the window's scp gets -v and the connect timeout (card ssh-28)`.

## 6. Open rows

None. Ruled on #253 Q13 (contracts §S2, 5e23b9c).
