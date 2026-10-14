# Task card tooling-35: glibc 2.27 and Debian host images, a uname shim and a sysroot account

Issue: #718. Release 0.2, harness gap H3 of the gate's class-"b" ACs. Size: L. Builder: assigned by hermes
(task:claude). Verification: proteus. **Depends on:**
- server-20 (#670), for S146 and the `harness-i686` account (§3.3);
- connect-38 (merged), for `remote.SSH.localServerDownload`.

## 1. Why

Every host the run has is the Alpine image of `tests/acceptance/host/`: musl, x86_64 or aarch64 as the machine is, and
Linux. F-2401's prerequisite and architecture criteria, and F-3902 AC-1, need hosts it can't be:

| Need | ACs |
|---|---|
| a glibc host older than 2.28 | F-2401 AC-3–9, 15 |
| that host with a working custom sysroot | F-2401 AC-13, and AC-7's "host fixed" half |
| a glibc host ≥ 2.28 reporting aarch64 | F-2401 AC-1 |
| a machine name with no token, or armv7l | F-2401 AC-10, AC-11 |
| a kernel name that isn't Linux | F-2401 AC-12, AC-18 |
| a fresh Debian host on the real server | F-3902 AC-1 |

F-2601 AC-8 and F-2403 AC-12 were in this gap, but D-65's recorded cases cover them (hermes, 2026-10-14).

## 2. Decisions

- **Base images, pinned by the digest of their multi-platform index:**
  - `ubuntu:18.04@sha256:152dc042452c496007f07ca9127571cb9c29697f42acbfad72324b2bb2e43c98`: glibc 2.27 (`ldd`
    prints `GLIBC 2.27-3ubuntu1.6`), OpenSSH 7.6, `apt-get` still served (measured 2026-10-14);
  - `debian:12@sha256:2c037a04925515fdd6ea85ea14a682d0e79931f5e9f5d07b6dbfc6ba12f9e858`: glibc 2.36, OpenSSH 9.2.
- **Where they live:** `tests/acceptance/host/glibc227.Dockerfile` and `tests/acceptance/host/debian.Dockerfile`, built
  with `-f` and the same context as the Alpine image, so they share `start-sshd` and the shim.
- **The machine and kernel name** come from a `uname` shim on `PATH` for chosen accounts, never from a foreign
  architecture under emulation.
- **How a launch picks a host:** by the ssh_config alias. The run starts the two images beside the harness host, and
  each image's accounts get aliases. No launch changes the run's host (the `HOST_*` variables stay the server suite's).
- **The server suite:** `HostVariant` (`tests/acceptance/server/host-fixture.ts`) gains `image?: HostImage`. Then
  `startHost({image: 'debian'})` starts that image.

## 3. Changes

### 3.1 Images

**`HostImage = 'alpine' | 'glibc227' | 'debian'`** lives in `tools/host-variants.ts`, with the Dockerfile of each:
- `alpine` → `Dockerfile`;
- the others → `<image>.Dockerfile`.

**`glibc227.Dockerfile` and `debian.Dockerfile`:**
- `apt-get install --no-install-recommends openssh-server curl wget ca-certificates tar gzip procps`;
- `mkdir -p /run/sshd`;
- users `harness` and `harness-pw`, and the image's accounts of §3.3 and §3.5, each made with `useradd -m -s /bin/sh`
  and then unlocked for key login with `usermod -p '*' <account>` (except `harness-pw`, whose password `start-sshd`
  sets). `useradd` leaves `!` in `/etc/shadow`, which locks the account;
- `ENV HOST_FETCH=gnu-wget`;
- the shim (§3.3);
- `COPY start-sshd`.

**Their sshd settings** are appended to `/etc/ssh/sshd_config`, since Ubuntu 18.04's has no `Include`:
- `PasswordAuthentication no`;
- `ChallengeResponseAuthentication no`, which 7.6 knows and 9.2 takes as `KbdInteractiveAuthentication`;
- `PubkeyAuthentication yes`;
- `PermitRootLogin no`;
- `AllowTcpForwarding yes`;
- `Match User harness-pw` with password login.

The build PR pastes `sshd -T -C user=harness,host=x,addr=127.0.0.1` and the same for `harness-pw`, from each image,
showing the effective values.

**`start-sshd`:**
- its key loop (`for account in harness harness-nofwd harness-mute harness-ro`, line 9) gains every new account:
  `harness-i686`, `harness-armv7l`, `harness-freebsd`, `harness-sunos`, `harness-aarch64` and `harness-sysroot`. Without
  this, they get no `authorized_keys` and can't log in;
- it skips an account of its list that the image doesn't have (`id "$account" >/dev/null 2>&1 || continue`);
- `busybox-wget` on an image without `/bin/busybox` exits 1 with `HOST_FETCH busybox-wget needs BusyBox`;
- it runs `/usr/sbin/sshd.pam` when that's executable, else `/usr/sbin/sshd`. tooling-34 (#717) switches Alpine to the
  PAM build; whichever PR lands second rebases this line.

**Alpine's `Dockerfile`:** the four new Alpine accounts are made as `harness-ro` is (`adduser -D -s /bin/sh`, then
`sed -i 's/^<account>:!/<account>:*/' /etc/shadow`), so they're unlocked for key login.

**`tools/acceptance-run.ts`:** one run makes its key and password once, and every container shares them.
- `hostImageOf(runId, image = 'alpine')` gives `remote-oss-acceptance-host[-<image>]:<runId>`.
- `startHostContainer` is split:
  - `hostFilesOf(command, runFolder)` runs `ssh-keygen` once into `<run>/id_ed25519` and writes `<run>/password` and
    `<run>/host.env` once;
  - `runHostImage(command, root, runId, files, image = 'alpine', extraArguments)` builds that image with `-f` and runs it
    with `AUTHORIZED_KEY` from `<run>/id_ed25519.pub` and `--env-file <run>/host.env`.

  `startHostContainer` keeps its signature and calls the two in turn, so its callers don't change. The variant
  containers call only `runHostImage`. So the second container doesn't re-run `ssh-keygen` on an existing file (which
  asks to overwrite and fails without a terminal), and doesn't rewrite the password or the env file the first
  container already uses.
- The variant containers carry the run's label, so `cleanRun`'s container loop removes them.
- `cleanRun`'s image removal (`acceptance-run.ts:226`) removes all three tags: `hostImageOf(runId)`,
  `hostImageOf(runId, 'glibc227')` and `hostImageOf(runId, 'debian')`, each with its status ignored, as today.
- **Rows** (`tools/acceptance-run.test.ts`):
  - two `runHostImage` calls after one `hostFilesOf` run `ssh-keygen` once and write `host.env` once;
  - `cleanRun` removes the three tags.

### 3.2 The VSCodium run (`tools/acceptance.ts`)

After the harness host, the run starts one `glibc227` and one `debian` container with `runHostImage`, with
`downloadHostArguments()`, and waits for each as for the harness host. `HarnessVariables` gains
`HARNESS_CONTAINER_GLIBC227` and `HARNESS_CONTAINER_DEBIAN`, their container ids, which every launch gets, as
`HARNESS_CONTAINER`.

`harnessSshConfig` takes their ports as `variantPorts: {glibc227: number; debian: number}` and adds:
- `glibc227` and `glibc227-sysroot` (users `harness` and `harness-sysroot` on the `glibc227` container);
- `debian` and `debian-aarch64` (users `harness` and `harness-aarch64` on the `debian` container);
- `i686`, `armv7l`, `freebsd` and `sunos` (users `harness-i686`, `harness-armv7l`, `harness-freebsd` and
  `harness-sunos` on the harness host).

Each is an `accountAlias` with the run's key lines. The README's account list gains them.

The server suite's `startHost` passes `image` through, and writes the same config with only its own container's
aliases.

### 3.3 The `uname` shim

**The script:** `tests/acceptance/host/uname-shim`, POSIX sh, installed as `/usr/local/lib/uname-shim/uname` in all three
images. It reads `$HOME/.uname-as`, lines `kernel=<name>` and `machine=<name>`:
- `uname -s` prints `kernel` when it's set;
- `uname -m` prints `machine` when it's set;
- every other form, and an unset name, runs `/bin/uname "$@"`.

The probe calls `uname -s`, `-m` and `-r` separately (`lib-server/src/scripts/bootstrap.ts`).

**The accounts**, each with its fixed `.uname-as`:

| Account | Image | `.uname-as` |
|---|---|---|
| `harness-i686` | alpine | `machine=i686` (server-20's account) |
| `harness-armv7l` | alpine | `machine=armv7l` |
| `harness-freebsd` | alpine | `kernel=FreeBSD` |
| `harness-sunos` | alpine | `kernel=SunOS` |
| `harness-aarch64` | debian | `machine=aarch64` |

**How the shim reaches `PATH`:** the way server-20 settles for `harness-i686`, which is `~/.profile` putting
`/usr/local/lib/uname-shim` first, unless server-20's open row 2 found that the probe doesn't read it.
- **If server-20 has merged:** its account and shim become these, with the same alias `i686`.
- **If not:** this card creates `harness-i686`. Tell hestia on #670 that the account exists, so server-20 reuses it.

**A script row** (`tests/acceptance/server/uname-shim.test.ts`): over each account's channel, `uname -m` and `uname -s`
print the table's values, and `uname -r` prints the real kernel release. The four Alpine accounts run on `startHost()`.
`harness-aarch64` runs on `startHost({image: 'debian'})`, since the account exists only there.

### 3.4 The glibc server archive (`tools/acceptance-downloads.ts`)

**A second archive:** `SERVER_ARCHIVE.sha256` gains `linux-x64` and `linux-arm64`, the `vscodium-reh-linux-<arch>-<tag>`
assets of the same release. The builder downloads each once and writes its sha256. `serverArchiveOf` takes the
platform (`alpine` | `linux`).

**The paths:** the download host serves the `linux` archive for this machine's architecture when a request's second
path segment starts with `linux-`, and the `alpine` archive otherwise, as today. So `ok/linux-arm64/…` serves the x64
glibc server on an x64 run: F-2401 AC-1's aarch64 report then installs a server that runs. The README's download host
section says so.

### 3.5 The sysroot account (F-2401 AC-13)

On the `glibc227` image, as a second build stage:
- **The sysroot:** `COPY --from=debian:12@<digest above>` copies `/lib/x86_64-linux-gnu` (on arm64,
  `/lib/aarch64-linux-gnu`; use `TARGETARCH`) to `/opt/sysroot/lib`, and `/usr/lib/<triplet>/libstdc++.so.6*` beside
  it.
- **patchelf:** the static release of NixOS/patchelf `0.18.0` for the build's architecture, from its GitHub release,
  checked against a sha256 in the Dockerfile, at `/opt/sysroot/patchelf`.
  - **A second GitHub dependency:** this download is the image build's, in its own layer. Docker's build cache keeps it
    on a machine that built the image before, but a fresh CI runner fetches it on every run, beside F-3902 AC-1's
    server download. proteus's verification (§5) counts it in the run's added time.
  - **Why not the distribution's package:** Ubuntu 18.04's `patchelf` is 0.9, below the 0.18 the server's sysroot
    support asks for, and Debian 12's links against glibc 2.36, which can't run on the 2.27 host.
  - **No retry by guess:** a failed fetch fails the build. Open row 5 says what to report.
- **The account:** `harness-sysroot`, whose `~/.profile` exports:
  - `VSCODE_SERVER_CUSTOM_GLIBC_LINKER=/opt/sysroot/lib/ld-linux-<arch>.so.<n>`;
  - `VSCODE_SERVER_CUSTOM_GLIBC_PATH=/opt/sysroot/lib`;
  - `VSCODE_SERVER_PATCHELF_PATH=/opt/sysroot/patchelf`.

  F-2401 §6.1 names the three variables.
- **`~/.profile` without them** is written as `/home/harness-sysroot/.profile.plain`, for AC-7's row.

### 3.6 Launches (`tools/acceptance-launches.ts`)

- **`prereqs`:** `kind: 'plain'`, suite `prereqs`, `debuggingPort: true`. Settings:
  - `window.title: '[${rootName}]'` (tooling-33's `RENDERER_LAUNCH`, if it has merged), so `pageOf` finds the windows
    (§3.7);
  - `remote.SSH.serverDownloadUrlTemplate: '${HARNESS_DOWNLOADS_HTTP}/ok/${os}-${arch}/${commit}'`;
  - `workbench.startupEditor: 'none'`.
- **`debian`:** `runner: 'runner-remote'`, suite `suite-debian`, folder `vscode-remote://ssh-remote+debian/home/harness`,
  with no template setting, as `remote`.

Both suite folders get a `tsconfig.json` (like `explorer/`'s for `prereqs`, like `suite-remote/`'s for `suite-debian`). They're registered where those are: the
root `tsconfig.json`'s `references`, `eslint.config.ts`'s `TYPESCRIPT_PROJECTS`, `knip.jsonc`'s entries, and the
README's launch list.

### 3.7 Window helpers (`windows/harness.ts`, `windows/renderer.ts`)

**Reaching the new containers.** Today `onHost` is always `docker exec --user harness $HARNESS_CONTAINER`, and
`openWindow` makes `/home/harness/<folder>` there (`windows/harness.ts:149-158, 257-268`). So:
- `containerOf(image)` (in `windows/harness.ts`, with `HostImage` imported from `tools/host-variants.ts`, as the server
  suite's tests import it): `alpine` reads `HARNESS_CONTAINER`, `glibc227` reads
  `HARNESS_CONTAINER_GLIBC227`, `debian` reads `HARNESS_CONTAINER_DEBIAN`.
- `onHostAs(image, user, ...command)`: `docker exec --user <user> <containerOf(image)> …`. `onHost(...command)` stays,
  as `onHostAs('alpine', 'harness', ...command)`, so no existing row changes.
- **`ACCOUNTS`**, the alias table: each alias of §3.2 maps to `{image, user}`. For example, `glibc227` →
  `{image: 'glibc227', user: 'harness'}`, `glibc227-sysroot` → `{image: 'glibc227', user: 'harness-sysroot'}`, `debian-aarch64` →
  `{image: 'debian', user: 'harness-aarch64'}`, and `i686` → `{image: 'alpine', user: 'harness-i686'}`. An alias not in
  the table is `{image: 'alpine', user: 'harness'}`, today's rule.
- **`openWindow(alias, folder)`, the folder rule:** with `{image, user}` from `ACCOUNTS`, it makes
  `/home/<user>/<folder>` with `onHostAs(image, user, 'mkdir', '-p', …)`, and opens
  `vscode-remote://ssh-remote+<alias>/home/<user>/<folder>`. For `harness` and the other unlisted aliases, that is
  today's path.
- **Rows** (`tests/acceptance/windows/harness.test.ts` or the tools rows that already cover the harness helpers):
  `containerOf` reads the three variables; `onHostAs` builds the `docker exec` arguments; `openWindow`'s path for
  `glibc227-sysroot` is `/home/harness-sysroot/<folder>`, and for `harness` it's unchanged.

**The window titles.** `pageOf` finds a window only by the launch's `window.title` `[${rootName}]`
(`isWindowTitled`, `renderer.ts:84-88`: `[name]` or `[name [`), so the `prereqs` launch keeps that setting. The default
title AC-1 and AC-4 quote, `<folder> [SSH: <alias>] - …` and `<folder> [SSH] - …`, is core's rendering of the window
title: a core half (#475 (a)), and no row reads it.
- `statusText(name, entryId)` (`renderer.ts`): the text of the status bar entry `#<entryId>`. The remote indicator's id
  is measured in the pinned build and written into the PR.

## 4. Rows

**`tests/acceptance/prereqs/prerequisites.test.ts`.** Every failing window's script ends with `failureDialog` →
`dismiss`, `mitigationPick` → `dismiss`, unless the row says otherwise.
- **"The S144 dialog"** is `Could not establish connection to "<alias>": The remote host does not meet the
  prerequisites for running VS Code Server.`. That's STR:S144, F-2601's reason, shown.
- **STR:S145** is `The remote host may not meet VS Code Server's prerequisites for glibc and libstdc++`. It's never
  shown, only logged (F-2401 §3.4).

| Cite | Window, alias; settings or script | Expected |
|---|---|---|
| F-2401 AC-3 | `p3` on `glibc227` | the S144 dialog with `Retry`, `More Actions...`, `Close Remote`; it comes within 5 s of the connect log's authentication line |
| F-2401 AC-4 | `p3` | `onHostAs('glibc227', 'harness', 'ps', '-eo', 'args')` shows no server process; no notification remains (coverage-25a's `notifications`, #644; until it merges, this clause stays `todo` and the row says so). The title and the indicator's "Disconnected from SSH" are core's halves (#475 (a); F-2305 AC-37 is `core` for the same indicator text) |
| F-2401 AC-5 | `p5` on `glibc227`, `useExecServer` false | the S144 dialog; the download host's log has a request of `p5`'s connect before it |
| F-2401 AC-6 | `p6` on `glibc227`, `useLocalServer` false; `platformPick` → `linux` | the S144 dialog |
| F-2401 AC-7 | `onHostAs('glibc227', 'harness-sysroot', 'cp', '.profile.plain', '.profile')`; `p7` on `glibc227-sysroot`; script `failureDialog` → `{button: 'Retry'}`, then `failureDialog` held with `after: 'fixed'` → `{button: 'Retry'}`. Once `heldLines('p7')` shows the held line, `onHostAs('glibc227', 'harness-sysroot', …)` writes the variables back into `.profile` and the row runs `signal('fixed')` | two S144 dialogs with the same text, then `p7` connected (AC-13's outcome) |
| F-2401 AC-8 | `p8` on `glibc227`; `failureDialog` → `{button: 'More Actions...'}`, `mitigationPick` → `dismiss` | a `mitigationPick` line titled `Pick an action to help resolve the problem.` with F-2602's items and none naming prerequisites |
| F-2401 AC-9 | `p3`'s connect | `connectionLog()` has a line with S145's text and one with S144's text. No record line's `question`, `detail`, `items` or `buttons` holds S145's text. The S144 dialog of AC-3 is the visible reason, and it doesn't contain S145 (`may not meet` isn't in S144) |
| F-2401 AC-13 | `p13` on `glibc227-sysroot` | no failure dialog of ours; the window resolves; `waitForDialog('p13')` (tooling-33's helper, #716; until it merges, this clause stays `todo`) gives core's unsupported-OS dialog with `Learn More`, `Cancel`, `Allow` |
| F-2401 AC-15 | after `p3` | the user settings file equals `prereqs-settings.json` byte for byte; a second window `p15` on `glibc227` gives the S144 dialog, and its connect log shows the probe again |
| F-2401 AC-1 | `p1` on `debian-aarch64` | connected (`windowState('p1').remoteAuthority` is `ssh-remote+debian-aarch64`); no `failureDialog` and no `notice` line of `p1`. The title is core's half (#475 (a)) |
| F-2401 AC-10 | `p10` on `i686` | dialog `Could not establish connection to "i686": The remote host's architecture is not supported.` within 2 s of authentication; no download host request during `p10`'s connect |
| F-2401 AC-11 | `p11` on `armv7l` | no record line naming S146's or S147's text (the outcome is the download's) |
| F-2401 AC-12 | `p12` on `freebsd` | a `failureDialog` line with `Retry`, `More Actions...`, `Close Remote`, whose reason is absent or S148; `onHostAs('alpine', 'root', 'ps', '-eo', 'user,args')` shows no server process of `harness-freebsd` |
| F-2401 AC-18 | `p18` on `sunos` | a `failureDialog` line no later than 17 s after the connect's first record line, reason absent or S148; no server process of `harness-sunos`; `onHostAs('alpine', 'harness-sunos', 'ls', '-A')` lists nothing beyond the files the image gave its home |

**F-2401 AC-12's other half** (`remote.SSH.remotePlatform` `windows` for a Linux host) is a failing connect in
`suite-failure/cases.json`: alias `harness`, label `platform-windows`, settings `{"remote.SSH.remotePlatform":
{"harness": "windows"}}`, dialog `Could not establish connection to "harness".` or that text with S148 as its reason.
Measure which one our build gives, write it in, and cite `F-2401 AC-12 (platform-windows)`.

**`tests/acceptance/suite-debian/debian.test.ts`** (F-3902 AC-1):
- the connect log names a download URL ending `vscodium-reh-linux-<arch>-<version>.tar.gz` on `github.com/VSCodium`;
- `onHostAs('debian', 'harness', 'ls', '-A', '/home/harness')` and the server folder's listing show `/home/harness/<the product's server folder>/bin/<commit>/` and no
  `.vscode-server`;
- no `licenceModal` record line;
- `vscode.env.remoteName` is `ssh-remote`.

Catalogue: every AC above goes from `todo` to `acceptance`, except the clauses that wait for #644 or #716, which stay
`todo` with that reason.

## 5. Gates and review

All gates, shellcheck on `start-sshd` and `uname-shim`, the changed tools files at 100 %, the server suite, the
variants run, and the full VSCodium run green. Paste the `prereqs` and `suite-debian` summaries and the `sshd -T`
excerpts.

**The PR opens with the `needs-verification` label.** proteus checks:
- the run's added time (two more containers and one GitHub download);
- that both images build on the x64 and arm64 runners.

PR title `tests: glibc 2.27 and Debian host images, a uname shim and a sysroot account (card tooling-35, #718)`. themis
or triton reviews; athena gives the design check of §2 and the tag check.

## 6. Open rows (stop and report on #718)

1. **The prerequisite failure:** `glibc227` ends with something other than the S144 dialog. Report the record and the
   connection log. The prerequisite failure comes from the server's own check (`LinuxPrereqs`), and this card doesn't
   add one.
2. **The sysroot:** it doesn't let the server start on `glibc227-sysroot`. Report the server's output, and leave AC-13
   and AC-7's second half `todo`. Don't build a sysroot with crosstool-ng by guess.
3. **Debian's download:** the `debian` container can't reach `github.com`. Report it to proteus. F-3902 AC-1 stays
   `todo`.
4. **The shim:** it can't reach the probe's `PATH` on an image. Report which, and how the probe runs `uname` there.
5. **patchelf's download** fails in the image build (GitHub unreachable, or the sha256 differs). Report it to proteus.
   AC-13 and AC-7's second half stay `todo`.

**Overlap with tooling-37 Part 2 (#720):** both cards edit `start-sshd`'s `HOST_FETCH` `case`. tooling-37 turns it into
`harness-fetch "${HOST_FETCH:-busybox-wget}"`, and this card adds the `busybox-wget`-needs-BusyBox exit for the Debian
images. Whichever lands second moves that exit into `harness-fetch`, for `busybox-wget` without `/bin/busybox`.
