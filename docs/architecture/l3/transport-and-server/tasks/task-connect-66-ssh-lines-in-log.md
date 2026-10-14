# Task card connect-66: one ssh-stderr pipeline, logged live, marked and filtered by level

Issue: #845. Release 0.2, **gating** (athena's F-2003 scope ruling, register 2bb86d6). F-2003 (`remote-oss/remote-ssh#13`)
BR-6 item 6, BR-8, BR-9 point 1, AC-24, and AC-12's ssh half. Size: M. Builder: `task:claude`.

**Build once:** athena's ruling makes this card the **only** place ssh's error stream is collected and logged.
- connect-60 (#833) narrows the classifier's window. Its classifier reads its pre-authentication lines from this
  pipeline's collected lines.
- connect-64 (#840) logs the failure cause. With this card in place, it logs only `ssh exited with status <n>` and the
  failure line, never the stderr lines again.
- Whichever of the three lands second removes the duplication; §4 says how.

## 1. The gap

- **Shared mode:** the helper reads ssh's error stream (`lib-ssh/src/connection-server/handler.ts:256,304`), classifies
  it, and sends the window nothing of it.
- **Terminal mode:** the login terminal's lines are read by the step and dropped.
- **What the spec asks:**
  - BR-8 (debug): every ssh error-stream line except the `debug1:` lines, plus the server host-key `debug1:` line.
    lib-ssh's `logLinesOf` (`diagnostics/classify.ts:155`) is exactly that filter.
  - BR-9 point 1 (trace): every line.

## 2. The pipeline

1. **Collected once, per connect.**
   - **Shared mode:** the helper keeps ssh's error-stream lines in order, as `SshLines`, a new small class in
     `lib-ssh/src/connection-server/ssh-lines.ts`:
     - `add(line)`;
     - `all(): readonly string[]`;
     - `beforeAuthentication(): readonly string[]`: the lines before the first line starting with `Authenticated to `
       (connect-60's window).
   - **Terminal mode:** the terminal step keeps the login terminal's lines before `LAYER1-READY` in the same class.
2. **Sent to the window live (shared mode):**
   - **The event:** a new `ConnectionEvent`, `{type: 'sshLines'; lines: string[]}` (`messages.ts`), carrying the lines
     added since the last event. It's sent at most every 100 ms and with at most 200 lines, from ssh's start until the
     helper ends.
   - **After `connected`:** lines ssh writes later reach every lease that holds the connection, for example a
     forward's `administratively prohibited`, which BR-8 keeps.
   - **An older helper** that never sends the event is accepted; the window then just logs no ssh lines.
3. **Logged live, in the window:**
   - **The function:** `sshLogLines(lines, level)` (`remote-ssh/src/pipeline/ssh-log.ts`, new, pure) gives
     `[ssh] <masked line>`. At `debug` it keeps `logLinesOf(lines)`; at `trace` it keeps every line.
   - **The level:** read as the lines arrive (BR-10).
   - **Masking:** the connection token, through `log-content.ts`'s `masked`.
   - **Writing:** at `info`, through the connect's logger. In shared mode, by the `connection-step`'s lease listener;
     in terminal mode, by the terminal step as it reads each line.
4. **Read by the classifiers, from the same lines:**
   - lib-ssh's `classify` is called with `SshLines.beforeAuthentication()` (connect-60's window), in the helper and in
     the terminal step. Nothing else is fed to it.
   - No second collection of stderr exists after this card. Remove any other buffer that holds ssh's error lines for
     classification (`handler.ts`'s own array, `terminal-connection-step.ts`'s lines for `failureOf`), and point those
     uses at `SshLines`.
5. **ADR-0010:** these lines are logged and never parsed by the logging. After authentication, remote stderr that ssh
   forwards may be among them; it's logged as `[ssh]` output, which is what BR-6 item 6 calls it, and the classifier
   never reads it (step 4).

## 3. Rows

| File | Name | Given | Expected |
|---|---|---|---|
| `ssh-log.test.ts` | `F-2003 BR-8: at debug only the host-key debug1 line is kept` | `debug1: Reading configuration data /x`, `debug1: Server host key: ssh-ed25519 SHA256:abc`, `debug1: Next authentication method: publickey`, `Authenticated to h ([127.0.0.1]:22) using "publickey".`, `Warning: Permanently added 'h' (ED25519) to the list of known hosts.` | `[ssh] debug1: Server host key: …`, `[ssh] Authenticated to …`, `[ssh] Warning: …` |
| `ssh-log.test.ts` | `F-2003 BR-9 point 1: at trace every line is kept` | the same | all five, prefixed |
| `ssh-log.test.ts` | `F-2003 BR-14: the token is masked` | a line containing the token | the masked form |
| lib-ssh `ssh-lines.test.ts` | `connect-60's window: the lines before Authenticated to` | lines before and after `Authenticated to h …` | `beforeAuthentication()` holds only the earlier ones; `all()` holds every line |
| lib-ssh `handler.test.ts` | `F-2003 BR-6 item 6: the helper sends ssh's lines live` | a fake ssh writing 3 lines, then success | `sshLines` events with the 3 lines, in order, before `connected` |
| lib-ssh `handler.test.ts` | `F-2003 BR-8: a later ssh line reaches every lease` | `channel 3: open failed: administratively prohibited: open failed` after `connected`, two leases | one `sshLines` event to each |
| lib-ssh `handler.test.ts` | `ADR-0010: the classifier reads only the lines before authentication` | `Permission denied (fridge)` after `Authenticated to` | the classification doesn't change |
| `connection-step.test.ts` | `F-2003 BR-6 item 6: the window logs each line once` | two `sshLines` events, then `loginFailed` | each line logged once, in order |
| `terminal-connection-step.test.ts` | `F-2003 BR-6 item 6: terminal mode logs the login's ssh lines` | the lines before `LAYER1-READY` | logged as `[ssh] …`, by level |

**Acceptance** (`tests/acceptance/windows`, `connectionLog()`):
- `F-2003 BR-8: at debug the log holds ssh's lines without debug1`: a connect to `harness` at `debug` logs
  `[ssh] Authenticated to`, and no `[ssh] debug1:` line except the host-key line;
- `F-2003 BR-9 point 1: at trace the log holds ssh's debug1 lines`: the same with `remote.SSH.logLevel` `trace` logs
  `[ssh] debug1:` lines;
- `F-2003 AC-24: a refused connect logs ssh's refusal line verbatim`: the `refused` alias logs a line that starts with
  `[ssh] ` and ends with `Connection refused`, at `debug` and at `trace`.

## 4. With connect-64 and connect-60 (whichever lands second)

- **If connect-64 lands first,** this card removes its stderr lines from `loginFailed` and from the window's failure
  log. connect-64's remaining lines are `ssh exited with status <n>` and the failure line, and its rows that assert
  the `[ssh]` lines re-cite this card's.
- **If connect-60 lands first,** this card moves its "lines before `Authenticated to`" window onto
  `SshLines.beforeAuthentication()`, keeping connect-60's rows.
- **If this card lands first,** connect-64 and connect-60 build on `SshLines` and `sshLines`, as their amended cards
  say.

## 5. Gates and review

Run all gates and the VSCodium run. PR title `lib-ssh, remote-ssh: one ssh-stderr pipeline, logged live, marked and
filtered by level (card connect-66, #845)`. Request athena only.
