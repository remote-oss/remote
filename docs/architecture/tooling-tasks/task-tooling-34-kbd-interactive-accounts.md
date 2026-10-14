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

- `startHostContainer` writes `HOST_TOTP_SECRET=<32 base32 characters from 20 random bytes>` into `host.env`, as a
  second line after `HOST_PASSWORD`, and the secret into `<run>/totp-secret` (mode 600). The launches get
  `HARNESS_TOTP_FILE`. The row `is the one line of the env file, HOST_PASSWORD=<password>`
  (`tools/acceptance-run.test.ts:332`) becomes `is the two lines of the env file, HOST_PASSWORD=<password> and
  HOST_TOTP_SECRET=<secret>`, and a new row checks that the secret is 32 characters of the base32 alphabet and equals
  `<run>/totp-secret`.
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
  - a client place (a folder or a file) is searched in Node, reading every regular file and following no links;
  - a host folder is searched as root, since `onHost` runs as `harness` and can't read the mode-400
    `.google_authenticator` or other users' homes: `docker exec --user root <HARNESS_CONTAINER> grep -rlF -e <value> …
    <folder>`, run with `execFile` directly (not `onHost`). grep's exit 1 means no hit and is a clean result. Exit 0
    gives the hits on stdout. Any other exit fails the search with grep's stderr;
  - the container's log is searched with `docker logs`.

  It returns `{place, file}` pairs, and never the value.

### 3.4 The launch and its rows

**The launch:** a plain launch in `acceptance-launches.ts`, `{label: 'secrets', kind: 'plain', suite: 'secrets',
environment: {HOME: '<run>/home-secrets'}, hostSetup: [...]}`. The run makes `<run>/home-secrets` empty before it.
- **`<run>` in a plain launch's environment:** `runPlainLaunch` (`tools/acceptance-plain.ts:246`) spreads
  `launch.environment` without `withRunTokens`, so `<run>` would stay literal. tooling-37 Part 3 (#720) adds that
  replacement. If tooling-37 hasn't merged when this card is built, this card adds the same change, with its tools row:
  `runPlainLaunch` passes `withRunTokens(launch.environment, session.runFolder, process.env.PATH ?? '')`. Whichever card
  lands second reuses it.
- **`hostSetup`, so a retried attempt starts from the same accounts** (k4 changes `harness-expired`'s password). It runs
  as root before each attempt (`runHostSetup`), and `docker exec` sees the container's `--env-file` variables
  (measured 2026-10-14: an `--env-file` variable is set in `docker exec sh -c`, though `start-sshd` unsets its own copy):

  ```
  {command: 'printf "%s:%s\n" harness-2fa "$HOST_PASSWORD" harness-expired "$HOST_PASSWORD" | chpasswd && chage -d 0 harness-expired'}
  ```
- **Registration:** the suite folder gets a `tsconfig.json` like `explorer/`'s. It's listed in the root `tsconfig.json`'s
  `references`, `eslint.config.ts`'s `TYPESCRIPT_PROJECTS`, `knip.jsonc`'s entries, and the README's launch list.

**`tests/acceptance/secrets/kbd-interactive.test.ts`** answers through `maskedInput` script entries, which the record
writes as `<supplied>`. The script file itself, in the run folder, is the harness playing the user, so it isn't
searched. `N` is a fresh `newPassword()`, generated by the row.

**What each entry matches.** A `maskedInput` entry's `match` is a case-sensitive substring of the placeholder
(`scripted-adapters.ts:368`), and the placeholder is what lib-ssh's classifier makes of sshd's prompt
(`packages/lib-ssh/src/prompts/classify.ts`, `maskedPlaceholder`):

| sshd's prompt (§2) | Placeholder | `match` |
|---|---|---|
| `(u@127.0.0.1) Password: ` | S065 `Enter password` | `password` (as `two-windows.test.ts:167`) |
| `(u@127.0.0.1) Verification code: ` | `Enter verification code` (`VERIFICATION_CODE_PLACEHOLDER`, not a string id) | `verification code` |
| `You are required … Current password: ` | the prompt itself (no rule takes it) | `Current password` |
| `New password: ` | the prompt itself | `New password` |
| `Retype new password: ` | the prompt itself | `Retype new password` |

`New password` doesn't match the retype prompt, whose `new` is lower case. A row that sees another placeholder in the
record stops (§5, row 4).

| Cite | Window, alias; script | Expected |
|---|---|---|
| F-2306 AC-27 (wrong code) | `k1` on `twofactor`; `password` → the password, `verification code` → `W`, a code that equals none of `totpCode(now - 30 s)`, `totpCode(now)` and `totpCode(now + 30 s)` (start at `000000` and count up); `password` → `dismiss`; then `failureDialog` → `dismiss` | a `failureDialog` line of `k1` |
| F-2306 AC-27 (two-factor) | `k2` on `twofactor`; `password` → the password, `verification code` → `totpCode()` | `k2` connected |
| F-2306 AC-27 (mismatched new password) | `k3` on `expired`; `password` → the password, `Current password` → the password, `New password` → `N`, `Retype new password` → `N` + `x`; then `dismiss` for whatever comes next, and `failureDialog` → `dismiss` | not connected |
| F-2306 AC-27 (forced change) | `k4` on `expired`; as `k3` with the retype `N` | `k4` connected |
| F-2306 AC-27 | after `k1`–`k4`, every window closed | `secretHits([password, N, N + 'x'], allPlaces)` and `secretHits([W, the code k2 typed], textPlaces)` are both empty |

**The places searched.** The password and `N` are 24 random letters and digits, which no file holds by chance, so
they're searched everywhere. A six-digit code can appear by chance in any binary file (a database page, an extension's
bundle), so the codes are searched only in the text places where the product writes what it's told:
- **`allPlaces`:**
  - `<run>/home-secrets`;
  - `<run>/user-data`. It holds the settings, `globalStorage` (the extension's own storage and `state.vscdb` with its
    WAL), `workspaceStorage` and `logs`;
  - every `<run>/extensions*` folder;
  - the launch's own log and record, `<run>/secrets-log.txt` and `<run>/secrets-record.jsonl`, where the product logs
    and answers;
  - the host's `/home/harness-2fa`, `/home/harness-expired`, `/tmp`, `/var/tmp` and `/var/log`, searched as root;
  - the host container's log.
- **`textPlaces`:**
  - `<run>/secrets-log.txt` and `<run>/secrets-record.jsonl`;
  - the `*.log` files under `<run>/user-data/logs`;
  - `<run>/user-data/User/globalStorage/remote-oss.remote-ssh`;
  - the host container's log;
  - the host's `/home/harness-2fa` and `/home/harness-expired`, except `.google_authenticator`. That file is the
    harness's own TOTP seed, and it holds scratch codes.

**The pending-prompt clause:** "any stored pending-prompt record holds at most the prompt text" is covered by the same
search, since any such record is in one of these places. A row may name such a record only if our code writes one.

**The verification-code match:** the product shows `Enter verification code`, lib-ssh's `VERIFICATION_CODE_PLACEHOLDER`
(no string id), so the entries match `verification code`.

**A wrong password on `password`:** with `UsePAM yes`, `harness-pw`'s password login goes through PAM too. A wrong
password there now gets a second prompt before the login fails. That's expected. Existing rows that answer a wrong
password once and then `dismiss` stay as they are, and proteus's check (§4) confirms them.

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
4. **A placeholder isn't the one in the table above.** Report the record line's `question`, and don't widen a match by
   guess.
