# ADR-NNNN: One engine abstraction resolves program, endpoint and execution host once per attempt

- Status: proposed (draft by `remote-architect-worker-3` for the lead, who assigns the number)
- Date: 2026-10-06
- Deciders: the lead
- Scope: `remote-containers` (components C2a–C2i, C11, C19); the WSL implementation of the execution host
  (`remote-wsl`, area D)
- Requirements:
  - remote-containers F-0201, F-0202, F-0203, F-0205, F-0206, F-0207, F-1301, F-1302, F-0604, F-0605;
  - the conformance cases of F-0201 (73) and F-0409 (64);
  - ADR-0004 (native OpenSSH for SSH endpoints), the container view §2 (remote-side scripts rule).

## Context

Every container operation needs three answers before it runs: which program (the `dockerPath` and
`dockerComposePath` settings, taken literally, F-0201 BR-1; Podman by setting the path), which endpoint (the current
context, `DOCKER_HOST` and three more variables merged from four sources, F-0205), and where the program runs (the
local machine, a WSL distro, or the window's remote host, F-0207, F-1301, F-1302). The specs require one answer per
attempt, used for every call of that attempt, re-read on the next attempt and never cached (F-0201 BR-2, BR-9), and
they distinguish bounded check calls from unbounded setup calls (F-0201 BR-14). The catalogue spread endpoint
selection over three libraries (component doubts, rows F-0201, F-0202, F-0205, F-0207, F-1301). The dev container
CLI accepts a program path and inherits its environment, and does nothing else of this (`[devcontainers-cli]`
`src/spec-shutdown/dockerUtils.ts`).

## Decision

1. **Three pure resolvers, one attempt context.** C2a turns a setting value into a spawn target, C2b merges the
   endpoint variables, C2c names the execution host. Their results form the attempt context, made once at the
   attempt's start and passed to every engine call and every CLI call (C3) of that attempt.
2. **The execution host is a port.** The local implementation lives in `remote-containers`; the WSL implementation
   is area D's (`wsl.exe`, path mapping); the remote implementation (C19) runs over the window's `lib-host` channel,
   so `remote-containers` imports `lib-ssh` (lead's ruling 8). Tunnels have no host channel, so F-1302 over a tunnel
   is out of scope until they do.
3. **Two spawn points.** C2d spawns engine programs and C3d the CLI; nothing else in the package spawns. C2d has two
   call classes: `check` (timeboxed, default 60 s, child killed) and `run` (unbounded).
4. **Classification is pure and closed.** C2f maps spawn errors and stderr to a closed set of verdicts; flows and the
   connector see verdicts, never text. Each verdict carries the dialog variant the specs fix by location.
5. **Endpoint variables only.** The engine sees exactly `DOCKER_HOST`, `DOCKER_CONTEXT`, `DOCKER_CERT_PATH` and
   `DOCKER_TLS_VERIFY` from the merge (F-0205 BR-18); a settings `DOCKER_HOST` wins over a named context (F-0205
   Q1); SSH endpoints use the system's OpenSSH through `SSH_ASKPASS` (ADR-0004), never an SSH library.
6. **Kubernetes and Apple containers** use the same attempt context with their own programs (`kubectl`,
   `container`) and skip the Docker checks where the specs say so (F-0604, F-0605).

## Options considered

| Option | For | Against |
|---|---|---|
| One attempt context from three pure resolvers (chosen) | One answer per attempt as the specs require; pure parts testable alone; D plugs in a WSL host | A context object threaded through every call |
| A global engine service with cached state | Less plumbing | Contradicts "re-read per attempt" and "bound to the window's endpoint"; hidden state across windows |
| Let the dev container CLI resolve everything | Less code | It resolves nothing of this; checks, dialogs, askpass and WSL routing would be missing |
| Endpoint selection per library (catalogue) | Close to the features | Three places to keep consistent; the doubt the catalogue raised |

## Consequences

- The F-0201 coding brief needs only C2a, C2b, C2d, C2e, C2f and a dialog port: the first containers target has no
  resolver, no CLI and no server.
- Area D implements C2c for a distro and nothing else of the engine.
- A lint forbids `child_process` outside C2d and C3d (shared with the CLI bridge ADR).
- Open: whether the 60 s default suits remote endpoints over SSH (F-0201 Q5 allows 30–60 s).

## Check

Unit tests of C2a, C2b, C2f against every rule of F-0201 BR-1, F-0205 BR-13/BR-18/Q1 and the verdict table; the
F-0201 conformance cases (73) pass in the runner.
