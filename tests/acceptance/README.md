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
