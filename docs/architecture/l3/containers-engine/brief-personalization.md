# Brief: personalization and relays (C16)

Owner: athena (architect). Plan: #1807 group 15, part 2. Specs:
- remote-oss/remote-containers#54 (F-1001 Git configuration copy);
- #77 (F-1002 Git credential forwarding);
- #79 (F-1003 SSH agent forwarding);
- #101 (F-1004 GPG agent forwarding);
- #109 (F-1005 Docker credential helper);
- #116 (F-1006 GitHub CLI authentication);
- #102 (F-1007 Dotfiles);
- #105 (F-1008 Display server forwarding).

F-1008 is `spec:draft` and unseeded. The rest are `spec:reviewed`.

Decisions: D-105, R-26, R-27, R-79, ADR-0009, ADR-0010, ADR-0013, `contracts.md` §1 and §2, `brief-attach.md` §4,
`brief-volumes.md` §3. A host reached over SSH (F-1003 6.5, F-1002 BR-14) is group 16's.

## 1. The connect order (C7 and C10; amends `contracts.md` §2)

**The order changes.** The relays need a program of ours in the container, and the only runtime every container has
once we've touched it is the VS Code server's own `node` (the one C11's dialer already uses). The reference already has
the server installed while the blocking hooks run: they run under "Starting server" (F-0415 5.0 step 6), and F-1003's
relay exists "right after the requirements check … before any lifecycle command" (F-1003 5.0 step 3). So:

1. **The container:**
   - **Dev containers:** C7 runs `up --skip-post-create`, which finds or creates the container and runs no lifecycle
     command. Wayland's `--mount` is decided here (§3.5).
   - **Attach:** C12 runs `set-up --skip-post-create`, which does the patches only.
   - **Pinned against the bundled CLI:**
     - `--skip-post-create` skips `onCreateCommand` and `updateContentCommand` too, not only the post-create set;
     - `initializeCommand` still runs on the host in `up`, before creation.
2. **The server files:** lib-server's probe (the requirements check, S346), plan and transfer, under "Installing
   server" (S209).
3. **Phase E**, the early personalization of §3: the relay host and the relays (F-1003, F-1004, F-1008's X11), the
   system-level Git credential step (F-1002), the Docker credential helper (F-1005) and the `known_hosts` copy.
4. **The blocking hooks:** `run-user-commands --container-id <id> --skip-non-blocking-commands` under "Starting server"
   (S334), with `--remote-env NAME=value` for each relay variable.
   - **Precedence:** the CLI builds the user-command environment as probe, then `--remote-env`, then the
     configuration's `remoteEnv`. That gives F-1003 BR-13's `containerEnv` < relay < `remoteEnv` with no work of ours.
   - **Values:** they're socket paths, not secrets.
   - **Attach:** the run takes `--config <attach file>` as in `brief-attach.md`.
   - **Failures and progress:** C8's classification (F-0410's dialogs, containers-149's S420) now applies to this run's
     outcome, unchanged, where it applied to `up`'s. The lifecycle presenter (the "Configuring..." terminal, S085)
     takes this run's JSON log stream.
5. **The server starts.** The relay variables join `Connected.extensionHostEnv`, between the probed environment and
   `remoteEnv` (`extensionHostEnvironmentOf` gains the middle argument). So the remote extension host, its terminals
   and its tasks inherit them (F-1002 §16), and lib-server's start needs no new input.
6. **Background run 1:** `run-user-commands … --stop-for-personalization`, with the dotfiles options (F-1007). The CLI
   runs `postCreateCommand`, then dotfiles, then stops (its order, measured in the bundled CLI).
7. **Phase P**, the personalization of §4: the Git configuration copy (F-1001), the global Git credential step (F-1002),
   and the `gh` login (F-1006, not awaited).
8. **Background run 2:** `run-user-commands` with no stop. The markers skip what ran, so `postStartCommand` and
   `postAttachCommand` run (F-0415 5.0 steps 8 and 9, AC-32).

**Amendments:**
- `brief-attach.md` §4 steps 3 and 11 take this order: `set-up --skip-post-create`, then the Alpine step, the server
  files, phase E, the blocking run, the start, and the two background runs.
- `contracts.md` §2 steps 3 to 6 are rewritten to the eight steps above.
- C3 gains `--skip-post-create`, `--stop-for-personalization`, the dotfiles options and `--remote-env` on its builders.

## 2. The relay host (C16, one per connection)

- **The container side:** `relay-host.js`, shipped as text and written beside the server by the install step, as
  C11's relay script is. It's owned by the remote user, mode 0644.
  - **How it runs:** one long-lived `docker exec -i --user <remote user> <id> <server node> relay-host.js` through
    C2. It runs until the connection's lease ends.
  - **What it listens on:** the Unix sockets C16 tells it to, each created mode 0600, owned by the remote user, at a
    fresh path per connection.
  - **What it does with a connection:** it opens a numbered stream over its stdio and pipes both ways.
  - **The framing** is ours (R-27): `open <stream> <kind>`, `data <stream> <length>`, `close <stream>`, in binary
    frames. Unit rows cover the codec.
- **The host side:** C16 demultiplexes each stream by kind:
  - `ssh-agent` connects to the host agent: the UI process's `SSH_AUTH_SOCK`, or on Windows the agent pipe of ADR-0013;
  - `gpg` connects to the host's `agent-extra-socket`, with the Gpg4win/Cygwin socket handshake from the dev container
    CLI's socket primitive (MIT; F-1004 §16);
  - `x11` connects to the X server of the host's `DISPLAY` (F-1008 BR-14);
  - `ipc` is answered in process by the credential handlers of §3.
  - **Connections open lazily:** the host side connects only when a stream opens, so a dead host path shows only on
    first use (F-1003 7.E3, BR-5).
- **Bounds** (R-79): a host connect is bounded at 10 s and then closes its stream. A stream with no traffic stays open,
  because agent sessions are long. The exec's end ends every stream.
- **Stale sockets:** a connection's socket files stay in `/tmp` after it ends, as the reference's do (F-1003 5.0 step 3).
  That's accepted, and no row asserts cleanup.
- **Secrets** (R-26): payloads are never logged. The log names only the paths and the kind (F-1003 §9's "forwarded to
  local host" line).
- **The bootstrap container** (`brief-volumes.md` §3) gets its own relay host on the bootstrap's `node`. It serves
  `ssh-agent`, `ipc` (Git and Docker credentials) and the root `known_hosts` copy (F-1002 §16, F-1003 BR-12, F-1005).
  This makes private-repository clones work, which brief-volumes left for this brief.

## 3. Phase E: before the hooks

1. **SSH agent (F-1003):**
   - the `ssh-agent` socket at `/tmp/remote-oss-ssh-auth-<uuid>.sock` (our name; BR-8 leaves the path to us), created
     whether or not a host agent exists;
   - `SSH_AUTH_SOCK` set to it, plus `REMOTE_CONTAINERS_SOCKETS` (the spec's variable name, reused per D-14);
   - the log line;
   - then the `known_hosts` copy: test, then copy, never overwrite (BR-11).
   - The relay path never goes into the container's own `Env` (BR-6, BR-7).
2. **GPG agent (F-1004):**
   - **When:** only when `gpg` is already in the container (PRE-3).
   - **Where:** the target directory comes from GnuPG in the container, never a hard-coded `~/.gnupg` (BR-12).
   - **What:** the `gpg` socket at its standard name there, and the one-time per-file copy of `pubring.kbx` and
     `trustdb.gpg`.
3. **Git credentials, system level (F-1002):**
   - **When:** with the setting's location `system`, as root.
   - **What:** the system `credential.helper` is set to this connection's helper string. Git resolves the file, so
     `GIT_CONFIG_SYSTEM` is honoured (BR-20).
   - **The helper:** a shell wrapper that runs `node relay-ipc.js git-credential <op>` against the `ipc` socket named
     in `REMOTE_CONTAINERS_IPC` (D-14). The host side runs the host's own `git credential fill|approve|reject` with
     `GIT_TERMINAL_PROMPT=0`, passing its stderr back (§16, 7.E4).
   - **Without the variable:** a process gets no answer (BR-11).
4. **Docker credentials (F-1005):**
   - **When:** after step 3, with the setting on.
   - **What:**
     - **The helper:** `/usr/local/bin/docker-credential-dev-containers-<uuid>`, mode 755, written as root (POST-2,
       5.0 step 5). Earlier connections' helpers stay, as the spec observes (6.x step 3).
     - **The name:** it's the spec's visible file content, kept (D-14). No `PATH` is changed: `/usr/local/bin` is on
       it already, and a `PATH` passed through `--remote-env` would replace the probed one.
     - **The configuration:** the remote user's `~/.docker/config.json` gets the `credsStore`. It's always that file,
       whatever `DOCKER_CONFIG` says (BR-20).
     - **The program** is a shell wrapper around `node relay-ipc.js docker-credential <op>`.
   - **The checks:** the file is classified per BR-3, BR-4 and BR-12 first, and BR-15's `docker` check runs before
     the hooks.
   - **Answers:** they come from the host configuration's three sources (BR-1, BR-13). Later windows of the same
     container keep working, because each connection writes its own helper (BR-18).
5. **Display (F-1008):**
   - **X11:** an `x11` socket at `/tmp/.X11-unix/X<N>` with the per-container counter, `DISPLAY=:<N>` and
     `REMOTE_CONTAINERS_DISPLAY_SOCK`. The first session's wiring is what lifecycle commands see (BR-12).
   - **Wayland:** decided in step 1 of §1. C7 adds the host socket's bind `--mount` when
     `dev.containers.mountWaylandSocket` is on and the engine can use the path:
     - with the default local socket, yes;
     - with `DOCKER_HOST`, no;
     - on Windows with a `\\wsl.localhost\…` source, no;
     - Compose takes the mount when it accepts it, as AC-2 has it.

     Phase E then adds the symlink in `XDG_RUNTIME_DIR` (kept when the container defines it, BR-15) and
     `WAYLAND_DISPLAY`. F-0403 AC-11's Wayland bind is this.
   - **No relay:** when the relay can't be created, X11 is skipped for that session, silently (the preferred outcome
     of 7.E2).
6. **A phase-E step that fails** never fails the connection, except where a spec says so. Each spec's 7.E cases decide,
   and the default is a log line and on (F-1002 §16: "the connection never fails because of these writes").

## 4. Phase P: after `postCreateCommand` and dotfiles

1. **Dotfiles (F-1007):** the CLI's own step in background run 1.
   - **The options:** `--dotfiles-repository`, `--dotfiles-install-command`, `--dotfiles-target-path`, from the three
     machine settings (§5).
   - **What the CLI owns:** the marker first, the eight names and the single-path rule, the symlink fallback, silent
     failure (BR-3, BR-5, BR-6, BR-8).
   - **A dotfiles row that differs from the CLI** stops and comes to me. We don't fork the CLI (ADR-0009).
2. **The Git configuration copy (F-1001)**, when `dev.containers.copyGitConfig` is on:
   - **The sources:** the host's `~/.gitconfig` and `$XDG_CONFIG_HOME/git/config` at their fixed paths (BR-17), read
     through a symbolic link, with a dangling link counting as absent (BR-16).
   - **The copy:** test, then copy into `<remote-home>`, never overwriting, so dotfiles win.
   - **The cleanup:** `core.editor` is removed, and the bare `[credential]` helper is replaced, byte-exact elsewhere.
   - **The allow-list:** `gpg.ssh.allowedSignersFile` is copied (BR-15).
   - **Order:** 7.E1 and 7.E3's order of reads and writes is kept exactly. Root's files are never touched for a
     non-root user (BR-13).
   - **The tool:** all through C11's `runScript`, as the remote user.
3. **Git credentials, global level (F-1002):** with the location `global`, the global `credential.helper` is this
   connection's helper string, through Git's own global scope, so the XDG file is honoured (BR-21, F-1001 6.8).
   Nothing is written without `git` (6.10).
4. **`gh` login (F-1006)**, when `dev.containers.githubCLILoginWithToken` is on and the entry point isn't Attach
   (BR-10):
   - the host token comes from `gh auth token` in the login-shell environment of the machine that runs Docker;
   - it passes on stdin to `gh auth login --with-token` in the container, as the remote user, without `remoteEnv`;
   - it isn't awaited, and nothing is shown or logged about the outcome (BR-6, BR-18);
   - **the token** is never in argv, the log or a file of ours (R-26).

## 5. Machine-scope settings at connect

- **One reader, in C16**, for the five machine settings: the container's server `data/Machine/settings.json`, read
  through C11, then the local User value, then the default (F-1002 BR-6, F-1006 §16, F-1007).
  `dev.containers.mountWaylandSocket` is `application` scope and read normally.
- **A dev container's first connect** has no Machine file yet, so the local value applies.

## 6. Entry points and platforms

- **Attach (C12):**
  - phase E runs as for dev containers;
  - phase P runs, except F-1006 (BR-10);
  - F-1002 doesn't read its setting there (BR-16).
- **Recovery container windows** follow their own payload's rules: phase E and P run as in any connected window.
- **Windows** (ADR-0013):
  - the agent pipe and the Gpg4win handshake;
  - the `\\wsl.localhost` Wayland skip;
  - CRLF never introduced into a copied file (F-1001 §12).

  These are unit rows now and hosted rows later.
- **A host over SSH:** the relays still reach the *local* agent (F-1003 6.5), and the SSH host's Git configuration
  goes first (F-1002 BR-14). Group 16 builds them on C19.

## 7. A decision on string ownership

**F-1008 Q-1, option (a):** STR:S200 is F-0810's string, the detail of its "not found" dialog. No flow of F-1008 shows it,
and none of ours does. This isn't a deviation, so it has no label and no row. It's the room's proposal, taken for the
clean side, and asked of metis on the spec repo's question batch so the spec says it too.

## 8. Contracts, components, the cut and the cards

- **`components.md`:** C16 joins, owning F-1001 to F-1008. Boundary 6 gains `relay-host.js`, `relay-ipc.js`, the
  credential wrappers and the phase scripts.
- **`contracts.md`:**
  - §1 gains the relay host's framing and kinds;
  - §2 the eight-step order;
  - §3 nothing (no payload change).
- **The shutdown protocol:** the relay host's exec is one more process the lease ends.

**The cut:**

| Lines | Where |
|---|---|
| F-1001 to F-1007, r2 `todo` | this brief |
| F-1008 (38), unseeded | seeded by card 1, built here |
| r1 F-0403 AC-11 (the Wayland bind), F-0415 AC-32 (the copy between `postCreateCommand` and `postStartCommand`) | here (§3.5, §4.2) |
| the SSH-host cases (F-1003 6.5, F-1002 BR-14) | group 16 |

**Suggested cards** (daedalus), in order:
1. **The connect order and the seed:** §1, C3's flags, F-1008's seed. It adds no feature, but it moves every family's
   hooks.
   - **The rows that must pass:** the whole containers launch, with the F-0410 failure rows, the lifecycle-terminal
     rows (F-0408, F-0415) and the progress-phase rows re-read: "Installing server" now comes before the hooks, and
     the hooks run under "Starting server".
   - **Order:** it lands after #1973's E3, the shared connect tail, or is folded into it (with daedalus).
2. **The relay host:** §2, with the codec's unit rows and one acceptance row over a loopback kind.
3. **SSH agent and `known_hosts`:** §3.1, also in the bootstrap.
4. **Git:** §3.3, §4.2, §4.3 (F-1001, F-1002), also in the bootstrap.
5. **Docker credentials:** §3.4 (F-1005), also in the bootstrap.
6. **GPG:** §3.2 (F-1004).
7. **Display:** §3.5 (F-1008).
8. **Dotfiles and `gh`:** §4.1, §4.4 (F-1007, F-1006).
