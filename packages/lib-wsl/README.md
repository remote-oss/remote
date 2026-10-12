# lib-wsl

The pure parts of the WSL support: the decoding and parsing of the text `wsl.exe` prints when it manages
distros, the matching of a typed distro name against the registered names, and the path forms of the distro
shares. Nothing in it starts a process or touches a file, so every function takes text or names and returns
a value.

It is bundled into the extensions that use it and never published on its own.

## For maintainers

| | |
|---|---|
| Maintainers | remote-oss |
| Entry points | `lib-wsl` (`src/index.ts`) |
| Allowed imports | none |
| Coverage exclusions | none |
