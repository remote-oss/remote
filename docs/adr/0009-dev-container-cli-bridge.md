# ADR-0009: Drive the dev container CLI as a pinned, spawned program, and bend it without forking

- Status: accepted
- Date: 2026-10-14
- Deciders: the lead (athena), under ADR-0005 and D-52/R-76 (the user's admission of `@devcontainers/cli`)
- Scope: `remote-containers` (component C3, cli-bridge; C4 and C7 through it)
- Requirements: F-0301–F-0306, F-0408, F-0409, F-0411, F-0412, F-0415, F-0416 (remote-oss/remote-containers);
  ADR-0005 decision 1 ("the component view decides" library or program); R-76; the containers dossier §3–§4; D-87

## Context

ADR-0005 makes `@devcontainers/cli` a dependency and leaves open whether it's a library or a program. Its published
package `[devcontainers-cli]` (0.89.0, MIT, Node ≥ 20) has no `main`, `exports` or types. Its contract is the command
line: one JSON result line on stdout (`outcome`, `containerId`, `remoteUser`, `remoteWorkspaceFolder`,
`composeProjectName`, and error fields), JSON log events on stderr with `--log-format json`, and a process that may
outlive its result line for background lifecycle commands (`src/spec-node/devContainersSpecCLI.ts`).

The reference was recorded against a build that bundles CLI 0.89.0 (F-1201). Image names, labels, lifecycle markers
and the `-uid` image are the CLI's, so they match the recordings only at that version.

The specs differ from the CLI's own behaviour in six known places (dossier §4):
1. an empty `${localEnv:VAR:default}` gives the default (F-0304 BR-5a);
2. `${containerEnv}` in `initializeCommand` is empty;
3. `localEnv` is the editor's resolved environment;
4. the window-title `name` needs a second pass without a container;
5. the workspace mount needs `--mount-workspace-git-root=false` (F-0301 §6.5, F-0302 BR-14);
6. attach configurations can't go through `up --config` (not in release 1).

## Decision

1. **A spawned program, pinned.** `@devcontainers/cli` is an exact-version dependency (`0.89.0`, no range), bundled in
   the VSIX. C3 spawns it with the editor's own Node: `process.execPath` with `ELECTRON_RUN_AS_NODE=1` on the
   package's entry script, `shell: false`, through the `CliHost` port (containers contracts §4). No other code imports
   it.
2. **How we bend it, in this order, and only this way:**
   1. **the CLI's own inputs:** the flags it already has (`--mount-workspace-git-root=false`, `--id-label`,
      `--docker-path`, …) and the environment it's spawned with;
   2. **a pre-pass** that writes an `--override-config` file, for a value the specs resolve differently;
   3. **post-processing** of the JSON result and log lines.

   Each deviation goes through the first mechanism that reaches it, and C3's card records which (amended 2026-10-14
   on #764, measured on CLI 0.89.0):
   - deviation 1 is the pre-pass, the only one that needs it;
   - deviation 2 needs no mechanism, because the CLI already makes `${containerEnv}` empty in `initializeCommand`;
   - deviation 3 is the spawn environment;
   - deviation 4 is post-processing;
   - deviation 5 is a flag;
   - deviation 6 waits for attach, which isn't in release 1.

   A deviation none of these reaches is an upstream change to `devcontainers/cli` (MIT) and waits for its release.
   **We never fork, patch or vendor-modify the CLI.** A fork would need its own ADR.
3. **Its output is a contract.** C3 parses only the documented JSON result line and the JSON log events. Every field C3
   reads has a parser row over a recorded line of 0.89.0. An unknown field is ignored. A missing one is a typed
   failure, never a guess.
4. **An upgrade is a conformance run, not a dependency bump.** Changing the pinned version needs the containers
   recorded gate (D-87: F-0201, F-0409) and the acceptance gate green on the new version in the same PR, and a design
   check.
5. **Secrets:** no secret reaches the CLI's argv. Values the CLI must see go through its environment or a mode-0600
   override file in the extension's own storage, deleted after the run (R-26).

## Options considered

| Option | For | Against |
|---|---|---|
| A spawned program, pinned (chosen) | the CLI's real interface; the version the recordings were made with; isolation from its internals | a process per operation; output parsing |
| Import it as a library | no process cost | there's no public library interface, so we'd depend on internals that change without notice |
| Fork it | full control over each deviation | a second codebase to maintain; drift from the specification it implements; against the user's "don't rebuild the wheel" (ADR-0005) |

## Consequences

- C3 is a thin, well-tested adapter: an argument builder, an override-file writer and a JSON-line parser. Each is a
  pure module with its own rows.
- The VSIX carries the CLI and its dependencies. `check-licences` must admit them, and their licences go into the
  third-party notices.
- A behaviour the specs require and the CLI can't be bent into is either an upstream issue we file, citing the
  spec, or a recorded deviation in the release notes. It's never a local patch.
- The six known deviations each get a row naming which of the three mechanisms absorbs them.

## Check

- **Review:** a PR that imports from `@devcontainers/cli` anywhere but C3, or that patches its files, fails the design
  check.
- **`package.json`:** the dependency has no range operator, and a unit row in remote-containers' manifest tests asserts
  that.
- **C3's parser rows** run over recorded 0.89.0 output lines.
- **An upgrade** follows decision 4.
