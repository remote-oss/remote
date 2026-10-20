# Task card containers-68: the shutdown helper, its registry, the delayed check and the stop (F-0417, C9)

Containers increment 2, shutdown. Size: L. Builder: `task:claude`. Design: athena's C9 ruling on #737 (2026-10-20),
point 2 (the registry is the helper's memory) and point 3 (the lease, the 10 s delay, the check, the stop). Spec:
remote-oss/remote-containers#62 (F-0417): BR-2, BR-3, BR-4, BR-5, BR-7 (for image and Dockerfile), BR-8, BR-10, BR-11
and BR-12. Compose (`stopCompose`'s kill and `runServices`) stays with F-0413. **Depends on helper-05 (#1223)** for the
helper's start only, so the pure parts can start at once. The window side is containers-69.

## 1. Files (remote-containers)

- `src/shutdown/protocol.ts`: the messages, as plain data.
- `src/shutdown/registry.ts`: the registry and its decisions. It's pure, with a fake clock and a fake engine in the
  tests.
- `src/shutdown/shutdown-handler.ts`: lib-helper's `MessageHandler` over the registry.
- `src/shutdown/effective-action.ts`: the value of BR-2.
- `src/programs/shutdown-helper.ts`: the program, wired like remote-ssh's `programs/connection-helper.ts`
  (`helperParameters`, `nodeEndpointPort`, `nodeFilePort`, `nodeTimer`, `runHelper`-style `serve`). Listed in
  `coverage.json` as remote-ssh's helper program is.
- `src/programs/helper-launcher.ts`: the two-line launcher of helper-05.

## 2. The protocol (`protocol.ts`)

```ts
/** The engine a connection used (BR-13): no secret, only where `docker` is and the variables that pick the engine. */
export interface EngineCoordinates {
  dockerPath: string;
  /** `DOCKER_CONTEXT` and `DOCKER_HOST` as the connection's engine had them; absent when unset. */
  environment: Readonly<Record<string, string>>;
}
/** What identifies a dev container before its id is known: the folder and configuration it's for. */
export interface ContainerIdentity {
  hostPath: string;
  configFile: string; // the configuration file's path on the host
}
export type ShutdownRequest =
  | {type: 'register'; connectionId: string; identity: ContainerIdentity; engine: EngineCoordinates}
  | {type: 'container'; connectionId: string; containerId: string; action: 'stop' | 'none'}
  | {type: 'leave'; connectionId: string};
export type ShutdownReply = {accepted: true} | {accepted: false; problem: string};
```

- `register` comes when the window's target is identified (BR-5's timing; containers-69 decides when).
- `container` comes once the window's container is found or created and its effective value read (§4).
- `leave` comes when the window leaves the container without its lease closing (BR-9: Reopen Folder Locally,
  Rebuild, a reopen elsewhere).
- An unknown connection id in `container` or `leave` answers `{accepted: false, problem: 'unknown connection'}` and changes
  nothing. A malformed message gets the same answer, with its problem.

## 3. The registry (`registry.ts`)

State:
- `connections: Map<connectionId, {leaseId, identity, engine, containerId?, action?, live: boolean}>`. A connection
  belongs to the lease that registered it.

**Ends** (each one exactly once per connection, BR-8): a `leave`, or the close of its lease (lib-helper's
`onLeasesChanged`: a lease id that's gone ends every live connection it holds). An ended connection is no longer
live, which is BR-5's "ends, leaves or loses the connection". Then:
- **`action` is `'none'`:** nothing more, with no Docker command (BR-12).
- **`action` is `'stop'` and `containerId` is known:** schedule **one check** after exactly 10 s (BR-3).
- **No `containerId` yet** (the window ended while its connect was still finding or starting the container, BR-8,
  6.14): schedule a **lookup** after 10 s:
  - `docker ps -q --filter label=devcontainer.local_folder=<hostPath> --filter label=devcontainer.config_file=<configFile>`
    through the connection's engine;
  - a running container found that way gets its check at once, with `action` `'stop'` (the default of BR-1, since
    nothing was read). This assumes an image or Dockerfile configuration, as F-0417's first cards do;
  - when none is running, repeat the lookup every 10 s, at most 12 times (AC-58's 120 s), then give up.

**The check** (BR-5, BR-7, image and Dockerfile): the container is **in use** when another **live** connection has
the same `containerId`, or the same `identity` (a reload or a reopen registers its identity at once and counts before
it knows the id, AC-24, AC-51, AC-61). Then:
- **Not in use:** `docker stop <containerId>` through the connection's engine (dockerPath, with
  `environment` added to the helper's environment). That's Docker's default 10 s grace, then a kill (BR-4).
- **In use:** nothing. The container is left as it is, and nothing re-checks for this connection (BR-8). BR-7's memory
  of skipped containers matters only for Compose, so it isn't built here.

A failed `docker` run (it can't start, exits non-zero, or no such container) is logged to the helper's log and not
retried (BR-11, AC-27, AC-28, AC-46). Nothing is ever shown (BR-10).

**The end policy:** `delayedCheckAfterLastLease(10_000, 'drain')`. `runAction('drain')` awaits every scheduled check
and lookup (their promises) before it returns, so the helper ends only with no lease and no pending obligation. A new
lease within the policy's delay cancels the end, as lib-helper does. Pending checks keep running regardless.

The registry takes its ports, so the tests use fakes:

```ts
export interface RegistryPorts {
  runDocker(engine: EngineCoordinates, argv: readonly string[]): Promise<{status: number | undefined; stdout: string}>;
  setTimer(milliseconds: number, callback: () => void): () => void;
  logLine(line: string): void;
}
```

The program's `runDocker` uses `node:child_process` `execFile` with `{env: {...inherited, ...engine.environment}}`
and `inheritedEnvironment(process.env)` from lib-helper.

## 4. The effective value (`effective-action.ts`, used by containers-69)

```ts
/** BR-2: the value recorded on the container, or the file's when the container has no metadata label. */
export function effectiveAction(recorded: readonly unknown[] | undefined, fileValue: unknown): 'stop' | 'none';
```

- `recorded` is the container's `devcontainer.metadata` label entries in order, or `undefined` when the container has
  no such label (AC-69).
- The value is the **last** `shutdownAction` key among the entries; with no label, it's `fileValue`.
- Then:
  - absent, `null`, `false`, `0` or `""` gives the kind's default, which is `'stop'` for image and Dockerfile
    (AC-1, AC-3, AC-70);
  - `"stopContainer"` and `"stopCompose"` give `'stop'` (AC-2, AC-9's image half);
  - any other value gives `'none'` (AC-4, AC-65, AC-70's `1`).
- A label that has entries but no `shutdownAction` among them gives the default, even when the file says otherwise.
  That's AC-67, and AC-69's second half (an image label without the key): the label wins whenever it exists.

## 5. Rows

**Unit**, in `packages/remote-containers/test/unit/`, named after the criteria:
- `effective-action.test.ts`: AC-1, 2, 5, 6, 7, 8 (the recorded value wins over a later edit), 9, 65, 67, 69, 70;
  every branch is one row.
- `shutdown-registry.test.ts`, over a fake clock and a fake `runDocker`:
  - a single connection ending stops at exactly 10 s (AC-1);
  - `none` issues no Docker command (AC-4, BR-12);
  - a reload's `register` of the same identity within the 10 s keeps it running (AC-24), and one arriving after the
    check doesn't (AC-60's reload that fails before the check);
  - the same container id held by another live connection keeps it (BR-5);
  - a failed stop isn't retried and is logged (AC-27, AC-28);
  - `docker stop` on a container already exited is one call, not retried (AC-46);
  - an end before the container id is known looks up by labels, finds nothing and then a container on the third
    lookup, and stops it (AC-57, AC-58);
  - `leave` ends the connection once, and a later lease close changes nothing more (BR-8);
  - a lease that closes ends every connection it holds (AC-23, AC-50's image half);
  - unknown and malformed messages are answered and change nothing;
  - `drain` awaits the pending checks.
- `shutdown-handler.test.ts`: requests reach the registry, and lease changes end connections.

**Acceptance** comes with containers-69, which makes the window use this helper.

## 6. Done when

- The remote-containers unit tests pass with `src/shutdown/*` at 100 %.
- `pnpm package` bundles `dist/shutdown-helper.js` and `dist/helper-launcher.js` (the package-view golden file gains
  them).
- All gates pass. PR title: `remote-containers: the shutdown helper, its registry, the delayed check and the stop (card
  containers-68, #1225)`. Request athena only.
