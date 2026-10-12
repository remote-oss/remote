# Task card ssh-19: the invocations of terminal mode's tunnel and install runs (terminal mode T3)

Why: athena's terminal-mode brief (`brief-terminal-mode.md`, T3; 0.2 blocker #299). S2 builds every `ssh` argument
list. Terminal mode needs two runs S2 can't build yet: the **tunnel** run of the secondSsh and socket paths
(F-2104 6.2 step 4, 6.8 step 4), and the **install** run with the user's own forwards cleared when dynamic forwarding
is off (F-2104 6.2 step 1). The install connection's `sh` with `-T` is already built (row "F-2704.BR-1: a terminal
connection keeps -T and runs the program"). Reviewing coder: `remote-coding-worker-1`.

All the behaviour below was checked against a real OpenSSH sshd (OpenSSH 10.2p1, 2026-10-12, daedalus):
- the tunnel command prints `Connected to SSH Host - Please do not close this terminal` and its `-L` forward carries
  traffic;
- `ClearAllForwardings=yes` drops a host block's `LocalForward`, **and also a `-L` given on the command line**. So it
  may only go on a run that carries no forward of ours (section 2.2).

## 1. Package and file boundary

| File | Change |
|---|---|
| `packages/lib-ssh/src/arguments/invocation.ts` | the tunnel run's options and command, the install run's clearing (section 2) |
| `packages/lib-ssh/test/unit/invocation.test.ts` | the sweep widened, rows added (section 3) |

Nothing else. The ConnectWait needs no change here: its owner starts and stops it, and terminal mode's
"stop at the first output" (F-2105 BR-3) is the owner's call, in T5.

## 2. Contract

### 2.1 The tunnel run (`purpose: 'tunnel'`)

Today a `tunnel` run drops `remoteProgram`. It now always ends with its own fixed command (athena's ruling in the
brief: a remote command in place of `-N`, so the success line is the host's own output, F-2308 BR-10):

```ts
/** What the tunnel run runs on the host: the line that says it is up, then a wait that holds the forward. */
export const TUNNEL_COMMAND =
  "echo 'Connected to SSH Host - Please do not close this terminal'; exec sleep 2147483647";
```

- A `tunnel` run adds **no** `ExitOnForwardFailure` (amended 2026-10-12, athena; brief a5b7917). F-2104 BR-11
  applies the user's own forwards to the tunnel ssh, and BR-12 ends that ssh on a failing user forward only when the
  user's host entry sets `ExitOnForwardFailure` itself. Forcing it would fail the connect for every user with a
  forward of their own that can't bind, where ssh otherwise only warns. Our own `-L` doesn't need it: W1 checked the
  port, and T7's 10 s readiness wait catches a tunnel that never carries traffic.
- It ends with `TUNNEL_COMMAND` after the host, whatever `remoteProgram` says (a caller's `remoteProgram` is still
  ignored for a tunnel, as today).
- No `-N`. (The brief's component text still says "`-N` (card adds it)"; that line predates the ruling below it that
  replaced `-N` with this command, and the ruling wins. It is flagged for athena to fix.)
- Everything else of a tunnel run stays: `-F`, `-v`, `ConnectTimeout` when the host sets none, `RemoteCommand=none`
  rules, the forwards, `--` and the host.

### 2.2 The install run's clearing

`SshRequest` gains:

```ts
/** Whether the user's own forwards are dropped on this run: the install run when dynamic forwarding is off. */
clearUserForwards?: boolean;
```

- When `clearUserForwards` is true, the run adds `-o ClearAllForwardings=yes` (F-2104 6.2 step 1: on the secondSsh
  path the install connection doesn't act on the user's `LocalForward`, `DynamicForward` or `RemoteForward`).
- **It is refused together with forwards of ours.** `ClearAllForwardings` also clears command-line forwards (checked
  above), so a request with `clearUserForwards: true` **and** a non-empty `forwards` is a defect. `buildInvocation`
  throws `Error('clearUserForwards would also clear the run's own forwards')`. The dynamic-forwarding path's install
  run carries our `-D`, so it never sets this; T5 sets it only on the secondSsh and socket paths' install run.
- Only a `connection` run may set it; on any other purpose it is ignored (no option added).

### 2.3 S2's "never add" list

Contracts §S2's list ("Never: add `ControlMaster`, … host-key, identity or proxy options") is unchanged. The two new
options are neither, and are scoped as above.

## 3. Test table

One assertion per `it`; the cite starts the name. Rows use the file's `makeRequest`.

### 3.1 The option sweep

`forbiddenOf` allows, after `-o`, `RemoteCommand=none` and `ConnectTimeout=…` today. It now also allows exactly
`ClearAllForwardings=yes` (one more literal value, not a prefix). The sweep row ("ADR-0004.2: no option beyond the
listed ones, in every purpose and setting") is the one existing row that changes: it fails on the new option until
the allowed list has it. The sweep thereby also keeps `ExitOnForwardFailure` out of every run. `forbiddenSweep` also
gains one extra build per purpose, `makeRequest({purpose, forwards: [], clearUserForwards: true})`, after its loop over
`SETTING_VARIANTS` (it can't be a variant: the loop adds `ALL_FORWARDS`, which would make it throw).

### 3.2 Rows added

| Cite | Request | Expected |
|---|---|---|
| F-2308 BR-10 | `purpose: 'tunnel'` | the last argument is `TUNNEL_COMMAND` |
| F-2308 BR-10 | the same | `slice(-3)` is `['--', 'alias', TUNNEL_COMMAND]` |
| brief, #299 | `purpose: 'tunnel'`, `remoteProgram: 'uname -s'` | the last argument is `TUNNEL_COMMAND` (the program is ignored) |
| brief, #299 | `purpose: 'tunnel'` | `-N` is not among the arguments |
| F-2104 BR-11, BR-12 | `purpose: 'tunnel'` | no argument contains `ExitOnForwardFailure` (the user's own setting decides) |
| F-2104 6.2 | `purpose: 'tunnel'` with a `local` forward to port 8080 | `-L 51001:127.0.0.1:8080` present, then `--` and the host |
| F-2410 5.0 | `purpose: 'tunnel'` with a `socket` forward | `-L 51002:/tmp/code-x.sock` present |
| F-2104 6.2 step 1 | `purpose: 'connection'`, `remoteProgram: 'sh'`, `clearUserForwards: true` | `-o ClearAllForwardings=yes` present once |
| F-2104 6.2 step 1 | the same without `clearUserForwards` | no `ClearAllForwardings` |
| F-2104 6.3 | `clearUserForwards: true` with a `dynamic` forward | throws `/would also clear the run's own forwards/` |
| brief, #299 | `purpose: 'tunnel'` with `clearUserForwards: true` and no forwards | no `ClearAllForwardings` (ignored off `connection`) |
| F-2104 BR-12 | the constant `TUNNEL_COMMAND` | equals `"echo 'Connected to SSH Host - Please do not close this terminal'; exec sleep 2147483647"` |

Checked on a prototype over main (2026-10-12): with section 2 in place, the sweep is the only existing row that
fails, and it passes once its allowed list has the one value; every expectation in 3.2 holds.

## 4. Rule for the worker

As card log-01; coverage at lib-ssh's 100/100/100 ratchet.

## 5. Gates and review

PR title `lib-ssh: terminal mode's tunnel and install invocations (card ssh-19, terminal mode T3)`.

## 6. Open rows

None.
