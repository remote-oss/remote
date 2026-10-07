# ADR-NNNN: Dev Containers drives the dev container CLI as a pinned, spawned program behind one bridge

- Status: proposed (draft by `remote-architect-worker-3` for the lead, who assigns the number). The policy in
  decision 2 was accepted by the lead on 2026-10-06 with the dossier.
- Date: 2026-10-06
- Deciders: the lead; an upstream contribution is a public action and goes through the register (R-xx) when it arises
- Scope: `remote-containers` (components C3a–C3e, and every component that needs a CLI operation)
- Requirements:
  - remote-containers F-0301–F-0306, F-0408–F-0418, F-0601, F-0701, F-0801–F-0807, F-1201, F-1302;
  - ADR-0005 decision 1 and R-76 (the CLI as dependency and source), ADR-0002 (no native modules without an ADR),
    ADR-0006 (the product profile), D-27 (conformance as the definition of done).

## Context

ADR-0005 makes `@devcontainers/cli` the engine of configuration, features, build, create and lifecycle hooks, and
leaves open whether it is driven as a library or a program. Reading `[devcontainers-cli]` 0.89.0 settles it: the
package publishes one bundled program (`devcontainer.js`, `dist/spec-node/devContainersSpecCLI.js`) and no `main`,
`exports` or types, so there is no supported library surface. It needs Node 20 or later. It prints one JSON result
line on stdout and, with `--log-format json`, one JSON log event per line on stderr; it keeps running after the
result line to finish non-blocking lifecycle commands (`src/spec-node/devContainersSpecCLI.ts`). It loads `node-pty`
through `NODE_PATH` first and falls back to plain pipes when the module is absent (`src/spec-common/commonUtils.ts`
`loadNativeModule`).

The specs fix observable behaviour that the CLI produces in most places and contradicts in six: an empty
`${localEnv:VAR:default}` (F-0304 BR-5a), `${containerEnv}` in `initializeCommand`, the source of `localEnv`, the
second substitution pass without a container, the workspace mount root (F-0301 §6.5, F-0302 BR-14), and attach
configuration files that `up --config` rejects by name. The recorded conformance cases were made against a
reference that bundles CLI 0.89.0 (F-1201).

## Decision

1. **A spawned program, pinned.** The extension bundles `@devcontainers/cli` at exactly 0.89.0 and runs it as a child
   process, locally with the editor's own Node (`ELECTRON_RUN_AS_NODE`), on a remote host with the installed
   server's Node (F-1302, C19). We ship no Node of our own. A version change is a conformance run, not a dependency
   bump: the matrix's cases must pass on the new version before the pin moves.
2. **Deviations are absorbed in this order:** (a) command-line flags (`--mount-workspace-git-root=false`, explicit
   `--id-label`, `--docker-path`, `--docker-compose-path`, `--log-format json`); (b) a pre-pass that writes an
   `--override-config` file and sets the spawn environment (C3b); (c) post-processing of the parsed result (C3c,
   C4d); (d) an upstream change, only when (a)–(c) cannot reach the behaviour, proposed through the register; never a
   fork or a patched copy without a new ADR.
3. **One bridge.** Only C3d spawns the CLI. C3a builds arguments, C3b prepares overrides, C3c parses; all three are
   pure. Flows never see CLI text, exit codes or log lines, only typed results and failures.
4. **No native module of ours.** `NODE_PATH` points at the running editor's own `node_modules`, so the CLI uses the
   editor's `node-pty` when the editor ships one; otherwise it runs without a PTY. We never bundle `node-pty`
   (ADR-0002). Lifecycle output reaches the log terminal through the JSON log events, so no case depends on a PTY.
5. **Process lifetime.** The result line ends the operation for the caller; the process is kept and logged until it
   exits; cancellation kills the whole tree (F-1302 BR-10).

## Options considered

| Option | For | Against |
|---|---|---|
| Spawned program, pinned, one bridge (chosen) | The package's only supported surface; the recorded cases' version; one place to test | Startup cost per operation; output parsing |
| Import the CLI's modules as a library | No process per call | No published API; internal paths change per release; native module in the extension host |
| Reimplement configuration and lifecycle | Full control of the six deviations | Months of work on a solved problem; ruled out by ADR-0005 |
| Fork and patch the six deviations | Exact behaviour | A fork to maintain; leaves the specification's reference implementation |

## Consequences

- The traceability matrix marks the CLI's share per feature through the contributors C3a–C3d.
- The six deviations are named rules in C3b with unit tests against recorded CLI outputs (fixtures made from the
  public CLI, never from the reference).
- The CLI bundle is copied to a remote host for F-1302 (C19), so its size and licence notice travel with it;
  `check-licences` lists it.
- Open: whether the fallback without `node-pty` changes any recorded log-terminal case (to verify on the first
  coding target that runs `up`).

## Check

`check-licences` lists `@devcontainers/cli` 0.89.0 (MIT) and no `node-pty`; a lint forbids `child_process` imports
outside C2d and C3d; the conformance suite passes on the pinned version.
