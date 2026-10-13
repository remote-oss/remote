# Task card tooling-19: cutting and restoring the host's network (D-85)

Issue: #491. Why: D-85 (the user, on #142). **Network cut** is the capability for F-2206 AC-27 and AC-35 and F-2304 AC-19, AC-20 and
AC-31: a connection that breaks the way a dropped network breaks it, with packets lost and no reset, then a network
that comes back. Builder: iris. Size: S.

## 1. Files

| File | Change |
|---|---|
| `tests/acceptance/suite/harness.ts` | `cutNetwork()`, `restoreNetwork()` (section 2) |
| `tools/acceptance-run.ts` | the run's own Docker network (section 2), labelled and removed like the container |
| `tools/acceptance-run.test.ts` | rows for the network's create and clean-up arguments |
| `tests/acceptance/server/network-cut.test.ts` | new: the capability rows (section 3) |
| `tests/acceptance/README.md` | the two helpers and what they do |

## 2. The mechanism

The cut must be a lost network, not a closed one:
- an `ssh` session open across the cut sees no reset; it stalls until its own keep-alive or timeout gives up;
- a new connection to the host's port during the cut gets no answer;
- after the restore, a new connection works again on the **same** local port, because the editor's window and the
  `ssh_config` keep it.

Measure in this order and keep the first that meets all three, as section 3's rows prove:
1. **Pause the container's network path:** run the container on a network of its own (`docker network create`, with the
   run's label), and cut with `docker network disconnect <network> <container>`, restore with `docker network connect`.
   Check that the published port binding comes back after `connect`. If it doesn't, try (2).
2. **Drop the packets inside the container:** the image gets `iptables`, the container starts with `--cap-add
   NET_ADMIN`, and `cutNetwork()` runs `iptables -I INPUT -p tcp --dport 22 -j DROP` and `iptables -I OUTPUT -p tcp
   --sport 22 -j DROP` through `docker exec` as root. `restoreNetwork()` deletes the same two rules.

`docker pause` isn't a network cut, because it also freezes the server's processes. Don't use it.

Every launch that cuts must restore before it ends: a `finally`, and the run's clean-up restores too. `cutNetwork()`
and `restoreNetwork()` are idempotent. The README says which mechanism the run uses, and why.

## 3. Capability rows (`tests/acceptance/server/network-cut.test.ts`, plain Node)

One assertion per `it`, over the host fixture.

| Name | Given | Expected |
|---|---|---|
| `D-85: a session open across the cut gets no reset` | an `ssh -o ServerAliveInterval=0 harness 'cat'` session, `cutNetwork()`, input sent, 5 s | the process is still running and printed no error |
| `D-85: a new connection during the cut gets no answer` | `cutNetwork()`, then `ssh -o ConnectTimeout=3 harness true` | exit 255 with `timed out` in its error output, not `refused` or `reset` |
| `D-85: after the restore a new connection works on the same port` | `cutNetwork()`, `restoreNetwork()`, `ssh harness true` | exit 0 |
| `D-85: cutting twice and restoring twice is harmless` | `cutNetwork()` twice, `restoreNetwork()` twice, `ssh harness true` | exit 0 |

## 4. Gates and review

The repository's gates. `pnpm test:acceptance:server` passes; paste its summary and the mechanism kept in the PR body.
PR title `tests: cutting and restoring the harness host's network (card tooling-19, D-85)`. proteus reviews: if it's
(2), it changes the container's capabilities, on the CI runner too.
