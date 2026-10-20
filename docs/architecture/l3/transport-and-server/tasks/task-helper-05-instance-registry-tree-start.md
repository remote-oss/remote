# Task card helper-05: lib-helper's instance-scoped registry and a start that leaves the starter's process tree (C9)

Containers increment 2, shutdown. Size: M. Builder: `task:claude`. Design: athena's C9 ruling on #737 (2026-10-20),
points 1 and 4, and proteus's confirmation there (area A), whose conditions are part of this card. Contract:
`docs/architecture/l3/transport-and-server/contracts.md` §9. This card amends it in the same PR, adding what's below
under X1, X3 and the start. Consumer: containers-68/69 (the shutdown helper).

## 1. The instance-scoped registry folder

**`src/registry/instance-folder.ts`** (new), a pure function:

```ts
/** Where a helper shared by every profile of one editor instance keeps its records, or why there's no such place. */
export type InstanceFolder = {kind: 'resolved'; folder: string} | {kind: 'unresolved'};
/**
 * The instance's registry folder for the extension whose global storage folder is `globalStorageFolder`:
 * `<user-data>/User/globalStorage/<extension folder>/instance-registry`, from the default profile's
 * `<user-data>/User/globalStorage/<extension folder>` or a named profile's
 * `<user-data>/User/profiles/<id>/globalStorage/<extension folder>`.
 */
export function instanceRegistryFolder(globalStorageFolder: string): InstanceFolder;
```

- Use `path.posix` or `path.win32` by the input's form. Split it into segments and read them **from the end**:
  - the last segment is the extension's folder (non-empty);
  - before it comes `globalStorage`;
  - before that comes either `User`, or `profiles`, `<id>` and then `User`.
- `<user-data>` is everything before that `User`. Because the match runs from the end, a root such as
  `/home/User/.config/VSCodium` works.
- Anything else is `unresolved`. **Never fall back to a per-user folder** (BR-5: that would merge instances).
- Rows (`test/unit/instance-folder.test.ts`):
  - the default profile;
  - a named profile;
  - a `--user-data-dir` root (`/tmp/run/user-data/User/globalStorage/x`);
  - a root holding a `User` segment (`/home/User/.config/VSCodium/User/profiles/abc/globalStorage/x`);
  - a Windows path;
  - three unresolved forms: no `globalStorage`, `profiles` without an id, and an empty extension folder.

**`acquire`** (`src/client/acquire.ts`):
- `AcquireRequest.folder` becomes `string | {instanceOf: string}`, where `instanceOf` is the caller's
  `globalStorageUri.fsPath`. A string keeps today's meaning, so remote-ssh doesn't change.
- With `instanceOf`, `acquire` resolves the folder first. `unresolved` returns `{kind: 'failed', failure:
  'registryUnresolved'}` before any claim, and `AcquireFailure` gains `'registryUnresolved'`.
- `stop` takes the same `folder` union.
- The folder is created as today (`node-file-port.ts`, mode `0o700`).
- Rows: an acquire with a resolvable `instanceOf` claims under the instance folder (memory file port), and an
  unresolvable one fails `registryUnresolved` with no file written.

## 2. The start that leaves the starter's tree

- `AcquireRequest` gains `leaveStarterTree?: true`, which is passed through to the spawn.
- **A launcher**, `src/runtime/tree-leaving-launcher.ts`, exporting `runTreeLeavingLauncher()`. It's a program: the
  consumer bundles a two-line `src/programs/helper-launcher.ts` that calls it (as remote-ssh's `connection-helper.ts`
  calls its runner).
  - It reads `process.argv[2]` (the helper script's path, the only argument, which is not a parameter).
  - It spawns `process.execPath` with `[script]`, `{detached: true, stdio: 'ignore', windowsHide: true, env:
    process.env}`. The environment, with `ELECTRON_RUN_AS_NODE` and `REMOTE_OSS_HELPER_PARAMETERS`, passes
    through unchanged, and nothing goes in argv.
  - It calls `unref()`, and exits **0 on the child's `spawn` event**, or 1 on its `error`.
- **`spawnSpecification`** (`src/client/spawn.ts`) gains a `launcher?: string` parameter. With it:
  - `commandArguments` is `[launcher, script]`, with the same `command` (the runtime) and the same environment;
  - `SpawnSpecification` gains `waitForExit: true`.
- **`Spawner`'s Node implementation** (`client/node-environment.ts`) waits, when `waitForExit` is set, for the
  process's exit:
  - 0 resolves;
  - anything else, or an `error`, rejects, which `acquire` already turns into `spawnFailed`.
- Everything after the spawn is unchanged. The starter waits for the record and the endpoint through the hello window
  as today, and the record's `startedByProcessId` stays the acquirer's own process id.
- `AcquireRequest` gains `launcherScript?: string`, required when `leaveStarterTree` is set (a type-level union).
  The consumer passes `dist/helper-launcher.js`.
- **Rows:**
  - unit: the specification with and without the launcher; the spawner's three exit outcomes over a fake;
  - the end policy's existing armed-at-start row stays and passes (proteus's condition: a leaseless helper ends by
    itself);
  - **an integration row** (`test/integration/`, or wherever lib-helper's real-socket rows are): a starter process
    acquires with `leaveStarterTree`, then the test kills the starter **and every process whose parent chain leads
    to it** (walk `/proc/*/stat` on Linux), and the helper still answers a request afterwards. Skip it on
    non-Linux, saying so in the row's name: `(linux)`.

## 3. The harness (proteus's condition)

A helper that left the editor's tree outlives the editor, so the run must stop it:
- `tools/acceptance.ts`, at the end of every launch and in `acceptance:clean`: for each record file under the run's
  user-data folder (any `instance-registry` folder and any per-profile registry folder), call lib-helper's `stop`
  with that folder, namespace and key.
- If its endpoint still answers a hello afterwards, kill the processes whose `/proc/<pid>/environ` holds that
  record's nonce (`SIGKILL`), then remove the record.
- Unit rows for the record walk over a fixture folder, and one acceptance-tool row that the clean step calls `stop`
  for each.

## 4. Done when

- lib-helper's unit and integration rows pass, with the new files at 100 %.
- remote-ssh's unit tests pass unchanged.
- §9 of the transport contracts says: the instance-scoped folder (beside per profile and per user),
  `registryUnresolved`, and the tree-leaving start (POSIX now; Windows job breakaway with the Windows platform
  increment, provisional).
- All gates pass. PR title: `lib-helper: an instance-scoped registry and a start that leaves the starter's tree (card
  helper-05, #1223)`. Request athena only. proteus confirmed the design on #737, and athena or hermes picks
  the design check.
