# Task card tooling-29: passphrase keys, the run's own ssh-agent and a certificate-only account for the harness

Issue: #599. Why: F-2307's rows (coverage-22, #600) need what the harness hasn't got:
- a key with a passphrase that the host accepts;
- an ssh-agent the run owns, named by the editor's `SSH_AUTH_SOCK`;
- an account that accepts only a certificate;
- a private key with loose file modes.

Builder: hestia or iris (hermes assigns). Size: M. Depends on nothing beyond main.

## 1. The keys (`tools/acceptance-run.ts`, `startHostContainer`, and `tools/acceptance.ts`)

The run makes these in its folder, with `ssh-keygen`, next to `id_ed25519`:

| File | What |
|---|---|
| `id_passphrase` | ed25519, comment `acceptance-passphrase`, protected by the run's passphrase: 24 letters and digits, made as the password is. The passphrase goes to `<run>/passphrase` (mode 600, the harness variable `HARNESS_PASSPHRASE_FILE`) and never onto a command line, so not `-N` (R-26). `ssh-keygen` runs without `-N`, with `SSH_ASKPASS` set to a script in the run's folder that prints the file and `SSH_ASKPASS_REQUIRE=force`, which answers both of its passphrase prompts. Check once that this works with the client's `ssh-keygen`, and say in the PR which version was used |
| `id_second` | ed25519, no passphrase (AC-27's second key) |
| `id_passphrase_stranger` | ed25519, comment `acceptance-stranger`, protected by the same passphrase, and **not** authorised on the host (F-2307 AC-20, AC-21: a passphrase key the host refuses) |
| `id_loose` | a copy of `id_ed25519` with mode 0644 (AC-22) |
| `ca`, `ca.pub` | ed25519 CA key |
| `id_certified`, `id_certified-cert.pub` | ed25519, signed by `ca` for the principal `harness-cert` (`ssh-keygen -s ca -I acceptance -n harness-cert`) |

`AUTHORIZED_KEY` becomes `AUTHORIZED_KEYS`: the public keys of `id_ed25519`, `id_passphrase`, `id_second` and `id_loose`,
one per line, for the users `start-sshd` installs keys for.

## 2. The host image (`tests/acceptance/host/Dockerfile`, `start-sshd`)

- A user `harness-cert` with no `authorized_keys`, made with `adduser -D` and then unlocked as the other key accounts are
  (`sed -i 's/^harness-cert:!/harness-cert:*/' /etc/shadow`): `adduser -D` leaves `!` in its shadow entry, and sshd
  rejects a locked account (triton on #603).
- A `Match User harness-cert` block with `AuthorizedKeysFile none` and `TrustedUserCAKeys /etc/ssh/ca.pub`.
- `start-sshd` writes `CA_PUBLIC_KEY` (a new `--env`) to `/etc/ssh/ca.pub`.
- The comment at the top lists the new account.

## 3. The run's agent (`tools/acceptance.ts`)

- Before the editor starts, the run starts `ssh-agent -a <socket> -D` (a child it ends at the run's end). The socket is
  `<run>/agent.sock`, or, when that path would pass 100 bytes (a Unix socket's path is limited to 104–108), `agent.sock`
  in a short folder made under `/tmp` (athena on #603). A tools row covers the length.
- Every launch gets `SSH_AUTH_SOCK=<socket>` and the harness variable `HARNESS_AGENT_SOCKET` with the same path.
- The agent starts empty.
- The agent has no askpass of its own (`SSH_ASKPASS` unset, no `DISPLAY` in its environment), so a confirm-constrained
  key can't be confirmed (AC-17, AC-31).

**Helpers** (`windows/harness.ts`, async, with no blocking `spawnSync` while windows run):
- `agentKeys()`: the fingerprints `ssh-add -l` lists, empty when none;
- `agentAdd(file, {confirm})`: `ssh-add [-c] <file>` with `SSH_AUTH_SOCK` set. For `id_passphrase`, the passphrase comes
  from `HARNESS_PASSPHRASE_FILE` through an `SSH_ASKPASS` script with `SSH_ASKPASS_REQUIRE=force`;
- `agentClear()`: `ssh-add -D`;
- `fingerprintOf(file)`.

## 4. The aliases (`harnessSshConfig`)

Each alias has `HostName 127.0.0.1`, `Port <P>`, `StrictHostKeyChecking accept-new` and `UserKnownHostsFile
<run>/known_hosts`. None has `BatchMode yes`: ssh must be able to ask.

| Alias | User | Lines |
|---|---|---|
| `passkey` | `harness` | `IdentityFile <run>/id_passphrase`, `IdentitiesOnly yes` |
| `passkey-then-second` | `harness` | `IdentityFile <run>/id_passphrase`, `IdentityFile <run>/id_second`, `IdentitiesOnly yes` |
| `loosekey` | `harness` | `IdentityFile <run>/id_loose`, `IdentitiesOnly yes` |
| `certonly` | `harness-cert` | `IdentityFile <run>/id_certified`, `CertificateFile <run>/id_certified-cert.pub`, `IdentitiesOnly yes` |
| `certonly-nocert` | `harness-cert` | `IdentityFile <run>/id_second`, `IdentitiesOnly yes` |

`README.md`: the keys, the account, the agent and the aliases, in "The host's other accounts".

## 5. Rows

- **Tools rows:**
  - the files and their modes;
  - `AUTHORIZED_KEYS` holds four keys;
  - the agent is started and ended;
  - the variables;
  - the aliases' lines;
  - no command line carries the passphrase (a positive control as in `server/environment-argv.test.ts`).
- **Capability rows** (`server/host-accounts.test.ts`, extended):
  - `passkey` logs in with the passphrase through `SSH_ASKPASS`, and fails with an empty one;
  - `certonly` logs in, and `certonly-nocert` is refused;
  - the agent holds `id_passphrase` after `agentAdd` and lists it.

## 6. Review

PR title `tests: passphrase keys, the run's agent and a certificate-only account (card tooling-29)`. themis or triton
reviews; proteus checks the image and the agent's lifetime.
