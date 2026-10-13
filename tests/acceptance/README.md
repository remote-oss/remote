# Acceptance tests

The acceptance tests run in the editor under test, with the packaged extensions installed, against an SSH host in a
container. They prove the wiring and the host interaction; what the libraries decide on their own is unit-tested in
the packages.

```sh
pnpm test:acceptance    # on Linux without a display: xvfb-run --auto-servernum pnpm test:acceptance
```

The command packages the extensions, then `tools/acceptance.ts`:

1. builds the host image from `host/` (Alpine with OpenSSH's server and libstdc++, key login only, the user `harness` with the
   POSIX `sh` login shell, TCP forwarding allowed);
2. makes an Ed25519 key pair for the run and starts the host with its public key on a free local port;
3. writes an `ssh_config` whose `Host harness` reaches the host with that key, its own known-hosts file and no agent,
   sets it as `remote.SSH.configFile` in the editor's user settings, and waits until the host accepts SSH;
4. bundles `suite/*.test.ts` into `dist/` and starts `@vscode/test-cli` with `vscode-test.mjs`: VS Code 1.139.1, a
   fresh user-data and extensions folder, the packaged VSIX of each extension under test, and the proposed API
   enabled for them on the command line;
5. removes the container and the run's folder, whatever the outcome.

Prerequisites: Node.js and pnpm as for the repository, Docker (or Podman behind the `docker` command), the OpenSSH
client, and on Linux without a display, `xvfb`.

## Writing a test

A test file is `suite/<area>.test.ts` and uses Mocha's `describe` and `it`; a test is named after the criterion it
proves. `suite/harness.ts` gives:

- `overSsh(command)`: the output of a command run on the host through the harness's SSH configuration;
- `onHost(...command)`: the output of a command run in the host container directly (`docker exec`), to check what an
  extension did there.

The extension host sees these variables:

| Variable | Value |
|---|---|
| `REMOTE_OSS_ACCEPTANCE` | `1`. The one switch with which an extension installs its harness adapters: dialogs answered from a script and recorded, the log readable by the tests. A user's editor never sets it. A package reads it in exactly one place, the adapter selection at activation, and no shipped README or string mentions it. |
| `HARNESS_SSH_CONFIG` | The `ssh_config` with `Host harness`, also set as `remote.SSH.configFile` in the user settings. |
| `HARNESS_CONTAINER` | The host container's id. |
| `HARNESS_RUN_FOLDER` | The run's folder: keys, known hosts, user data, extensions. |
| `HARNESS_VSIX_FILES` | The VSIX files installed, separated by the platform's path delimiter. |
| `REMOTE_OSS_ACCEPTANCE_SCRIPT` | The JSON file `{"entries": [...]}` that remote-ssh's scripted adapters answer from. Each entry names a surface, a text the question must contain, and the answer; the adapters answer only the next entry in order, dismiss anything else, and the licence modal can only be declined. |
| `REMOTE_OSS_ACCEPTANCE_RECORD` | The file the adapters append one JSON line per question to: the surface, the question, the answer (a masked input's text is `<supplied>`) and whether an entry matched. |

The extension reads the script when it activates, once per window. A test that needs its own script writes it before it opens the window that connects.

## The server lifecycle without the editor

`pnpm test:acceptance:server` runs `server/*.test.ts` in plain Node.js against the same host: the probe, install,
start, lock, kill, uninstall and clean-up of lib-server through the SSH host channel, with a stand-in server built by
the test and copied in with `docker cp`, so it needs no download. `pnpm test:acceptance:real-server` runs the one
file that installs and starts the real VSCodium server for musl (about 125 MB, fetched through the product fixture's
template into a folder of the temporary directory that the run removes): once downloaded by the host, once with the
host's download hosts made unreachable so that the client downloads and copies, and once from the archive the client
kept. It is skipped unless `REMOTE_OSS_REAL_SERVER=1`, which that script sets. In CI it runs when the workflow is dispatched with the `real-server` input set to true, and on the tag of a release.

## The run in VSCodium

`pnpm test:acceptance:vscodium` (on Linux without a display, under `xvfb-run --auto-servernum`) runs the harness in the
pinned VSCodium Insiders build named by `VSCODIUM_RELEASE` in `tools/acceptance.ts`: an exact tag, never "latest",
checked against the release's sha256 before it is unpacked into `.vscode-test/`. The stable VSCodium is below the
engines floor of ADR-0007. A mismatch fails the run with `the VSCodium download does not match its checksum`; bumping
the tag is a reviewed change that also updates both checksums.

The VSIX files are installed with the command-line wrapper in the build's `bin/` folder; the tests run in the build's
own executable, which test-cli starts. test-cli runs once per label, in order:

- `local`: `runner/` in a plain window, with the tests of `suite-local/` bundled into `dist-local/`;
- `remote`: `runner-remote/`, an extension of the workspace kind, in a window on
  `vscode-remote://ssh-remote+harness/home/harness`, with the tests of `suite-remote/` bundled into `dist-remote/`;
- `reconnect`: the same window in a second launch, with `suite-reconnect/`. It compares the host's server with the
  one the `remote` launch kept in the run's folder, so it shows that a new connection reuses the server;
- `failure-<alias>`: one launch per entry of `suite-failure/cases.json`, in a window on
  `vscode-remote://ssh-remote+<alias>/home/harness`, with `suite-failure/`. Its alias fails to connect (the harness
  `ssh_config` has `refused`, `nowhere` and `stranger`), and its window answers from the entry's own script, which the
  harness writes before the launch. The tests check the record.

- `terminal`: the same window with `remote.SSH.useLocalServer` off, which is terminal mode, with `suite-terminal/`.

Every label runs even when an earlier one fails, and the run fails when any does. The tests run in the window's
local extension host, also in a window on `ssh-remote`: they see the host through the editor API and `onHost`, and
they start in a window whose connect failed. `HARNESS_EDITOR` (`vscode` or `vscodium`)
and, for VSCodium, `HARNESS_VSCODIUM_EXECUTABLE` join the harness variables. In CI the job `acceptance (VSCodium)` runs
when the workflow is dispatched with the `vscodium` input set to true, and on the tag of a release.

### Launches

`tools/acceptance-launches.ts` holds the table of launches, in the order the run makes them, and nothing else lists
them: the labels, the configurations and the bundled suites all read it. A launch has these fields:

| Field | Meaning |
|---|---|
| `label` | the test-cli label: lower-case letters, digits and hyphens |
| `runner` | `runner` (a local window) or `runner-remote` (a remote one) |
| `suite` | the folder under `tests/acceptance`, bundled into `dist-<name without "suite-">` |
| `folderUri` | the window's folder; none for a local window |
| `settings` | merged over the run's base settings, for this launch only; the base settings are written again before a launch without any |
| `environment` | added to the extension host's environment for this launch only; a key of the launch overrides the harness variable of the same name |
| `ownScript` | the launch answers from its own `<label>-script.json` and `<label>-record.jsonl` |
| `extraExtensions` | further development extensions, folders under `tests/acceptance`, loaded after the runner |

To add a launch: add a row to `launchesOf`, put its tests in the suite folder it names, and add that folder to
`tests/acceptance/tsconfig.json` and to the entries of `knip.jsonc`.

## Host variants

The default host has the login shell BusyBox `sh` and BusyBox `wget`. One image carries every variant, and the variant
is chosen when the container starts, by an environment variable of `start-sshd`:

| Variable | Values | What `start-sshd` does |
|---|---|---|
| `HOST_FETCH` | `busybox-wget` (the default), `gnu-wget`, `curl`, `none` | removes the download tools the variant leaves out with `rm`, never `apk del` (which puts BusyBox's `wget` link back), and for `busybox-wget` links `/usr/bin/wget` to BusyBox |
| `HOST_SHELL` | `/bin/sh` (the default), `/bin/bash`, `/bin/zsh`, `/usr/bin/dash`, `/usr/bin/fish`, `/bin/tcsh`, `/bin/csh`, `/bin/mksh` | sets the login shell of the user `harness` with `usermod -s` |

`startHost({fetch, shell})` in `server/host-fixture.ts` starts a host with a variant of either kind. After `none` the host has neither `wget`
nor `curl` as the install script looks for them; `busybox wget` can still be called by that name.

`pnpm test:acceptance:variants` runs `server/fetch-tools.test.ts` once per download tool, each in its own mocha run on
its own host (`HARNESS_HOST_FETCH` picks the tool; unset, the file goes through all four). The rows serve the
stand-in archive from the host itself with BusyBox `nc`, so nothing leaves the machine; the client download of the
`none` variant reaches the same source through an `ssh -L` forward of the harness configuration. The rest of `server/`
runs once on the default host, in `pnpm test:acceptance:server`.

`pnpm test:acceptance:variants` also runs the login-shell files once per shell (`HARNESS_HOST_SHELL` picks the shell; unset,
all eight), each in its own mocha run on its own host: `server/login-shell-variant.test.ts` pins the shell the host
reports, and `server/login-shells.test.ts`, `server/start.test.ts` and `server/shared-session.test.ts` prove that every
session hands its commands to POSIX `sh` whatever the login shell is.

## The host's other accounts (D-85)

Besides `harness`, the host image has three users, and the run's `ssh_config` has an alias for each use of them. The
`Match User` blocks that give them their rules are at the end of `/etc/ssh/sshd_config`: Alpine includes
`sshd_config.d/` at the top of the file, where a `Match` would swallow every line after it.

| Alias | User | What it is for |
|---|---|---|
| `password` | `harness-pw` | login by password only (no public key); the password is the run's own, 24 letters and digits |
| `noforward` | `harness-nofwd` | the run's key; sshd refuses TCP forwarding (`AllowTcpForwarding no`) |
| `mute` | `harness-mute` | the run's key; the login shell `/usr/local/bin/mute-shell` runs a command given with `-c` and otherwise never answers |
| `master` | `harness-pw` | `password`, behind `ControlMaster auto` (socket `cm-%C` in the run's folder, `ControlPersist 60`) |
| `master-ask` | `harness-pw` | `password`, behind `ControlMaster ask` (socket `cm-ask-%C`) |

The run's password is written to `<run folder>/host.env` (`HOST_PASSWORD=…`, mode 600), which `docker run` reads with
`--env-file`, so it never appears in a command line, and to `<run folder>/password` (the bare password, mode 600), whose
path is the harness variable `HARNESS_PASSWORD_FILE`. A test gives it to ssh through an `SSH_ASKPASS` script that prints
it (with `SSH_ASKPASS_REQUIRE=force`), or puts it in a script entry `{surface: 'maskedInput', match, answer: {text}}`,
and the record keeps `<supplied>`. Nothing prints it. `docker inspect` does show `HOST_PASSWORD` in the container's configuration (the env file becomes the container's environment); that is acceptable only because the password is a per-run fake that opens nothing but the run's own throw-away host (R-26). A `ControlPath` is `<run folder>/cm-%C`, about 75 characters on a
Linux runner, under the 108 of a socket path.

`server/host-accounts.test.ts` shows each account does what it is for.
