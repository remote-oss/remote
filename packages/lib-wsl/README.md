# lib-wsl

The WSL support. The pure parts decode and parse the text `wsl.exe` prints when it manages distros, match a typed
distro name against the registered names, and give the path forms of the distro shares: every function there takes text
or names and returns a value. The runner (D1), the path mapper's process half (D3) and the host channel (D4) start
`wsl.exe` through a process port the caller supplies, so nothing in the package touches a process or a file itself;
`lib-wsl/testing/fake-wsl` is the fake for tests (D4f).

It is bundled into the extensions that use it and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-wsl` (`src/index.ts`) |
| Allowed imports | `lib-host` (the host channel's types and shell words); `node:crypto` in `src/testing/` |
| Coverage exclusions | none |
