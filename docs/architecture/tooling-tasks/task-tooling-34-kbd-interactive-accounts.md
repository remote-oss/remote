# Task card tooling-34: keyboard-interactive accounts for F-2306 AC-27

Issue: #717. Release 0.2, harness gap H2 of the gate's class-"b" ACs. Size: S–M. Builder: assigned by hermes
(task:claude). Verification: proteus.

## 1. Why

**What's already covered:** D-65's recorded cases cover F-2306's keyboard-interactive flows (hermes, 2026-10-14). Those
ACs are tagged `recorded` once the replay passes.

**What isn't:** F-2306 AC-27 (BR-9, BR-10) is a property of our own build: after logins with passwords, one-time codes
and a forced password change, successful or not, no typed value is in any file of the client or the host. A recording
can't show what our build writes. So the run needs those logins against its own host.

**What the host has today:**
- `harness-pw` logs in by password only;
- the image's sshd has no PAM (Alpine's `openssh-server`), so keyboard-interactive has no device to ask with.

## 2. Measured (alpine:3.22 at the host image's digest, 2026-10-14)

**The setup:**
- packages `openssh-server-pam` (OpenSSH 10.0p1, binary `/usr/sbin/sshd.pam`), `linux-pam` and `google-authenticator`;
- `/etc/pam.d/sshd` set to:

  ```
  auth      required  pam_unix.so
  auth      required  pam_google_authenticator.so nullok
  account   required  pam_unix.so
  password  required  pam_unix.so sha512
  session   required  pam_unix.so
  ```

  The package's own file includes `base-auth`, which the image doesn't have;
- `UsePAM yes`, `KbdInteractiveAuthentication yes`.

**The prompts**, read by a client askpass with `PreferredAuthentications keyboard-interactive`:
- **An account with a `~/.google_authenticator` file** (`TOTP_AUTH`): `(u@127.0.0.1) Password: `, then
  `(u@127.0.0.1) Verification code: `. The login succeeded with the `oathtool --totp` code.
- **An account expired by `chage -d 0`**, in four prompts:
  1. `Password: `;
  2. `You are required to change your password immediately (administrator enforced).\nChanging password for u.\nCurrent password: `;
  3. `New password: `;
  4. `Retype new password: `.

  The login succeeded, and the password was changed.

## 3. Changes

### 3.1 The host image (`tests/acceptance/host/`)

**`Dockerfile`:**
- `apk add` gains `openssh-server-pam linux-pam google-authenticator`;
- `/etc/pam.d/sshd` is written as in §2;
- `harness.conf` gains `UsePAM yes`. The global `KbdInteractiveAuthentication no` stays;
- two users with `/bin/sh`:
  - `harness-2fa`;
  - `harness-expired`;
- in `/etc/ssh/sshd_config`:

  ```
  Match User harness-2fa,harness-expired
    KbdInteractiveAuthentication yes
    PasswordAuthentication no
    PubkeyAuthentication no
  ```

The header comment names both accounts.

**`start-sshd`:**
- `chpasswd` sets `HOST_PASSWORD` for `harness-2fa` and `harness-expired` as well as `harness-pw`;
- `chage -d 0 harness-expired`;
- `harness-2fa`'s `~/.google_authenticator` is written from the new `HOST_TOTP_SECRET`, owned by the account, mode 400.
  It holds the secret, then `" TOTP_AUTH` and `" WINDOW_SIZE 3`: no `RATE_LIMIT`, no `DISALLOW_REUSE`, so the rows'
  logins are never throttled. `HOST_TOTP_SECRET` is then unset, as `HOST_PASSWORD` is;
- sshd runs as `/usr/sbin/sshd.pam -D -e`.

The other accounts keep `*` in `/etc/shadow`, as today. With `UsePAM yes`, sshd leaves the locked-account check to PAM,
whose `account` stack is `pam_unix`.

### 3.2 The run (`tools/acceptance-run.ts`, `tools/acceptance.ts`)

- `startHostContainer` writes `HOST_TOTP_SECRET=<32 base32 characters from 20 random bytes>` into `host.env`, beside
  `HOST_PASSWORD`, and the secret into `<run>/totp-secret` (mode 600). The launches get `HARNESS_TOTP_FILE`.
- `harnessSshConfig` gains two `accountAlias` blocks:
  - `twofactor` (user `harness-2fa`);
  - `expired` (user `harness-expired`);

  each with `PubkeyAuthentication no` and `PreferredAuthentications keyboard-interactive`. It has no
  `NumberOfPasswordPrompts`.

### 3.3 Helpers (`tests/acceptance/windows/harness.ts`)

- `totpCode(at = Date.now())`: the RFC 6238 code (SHA-1, 30 s, 6 digits) of the secret in `HARNESS_TOTP_FILE`, in Node's
  `crypto`. There's no dependency. Its unit row checks RFC 6238's SHA-1 test vector at time 59, cut to 6 digits:
  `287082`.
- `secretHits(values, places)`: for each place, the files under it whose bytes contain any of `values`:
  - a client folder is searched in Node, reading every regular file and following no links;
  - a host folder is searched with `onHost('grep', '-rlF', '-e', <value>, … , <folder>)`;
  - the container's log is searched with `docker logs`.

  It returns `{place, file}` pairs, and never the value.

### 3.4 The launch and its rows

**The launch:** a plain launch in `acceptance-launches.ts`, `{label: 'secrets', kind: 'plain', suite: 'secrets',
environment: {HOME: '<run>/home-secrets'}}`, as coverage-20's `config-files` launch sets `HOME`. The run makes
`<run>/home-secrets` empty before it. It goes in `tsconfig.json`, `knip.jsonc` and the README's launch list.

**`tests/acceptance/secrets/kbd-interactive.test.ts`** answers through `maskedInput` script entries, which the record
writes as `<supplied>`. The script file itself, in the run folder, is the harness playing the user, so it isn't
searched. `N` is a fresh `newPassword()`, generated by the row.

| Cite | Window, alias; script | Expected |
|---|---|---|
| F-2306 AC-27 (wrong code) | `k1` on `twofactor`; `Password` → the password, `Verification code` → `000000` if that isn't the current code, else `111111`; `Password` → `dismiss`; then `failureDialog` → `dismiss` | a `failureDialog` line of `k1` |
| F-2306 AC-27 (two-factor) | `k2` on `twofactor`; `Password` → the password, `Verification code` → `totpCode()` | `k2` connected |
| F-2306 AC-27 (mismatched new password) | `k3` on `expired`; `Password` → the password, `Current password` → the password, `New password` → `N`, `Retype new password` → `N` + `x`; then `dismiss` for whatever comes next, and `failureDialog` → `dismiss` | not connected |
| F-2306 AC-27 (forced change) | `k4` on `expired`; as `k3` with the retype `N` | `k4` connected |
| F-2306 AC-27 | after `k1`–`k4`, every window closed | `secretHits([password, every code typed, N, N + 'x'], places)` is empty |

**The places searched:**
- `<run>/home-secrets`;
- `<run>/user-data`. It holds the settings, `globalStorage` (the extension's own storage and `state.vscdb` with its WAL),
  `workspaceStorage` and `logs`;
- every `<run>/extensions*` folder;
- the host's `/home/harness-2fa`, `/home/harness-expired`, `/tmp`, `/var/tmp` and `/var/log`;
- the host container's log.

**The pending-prompt clause:** "any stored pending-prompt record holds at most the prompt text" is covered by the same
search, since any such record is in one of these places. A row may name such a record only if our code writes one.

**The `Verification code` match:** it matches the product's input. Use the text the product shows (S065's form, "Enter
verification code"), as the recorded case reads it. The row matches on `erification code`, which both forms contain.

Catalogue: F-2306 AC-27 goes from `todo` to `acceptance`.

## 4. Gates and review

All gates, the changed tools files at 100 %, and the full VSCodium run green. Paste the `secrets` summary, and the
`password` rows' summaries, which must be unchanged.

**The PR opens with the `needs-verification` label.** proteus checks:
- that the PAM build of sshd changes no existing row (the server suite and the VSCodium run, on both CI
  architectures);
- that `acceptedPasswords()` still counts as before.

PR title `tests: keyboard-interactive accounts and the secrets rows of F-2306 AC-27 (card tooling-34, #717)`. themis
or triton reviews; athena gives the tag check.

## 5. Open rows (stop and report on #717)

1. **Our build doesn't complete a login.** If it can't complete a keyboard-interactive login on `twofactor` or
   `expired` (it shows nothing, or fails the connect), report the record and the connection log. That's a product
   defect, outside this card.
2. **An existing row changes** with `sshd.pam`. Report it, and don't adjust the row.
3. **A search finds a value.** Report the place and the file, never the value. It's a defect against BR-9/BR-10, and the
   row stays red.
