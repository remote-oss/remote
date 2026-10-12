# Task card tooling-17: the host's extra accounts and aliases (D-85)

Issue: #489. Why: D-85 (the user, on #142). Four of the missing capabilities are accounts on the harness host, or `ssh_config`
aliases to them:
- **password host**, for most of F-2102;
- **TCP forwarding refused**, for F-2304 AC-24;
- **a login shell that does not answer**, for F-2206 AC-28;
- **ControlMaster aliases**, for F-2102 AC-30, AC-39 and AC-40.

Builder: hestia. Size: M.

## 1. Files

| File | Change |
|---|---|
| `tests/acceptance/host/Dockerfile` | three users, the sshd match blocks, `mute-shell` (section 2) |
| `tests/acceptance/host/mute-shell` | new (section 2) |
| `tests/acceptance/host/start-sshd` | the password and the keys of the new users (section 3) |
| `tools/acceptance-run.ts` | the password file, passed with `--env-file` (section 3) |
| `tools/acceptance.ts` | the aliases in `harnessSshConfig`; `HARNESS_PASSWORD_FILE` among the harness variables (section 4) |
| `tools/acceptance.test.ts`, `tools/acceptance-run.test.ts` | rows for the new pure parts |
| `tests/acceptance/server/host-accounts.test.ts` | new: the capability rows (section 5) |
| `tests/acceptance/README.md` | the aliases' table gains the five new ones |

## 2. The image

Users, each with home `/home/<name>`:

| User | Login | Login shell | sshd rule |
|---|---|---|---|
| `harness-pw` | password only | `/bin/sh` | `PasswordAuthentication yes`, `KbdInteractiveAuthentication yes`, `PubkeyAuthentication no` |
| `harness-nofwd` | the run's key | `/bin/sh` | `AllowTcpForwarding no` |
| `harness-mute` | the run's key | `/usr/local/bin/mute-shell` | none |

- **The match blocks go at the end of `/etc/ssh/sshd_config`** (`cat >>`), one `Match User <name>` block per row
  with the rule. They must not go in `sshd_config.d/`: Alpine includes that folder at the top of the main file, where a
  `Match` would swallow every main line after it.
- **`mute-shell`** (in `/etc/shells`, mode 755):

  ```sh
  #!/bin/sh
  # A login shell that runs a command given with -c and never answers otherwise: started without -c, it waits forever.
  if [ "${1:-}" = -c ]; then
    exec /bin/sh "$@"
  fi
  exec sleep 2147483647
  ```

## 3. The password

- The run makes a password of 24 characters from `[A-Za-z0-9]` (`node:crypto` `randomInt`), and writes it to
  `<runFolder>/host.env` as one line, `HOST_PASSWORD=<password>`, with mode 600.
- `startHostContainer` passes that file with `--env-file <runFolder>/host.env`. The password never appears in a
  command line (register rule), so never use `--env HOST_PASSWORD=…`.
- `start-sshd` sets it with `printf 'harness-pw:%s\n' "$HOST_PASSWORD" | chpasswd`, then `unset HOST_PASSWORD`.
- `start-sshd` installs `AUTHORIZED_KEY` for `harness-nofwd` and `harness-mute` as it does for `harness`, with the same
  modes and owners.
- The tests read the password from the file named by the new harness variable `HARNESS_PASSWORD_FILE`
  (`<runFolder>/password`, mode 600, the bare password). A test puts it in a script entry
  `{surface: 'maskedInput', match: …, answer: {text}}`, and the record keeps `<supplied>`. Nothing prints it.

## 4. The aliases

Added to `harnessSshConfig(port, runFolder)`, after `stranger`. Every alias uses `HostName 127.0.0.1`, `Port <port>`,
`IdentityAgent none`, `StrictHostKeyChecking accept-new`, `ConnectTimeout 10`, and its own
`UserKnownHostsFile <runFolder>/known_hosts_<alias>`:

| Alias | User | Further lines |
|---|---|---|
| `password` | `harness-pw` | `PubkeyAuthentication no`, `PreferredAuthentications password,keyboard-interactive`, `NumberOfPasswordPrompts 1` (no `BatchMode`: it would refuse the prompt) |
| `noforward` | `harness-nofwd` | `IdentityFile <runFolder>/id_ed25519`, `IdentitiesOnly yes`, `BatchMode yes` |
| `mute` | `harness-mute` | `IdentityFile <runFolder>/id_ed25519`, `IdentitiesOnly yes`, `BatchMode yes` |
| `master` | `harness-pw` | `password`'s lines, plus `ControlMaster auto`, `ControlPath <runFolder>/cm-%C`, `ControlPersist 60` |
| `master-ask` | `harness-pw` | `password`'s lines, plus `ControlMaster ask`, `ControlPath <runFolder>/cm-ask-%C`, `ControlPersist 60` |

Keep `ControlPath` under 100 characters on the CI runner: `%C` is a 40-character hash. If `runFolder` is too long,
use `<tmpdir>/cm-<runId>-%C` and say so in the README.

## 5. Capability rows (`tests/acceptance/server/host-accounts.test.ts`, plain Node, no editor)

They run in `pnpm test:acceptance:server` over the same host fixture (`host-fixture.ts` gains the env file). One
assertion per `it`. Each `ssh` gets `-F <the run's ssh_config>`. A password is given through `SSH_ASKPASS` to a script
in the run's folder that prints it from `HARNESS_PASSWORD_FILE`, with `SSH_ASKPASS_REQUIRE=force` and no terminal.

| Name | Given | Expected |
|---|---|---|
| `D-85: the password host takes the run's password` | `ssh password true` with the askpass script | exit 0 |
| `D-85: the password host refuses the run's key` | `ssh -o PubkeyAuthentication=yes -o PreferredAuthentications=publickey -i <key> password true` | exit 255 |
| `D-85: the forwarding-refused host refuses a local forward` | `ssh -N -L 127.0.0.1:<free port>:127.0.0.1:22 -o ExitOnForwardFailure=yes noforward`, then connecting to the free port | the connection is closed with no SSH banner (sshd logs `refused local port forward`) |
| `D-85: the forwarding-refused host runs commands` | `ssh noforward true` | exit 0 |
| `D-85: the mute shell runs a command` | `ssh mute 'echo answered'` | output `answered` |
| `D-85: the mute shell never answers without a command` | `ssh -T mute` with input `echo answered\n`, ended after 5 s | no output, and the process was ended by the bound |
| `D-85: master starts a control socket that a second ssh reuses` | `ssh master true` with the askpass script, then `ssh -O check master` | exit 0 |

## 6. Gates and review

The repository's gates. `pnpm test:acceptance:server` passes; paste its summary in the PR body. PR title `tests: the
harness host's password, no-forwarding, mute-shell and ControlMaster accounts (card tooling-17, D-85)`. proteus reviews
the image; themis the password handling.
