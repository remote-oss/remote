# Task card connect-39: agent and X11 forwarding reach the window

Issue: #676. Slice 2 (#41), in 0.2 under the standing plan, not gating (athena, register 3289d3d). Spec: F-2311
(`remote-oss/remote-ssh#44`) and F-2312 (`#45`). Size: about 3 agent-days. Builder: assigned by hermes. Build order:
after the gating cards.

## 1. What's missing

- **The settings:** `remote.SSH.enableAgentForwarding` and `remote.SSH.enableX11Forwarding` (generated names
  `enableAgentForwarding` and `enableX11Forwarding` in `identifiers.generated.ts`) are declared, and nothing reads them.
- **The pure planners exist:** `environment/agent-link.ts` (connect-08: `planAgentLink`, `linkPathFor`,
  `terminalEnvironment`) and `environment/display.ts` (connect-09: `planDisplay`, `terminalEnvironment`,
  `mergedDisplay`). Only their tests import them.
- **The facts exist:** the probe already reports the session's `host.sshAuthSock` and `host.display`
  (`lib-server/src/scripts/bootstrap.ts`), and `ProbedHost` carries them as `sshAuthSock` and `display`.
- **What nobody does:**
  - `pipeline/wiring.ts`'s `windowEnvironment` returns `extensionHostEnv: {}`;
  - no link is made on the host;
  - nothing is put in the terminal environment collection.

So on main, a window on a host with `ForwardAgent yes` or `ForwardX11 yes` gets neither `SSH_AUTH_SOCK` nor `DISPLAY`,
unless the running server happened to inherit them from the session that started it.

## 2. The rules

- **R1** (F-2311 5.0 step 3, F-2312 5.0 step 3): each connect plans with its probe's facts:
  - `planAgentLink({settingEnabled: <enableAgentForwarding is true>, forwardedSocket: host.sshAuthSock, …})`;
  - `planDisplay({settingEnabled: <enableX11Forwarding is true>, sessionDisplay: host.display, …})`.

  Both settings are booleans defaulting to `true`, so a value other than `false` counts as enabled, the way the manifest
  default reads. Read them through `connect-settings.ts` (`switchOf` reads only `true`; use
  `valueOf(...) !== false`).
- **R2** (reuse: the planners' `newConnection` and `stored`):
  - a connect that **stores** the shared record (it made the server's session) plans fresh, with `newConnection: true`;
  - a connect that finds a stored record plans with `newConnection: false` and the stored plans.

  `SharedRecord` (`lib-ssh/src/connection-server/messages.ts`) gains `agentLink?: AgentLinkPlan` and
  `display?: DisplayPlan`, read and written as plain data. Its reader treats a malformed value as absent.
  `windowLink` is the link this window made before, kept by the resolver host across a reconnection (F-2311 6.5). Draw
  with a cryptographic random integer in 1..999999999. `takenNames` is the set of `/tmp/vscode-ssh-auth-sock-*` names
  the link step lists (R4).
- **R3** (F-2311 5.0 step 4, F-2312 5.0 step 4): the remote extension host's environment is
  `{...agentLink.terminalEnvironment(plan), ...display.terminalEnvironment(plan)}`, so `SSH_AUTH_SOCK` and/or
  `DISPLAY` and nothing else. `windowEnvironment` returns it as `extensionHostEnv` instead of `{}`, through the
  probed host this connect holds: wiring keeps the probe step's `host` for the connect, as it keeps the server steps.
- **R4** (F-2311 5.0 steps 5–6; athena, register e2e9bba): with an agent plan of kind `link`, the extension creates
  the link on the host from a **hidden extension terminal**:
  - `vscode.window.createTerminal({name: 'Remote - SSH agent link', pty, hideFromUser: true})`. Its pseudoterminal's
    `open()` lists the existing `/tmp/vscode-ssh-auth-sock-*` names (for `takenNames`), then runs
    `ln -sfn -- <target> <linkPath>` in `/tmp` (whatever the user's `TMPDIR` is, F-2311 BR-4) over the connection's
    host channel (lib-host's run, the same channel the server steps use), then closes the terminal.
  - Core opens a terminal through its own trust check ([oss] `src/vs/workbench/contrib/terminal/browser/terminalInstance.ts`,
    `_createProcess` and `_trust`). That gives the spec's behaviour without code of ours:
    - no link while the trust modal is open (AC-8);
    - the link right after "Trust Folder & Continue";
    - the link with Restricted Mode after "Cancel" (AC-9);
    - the link at once with `terminal.integrated.allowInUntrustedWorkspace` `true` (AC-25);
    - step 5's own modal, raised by this step.
  - A failure of the command is logged at warn, and nothing is shown (F-2311 7.E7). The terminal closes either way.
  - The step never delays the resolve's result: it's started after the result is handed back, while the connection is
    held.
- **R5** (F-2311 3.3, F-2312 3.3, AC-6, AC-5): the window's terminal environment collection
  (`context.environmentVariableCollection`) holds exactly R3's variables, replaced for each connect of the window:
  - set with `replace(name, value)`;
  - with `persistent` `false`;
  - after `clear()` when a plan is `none`.
- **R6** (F-2311 AC-7, F-2312 AC-6): nothing of this card shows a notification, dialog, input, status item or terminal.
  Log lines only.
- **R7** (F-2311 7.E6, F-2312 7.E5): a setting changed while connected has no effect until the next connect. The plans
  are read only when the connect runs.

## 3. Changes

1. **`pipeline/connect-settings.ts`:** `agentForwardingOf(host)` and `x11ForwardingOf(host)`, by R1.
2. **`pipeline/wiring.ts`:**
   - hold the probed host per connect;
   - `windowEnvironment` takes the two plans;
   - the plans come from R1 and R2, the record's plans are stored with `storeSharedRecord` (`connect.ts` already
     calls it after the tunnel; add the two fields where that record is built);
   - the link command is a new `ConnectSteps.linkAgent(input, lease, plan)`, run by R4's pseudoterminal and started by
     `connect.ts` after the result is built, never awaited by the resolve.
3. **`lib-ssh` (`connection-server/messages.ts`):** the two optional `SharedRecord` fields and their reader.
4. **The window side** (where the resolver's result reaches the extension, beside connect-33's Ports-view key in
   `extension.ts` or `register-connect.ts`): R5's collection, from the plans the connect returns with its result. Add
   the plans to the connect's `Connection` value for this.
5. **The link terminal** (R4): a port `linkTerminals: {open(name: string, run: () => Promise<void>): void}`. Its editor
   adapter creates the hidden pty terminal whose `open()` awaits `run()` and then fires the pty's close. It's faked in
   the unit rows: the fake records the open, and calls `open` and `close` when the test says so, standing for core's
   trust check. No trust port.

## 4. Rows

**Unit rows:**

| Cite | Given | Expected |
|---|---|---|
| F-2311.AC-2 | a connect whose probe reports `sshAuthSock: '/tmp/ssh-x/agent.1'`, the setting unset | `extensionHostEnv` is `{SSH_AUTH_SOCK: '/tmp/vscode-ssh-auth-sock-<n>'}`; the link step ran `ln -sfn -- /tmp/ssh-x/agent.1 /tmp/vscode-ssh-auth-sock-<n>` once |
| F-2311.AC-10 | the same with `enableAgentForwarding` `false` | no `SSH_AUTH_SOCK`, no link step |
| F-2311.AC-11 | `sshAuthSock: ''` | no `SSH_AUTH_SOCK`, no link step |
| F-2312.AC-7 | a probe with `display: 'localhost:10.0'` | `extensionHostEnv` holds `DISPLAY: 'localhost:10.0'` |
| F-2312.AC-11 | the same with `enableX11Forwarding` `false` | no `DISPLAY` |
| F-2311.AC-2, F-2312.AC-7 | both | exactly the two variables, nothing else |
| F-2311 6.4 | a connect that finds a stored record with an agent plan and a display plan | the stored plans are used: the same link path and display, and the probe's facts are ignored |
| F-2311 5.0 step 5 | a link plan: the fake terminal port records one hidden terminal named `Remote - SSH agent link`; the link command hasn't run before the fake calls `open` | no command before `open` |
| F-2311 5.0 step 6 | the fake then calls `open` | the listing and `ln -sfn -- …` ran once, in that order, and the pty fired close |
| F-2311 5.0 step 5 | a `none` agent plan | no terminal opened |
| F-2311 7.E7 | the link command fails | a warn line; the connect's result is unchanged |
| F-2311.AC-6, F-2312.AC-5 | the window side with both plans | the collection holds exactly `SSH_AUTH_SOCK` and `DISPLAY`; with `none` plans, it's cleared |
| lib-ssh | `SharedRecord` with valid and malformed `agentLink` and `display` | valid ones read back; malformed ones are absent |

**Host image** (`tests/acceptance/host/Dockerfile`):
- `apk add xauth`;
- in `harness.conf`, `X11Forwarding yes` and `AllowAgentForwarding yes` (Alpine's default, written for clarity);
- check that the host has `ssh-add` (OpenSSH's client). Add `openssh-client` if it doesn't.

**Aliases** (`harnessSshConfig`, `tools/acceptance.ts`), for `harness`, as `Host harness` is written today:
- `agentfwd`: `ForwardAgent <the run's agent socket>`, the path form of F-2311 6.8, so the editor's own environment
  doesn't matter;
- `x11fwd`: `ForwardX11 yes` and `ForwardX11Trusted yes`, so the client needs no `xauth`.

**Acceptance rows** (VSCodium, runner-remote launches placed right after `reconnect`, so the server they find was
started by the `remote` launch's session, which forwarded neither. That's F-2311 AC-13 and F-2312 AC-9's case, which
fails on main):

| Launch, folder | Row | Expected | Must fail on main |
|---|---|---|---|
| `agent`, `ssh-remote+agentfwd/home/harness` | `F-2311 AC-2, AC-3, AC-13: a window with ForwardAgent gets the agent in its terminals`: `agentAdd(<run>/id_second, {confirm: false})` first; then `onHost` lists `/tmp/vscode-ssh-auth-sock-*`; a terminal runs `echo "$SSH_AUTH_SOCK" > ~/agent-sock.txt; ssh-add -l > ~/agent-keys.txt 2>&1` | one link owned by `harness`; the terminal's `SSH_AUTH_SOCK` is that link; `agent-keys.txt` lists `fingerprintOf(id_second)`, all within 15 s | yes: no link, no `SSH_AUTH_SOCK` |
| `agent-off`, the same, with `enableAgentForwarding: false` | `F-2311 AC-10: the setting false makes no link` | no new link; the terminal's `SSH_AUTH_SOCK` is empty | no (control) |
| `x11`, `ssh-remote+x11fwd/home/harness` | `F-2312 AC-2, AC-9: a window with ForwardX11 gets the display in its terminals`: a terminal runs `echo "$DISPLAY" > ~/display.txt` | `display.txt` matches `^localhost:\d+\.0$` within 15 s | yes: an empty `DISPLAY` |

Use the helpers of tooling-29 (`agentAdd` and `fingerprintOf` in `windows/harness.ts`, imported by the suite) and
`onHost`. The rows run in the launch's own suite folder, `suite-forwarding/`. Add it as the README's "To add a launch"
says.

## 5. The catalogue

**Rows waiting on #406:**
- F-2311 AC-8 (no link while the trust modal is open) and AC-9 (Cancel still links, in Restricted Mode) need an
  untrusted window, and the harness starts every editor with `--disable-workspace-trust`.
- Their acceptance waits on #406's untrusted-launch gap. Tag them `todo` in `coverage-slice1.tsv` (or slice 2's file
  when it exists), with nothing in the reason column, as `todo` takes none.
- AC-25 likewise.

**Settled by athena (register e2e9bba):**
- R4's hidden extension terminal, which replaces the first draft's host-channel step behind its own trust gate.
- R1: only an explicit `false` disables a setting.

## 6. Gates and review

All gates, the changed files at 100 %, the VSCodium run green with the new launches, and the host image rebuilt. PR
title `remote-ssh, lib-ssh: agent and X11 forwarding reach the window (card connect-39, #676)`. themis or triton
reviews (security: the link command quotes its paths and uses `--`), and athena gives the design check.

## 7. Open rows (stop and report on #676)

1. Core treats the hidden pty terminal as a local terminal (after "Cancel": "Cannot launch a terminal process in an
   untrusted workspace", and no `open`). Stop and report. Don't force the terminal's kind.
2. ssh refuses X11 forwarding because the helper's `ssh` process gets no `DISPLAY`: the shared connection's process
   environment may not carry the editor's. Report what the helper's environment holds. Don't add `DISPLAY` to it by
   guess.
3. The probe's session is not the forwarding session, so `host.sshAuthSock` is empty though the alias forwards. Report
   which session runs the probe.
4. `SharedRecord` is read by a reference-shaped reader that rejects unknown fields: report it, and don't loosen the
   reader beyond the two fields.
