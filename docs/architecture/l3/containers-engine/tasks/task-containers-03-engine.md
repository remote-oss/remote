# Task card containers-03: C2, the engine and its pre-flight checks

Issue: #758. Remote - Containers release 1, slice 1 (D-87). Size: M (about 2 agent-days). Builder: hestia, after
containers-01 (C1, the package shell).

**Design:**
- brief-release-1 ruling 10 and §5 gate row 8;
- `components.md` C2;
- `contracts.md` §4 (`EngineHost`) and §6.

**Spec:** F-0201 (`remote-oss/remote-containers#18`), with its strings S146, S079, S103, S380, S104 and S339. It uses
strings of F-0202, F-0203 and F-0105 for the shared dialogs.

**Depends on:**
- containers-01: the package, its string table, its l10n bundle, the log channel's `revealLog`, and `dockerPath` in
  the manifest and the identifier table;
- containers-02 (#757, card PR #760): the `EngineHost` port at `packages/remote-containers/src/engine/engine-host.ts`
  and its Node adapter `nodeEngineHost(dockerPath)` in `engine/node-engine-host.ts` (with `shell: false`). C11 builds
  them first. **If containers-02 has merged, the port and the adapter exist.** C2 reuses them, and from now on owns the
  port file. C2 adds only what the checks need: nothing to the port's shape.

The port, as containers-02 fixed it (match it exactly):

```ts
export type EngineInput = {kind: 'none'} | {kind: 'text'; text: string} | {kind: 'file'; localFile: string};
export type EngineRunOutcome =
  | {kind: 'ran'; status: number | undefined; stdout: string; stderr: string}
  | {kind: 'failed'; detail: string};
export interface EngineOptions { environment?: Readonly<Record<string, string>>; cancellation: AbortSignal; }
export interface EngineProcess {
  stdin: NodeJS.WritableStream; stdout: NodeJS.ReadableStream; stderr: NodeJS.ReadableStream;
  exited: Promise<number | undefined>; kill(): void;
}
export type EngineSpawn = {kind: 'spawned'; process: EngineProcess} | {kind: 'failed'; detail: string};
export interface EngineHost {
  run(argv: readonly string[], input: EngineInput, options: EngineOptions): Promise<EngineRunOutcome>;
  spawn(argv: readonly string[], options: EngineOptions): Promise<EngineSpawn>;
}
```

- `argv` excludes the program: the adapter prepends the `dockerPath` it was made with.
- `{kind: 'failed', detail}` is a spawn failure, with Node's error message, for example `spawn dk ENOENT`.

## 1. What C2 is, and what it isn't

C2 is the only place that asks the Docker CLI whether it can be used. It gives three operations to its callers:
- `firstCheck`: C6 calls it before a reload or a picker (5.0 step 3). It shows its own dialogs.
- `secondCheck`: C10 calls it inside the resolve (5.0 step 5). It shows nothing and returns a classified failure,
  which C10 turns into `Failed` for C8 to present (§6, row 1).
- `currentContext`: C6 calls it to build F-0501's payload.

**Not C2's:**
- the `vscode` volume (C7);
- Compose (BR-4, 7.E4, later);
- Podman, remote engines, Remote-SSH, WSL and Windows dialogs (7.E9, 7.E10, 7.E13, 7.E15; later);
- the background context listing (BR-13; R-34: not reproduced);
- the Remote Explorer view (BR-15, later).

Release 1 is a Linux client with a local engine. On any other client platform the checks run the same way, and only
7.E1 exists for "not found".

## 2. Files

All under `packages/remote-containers/`:

| File | What |
|---|---|
| `src/engine/executable.ts` | pure: `executableOf(value, base)` (§3.1) |
| `src/engine/version-reply.ts` | pure: `serverApiOf(stdout)` and `isBelowMinimum(api)` (§3.3) |
| `src/engine/check-outcome.ts` | pure: `firstCheckOutcomeOf(...)` and `secondCheckOutcomeOf(...)` (§3.2, §3.4) |
| `src/engine/preflight.ts` | `firstCheck`, `secondCheck` and `currentContext` over `EngineHost` and the ports of §4 |
| `src/surfaces/engine-dialogs.ts` | the dialog texts and their buttons' targets (§4) |
| `test/unit/<each>.test.ts` | the rows of §5 |

The strings go in the package's string table that containers-01 creates (as remote-ssh's
`surfaces/failure-strings.ts`), and in every `l10n/bundle.l10n*.json`, in English for now. `pnpm check-string-tables`
must pass. If containers-01 names the table differently, use its name.

## 3. The checks

### 3.1 The executable (BR-1; pure)

`executableOf(value: unknown, base: string | undefined): {kind: 'spawn'; file: string; written: string} | {kind:
'notFound'; written: string}`.

**The value:**
- `value` is `dev.containers.dockerPath` as the editor reports it, read at each call (BR-2), never cached.
- A non-string or empty value is the default `docker`.
- `written` is the value exactly as written. It's the `{0}` of S079.

**The rules:**
- **Literal:** no `~`, `$VAR` or `%VAR%` expansion, and no splitting at spaces. `/usr/bin/docker --debug` is one file
  name, and spawning it fails with ENOENT. Nothing goes through a shell.
- **Absolute** (starts with `/`): `file` is the value.
- **Bare** (no `/`): `file` is the value. Node's `spawn` with `shell: false` looks it up on the extension host's
  `PATH`, never in the folder.
- **Relative** (contains `/`, doesn't start with it): `file` is `path.resolve(base, value)` when `base` is given;
  `notFound` when it isn't.
  - `base` is the caller's: C6 passes the opened folder's path only when the window is local, has a folder and the
    workspace is trusted (BR-1, AC-55). For a multi-root workspace it passes the folder of the `.code-workspace` file,
    the preferred option of decision "F-0201 Q-multiroot".
  - Every other case passes `undefined`.

### 3.2 The first check (5.0 step 3, BR-3, BR-5; R-34 leaves the command lines ours)

`firstCheck` runs two queries in order. Each gets a timeout of **60 000 ms** (BR-14, decision "F-0201 Q5"); it's a
dependency, so rows can shorten it.
1. **The client-version query:** `[file, '--version']`.
2. **The structured version query:** `[file, 'version', '--format', '{{json .}}']`.

`[file, …]` here means: the engine is `engineFor(file)`, a dependency whose real value is `nodeEngineHost`, and the argv
passed to `run` is what follows `file`, so `['--version']` and `['version', '--format', '{{json .}}']`.

Each run uses `run(argv, {kind: 'none'}, {cancellation})`:
- **no `environment`:** the adapter then passes the extension host's environment unchanged (`process.env`), so
  `DOCKER_HOST`, `DOCKER_CONTEXT` and `PATH` reach the CLI as they are (ruling 10). If containers-02's adapter doesn't
  inherit `process.env` when `environment` is absent, see §9 row 1;
- **the cancellation** is the caller's signal combined with C2's own 60 s timer. C2 knows when its timer fired, so a
  timeout is C2's fact, not the adapter's.

**Reading the outcome:**
- a `failed` outcome is a spawn failure, and its `detail` matching `/\bENOENT\b/` means "not found";
- a `ran` outcome after C2's timer fired is a timeout, whatever its status;
- otherwise a `ran` outcome's `status` is the exit (`undefined`, killed by a signal, counts as non-zero).

**`firstCheckOutcomeOf` classifies** in this order, stopping at the first that applies:

| Condition | Outcome |
|---|---|
| `executableOf` gave `notFound` | `notFound` (7.E1) |
| a query's outcome is `failed` with `ENOENT` in its detail | `notFound` (7.E1) |
| a query's outcome is `failed` otherwise (`EACCES`, `ENOTDIR`, …) | `engineError` (7.E11) |
| a query timed out (the child was ended) | `engineError` (7.E12, BR-14) |
| a query exited non-zero, and its **stderr** matches `/permission denied/i` | `permission` (7.E3, which takes precedence) |
| a query exited non-zero, and its **stderr** matches `/not ?found/i` | `notFound` (7.E2 → 7.E1) |
| a query exited non-zero otherwise (stdout is never examined) | `engineError` (7.E2) |
| both exited 0, and `isBelowMinimum(serverApiOf(stdout of query 2))` | `tooOld` (7.E6) |
| both exited 0 | `passed` |

**Amended by containers-10 (#862, ADR-0010 rule 2):** the two stderr rows apply only after the Docker CLI's own
`WARNING:` lines are skipped, and after a line that starts with one of its transport or daemon prefixes has decided
`engineError`. containers-10 §3 has the rule, and its §2 has the measured forms.

The second query runs only when the first exited 0. No other query is made, so a Buildx or server-version query can't
fail the check (AC-48).

**Measured on this machine** (docker 29.9.0, 2026-10-14):
- **A reachable engine:** `docker version --format '{{json .}}'` exits 0. Its output is
  `{"Client":{…,"Version":"29.9.0","ApiVersion":"1.56",…,"Context":"default"},"Server":{…,"Version":"29.9.0","ApiVersion":"1.56","MinAPIVersion":"1.40",…}}`.
- **An unreachable engine** (`DOCKER_HOST=unix:///nonexistent.sock`): it exits 1, and stdout still holds
  `{"Client":{…},"Server":null}`. Its stderr is `failed to connect to the docker API at unix:///nonexistent.sock; check
  if the path is correct and if the daemon is running: dial unix /nonexistent.sock: connect: no such file or
  directory`. That text has neither pattern, so the outcome is `engineError`: F-0202's dialog, as the spec observed
  for "Cannot connect to the Docker daemon".
- **A missing context** (`DOCKER_CONTEXT=nosuch`): it exits 1, with stderr `Failed to initialize: unable to resolve
  docker endpoint: context "nosuch": context not found: …`, which is `notFound` (AC-47).

### 3.3 The version reply (BR-5; pure)

- **`serverApiOf(stdout)`:** parse the JSON, and take `Server.ApiVersion` when it's a string of the form
  `<digits>.<digits>`. Answer `undefined` for anything else: unparseable JSON, `Server` null or missing, a missing or
  odd `ApiVersion`.
- **What is never read:** `Client.ApiVersion` and both `Version` strings (AC-31).
- **`isBelowMinimum(api)`:** true only when `api` is defined and `(major, minor) < (1, 35)`, compared as numbers. So
  `1.4` is below `1.35`, and `1.100` isn't.

### 3.4 The second check (5.0 step 5)

`secondCheck` runs the full version query, argv `['version']` on `engineFor(file)`, with the same environment and the same 60 s timeout.
`file` comes from `executableOf` with the same `base` the first check had: C10 gets it from the payload's folder only
for a trusted folder.

**`secondCheckOutcomeOf`:**

| Condition | Outcome |
|---|---|
| exit 0 | `passed` |
| `notFound` from `executableOf`, or a `failed` outcome (any spawn failure) | `failed`, detail **S339** (7.E14) |
| exit non-zero with stderr `/permission denied/i` | `failed`, detail **S104** (7.E16) |
| any other exit, or the timeout | `failed`, detail **S144** (7.E12, 5.0 step 5) |

**Amended by containers-10 (#862):** the permission row reads stderr through the same classifier as §3.2.

### 3.5 The current context (ruling 10, F-0501 BR-2a)

`currentContext()` runs argv `['context', 'show']` on `engineFor(file)`, with the same environment and timeout:
- exit 0 → the trimmed stdout, or `undefined` when that is `default` or empty;
- anything else → `undefined`, with a warn line `the Docker context could not be read: <exit or spawn code>`.

**Measured:** `docker context show` prints `default`, and still prints `default` with `DOCKER_HOST` set, because the
`DOCKER_HOST` engine is the default context's. `DOCKER_CONTEXT=<name>` makes it print `<name>`.

### 3.6 The log

- **Each query:** a debug line `docker: <argv joined by spaces> → <exit status or spawn code> (<ms> ms)`. The argv
  never holds a secret (R-26), and a row checks it against the fixture's secret (§5).
- **A spawn that fails with ENOENT** adds a warn line `<written> was not found; PATH: <process PATH>`, as the
  reference's log names the PATH searched (7.E1).

## 4. The dialogs before the reload (F-0201 section 7; §16 for the items)

`firstCheck` turns each outcome other than `passed` into exactly one modal error dialog. It then resolves:
- `'stopped'`, so the caller doesn't reload and nothing is created (BR-8);
- or `'proceed'`, for `passed` and for 7.E6's "Ignore".

**Nothing is remembered** (BR-9): every call runs both queries again.

**The port:** `EngineDialogPort.showError(message, detail, items) → Promise<string | undefined>`. Its adapter is
`vscode.window.showErrorMessage(message, {modal: true, detail}, ...items)`.
- The items are passed **primary first**.
- Core adds "Cancel" and arranges the row per platform. The row the user sees on Linux is the spec's.
- `undefined` (Cancel or Escape) is `'stopped'`.

`openExternal(url)` and `revealLog()` are ports too: containers-01's `revealLog` is the log channel's.

| Outcome | Message | Detail | Items passed (primary first) | Row seen on Linux | Buttons' targets |
|---|---|---|---|---|---|
| `notFound`, `written` ≠ `docker` | S146 `Docker version 17.12.0 or later required.` | S079 + one space + S061: `Command not found: '<written>'. Check the license for details.` | S204 `Install`, S221 `License` | License \| Cancel \| Install | Install opens `ENGINE_LINKS.install`; License opens `ENGINE_LINKS.licence`; both resolve `'stopped'` and re-run nothing |
| `notFound`, `written` = `docker` (the exact value) | S146 | S061 `Check the license for details.` | Install, License | as above | as above (AC-15) |
| `permission` | S103 `Current user does not have permission to run 'docker'.` | S380 `Try adding the user to the 'docker' group.` | S147 `Documentation` | Cancel \| Documentation | opens `ENGINE_LINKS.permission` |
| `tooOld` | S146 | S061 | Install, License, S201 `Ignore` | Ignore \| License \| Cancel \| Install | Ignore → `'proceed'`; Install and License as above, `'stopped'` |
| `engineError` | S143 `Docker returned an error.` (F-0202) | S226 `Make sure the Docker daemon is running.` (F-0202) | S324 `Show Log` | Cancel \| Show Log | `revealLog()`, then `'stopped'` |

**The buttons' destinations** (athena on #761; R-31, ADR-0008, #382): no `aka.ms` or `go.microsoft.com` link. Each
button opens its destination directly, from one exported constant in `src/surfaces/engine-dialogs.ts`:

```ts
export const ENGINE_LINKS = {
  install: 'https://docs.docker.com/engine/install/',
  licence: 'https://www.docker.com/legal/docker-subscription-service-agreement/',
  permission: 'https://docs.docker.com/engine/install/linux-postinstall/',
} as const;
```

A row checks that no value contains `aka.ms` or `microsoft.com`. The URL halves of AC-3 and its siblings assert these
values; their texts, order and outcomes stay F-0201's. athena has asked the dirty side to restate those halves.

**The name in S103:** S103 names `'docker'` literally, whatever the value (AC-32).

**F-0202's shared texts:** S143, S226 and S144 are F-0202's. F-0202 isn't in the release-1 cut, but F-0201's routing
uses them, so C2 carries them (§6, row 2).

## 5. Rows

**The fakes:**
- `engineFor` is a scripted fake: it records the `file` it's made with. Per argv, its `run` answers a `ran` outcome with status, stdout and stderr; a `failed` outcome with a detail such as `spawn dk ENOENT`; or "never ends" until the cancellation fires, then `ran` with status `undefined`;
- the dialog port records its calls and answers a scripted item;
- the timer is the fake scheduler remote-ssh's rows use, so the 60 s timeout is a row, not a wait.

**Each row cites the AC or rule it proves.**

| File | Cite | Given | Expected |
|---|---|---|---|
| `executable.test.ts` | F-0201 BR-1 | `docker`; `/usr/bin/docker`; `tools/dk` with base `/w`; `./tools/dk` with base `/w`; `tools/dk` without base; `~/bin/dk`; `$HOME/bin/dk`; `/usr/bin/docker --debug`; `''`; `5` | spawn `docker`; spawn `/usr/bin/docker`; spawn `/w/tools/dk`; spawn `/w/tools/dk`; notFound; spawn `~/bin/dk`, literally (so ENOENT); spawn `$HOME/bin/dk`; spawn `/usr/bin/docker --debug`; spawn `docker`; spawn `docker`. `written` is the input as written each time (`docker` for the last two) |
| `version-reply.test.ts` | F-0201 BR-5, AC-31 | the measured reachable reply; `Server.ApiVersion` `1.34`, `1.35`, `1.4`, `1.100`; Client `1.30` with Server `1.51`; `Server: null`; no `ApiVersion`; `not-a-version-string`; `Version` `17.0.0` with ApiVersion `1.51` | below the minimum only for `1.34` and `1.4`; every other case passes |
| `check-outcome.test.ts` | F-0201 BR-3 | one row per line of §3.2's table, plus: stderr `PERMISSION DENIED` (case); stderr with both `permission denied` and `not found`; `not found` only on stdout with exit 1 (AC-25); stderr `notfound`; the measured unreachable-engine stderr; the measured missing-context stderr (AC-47) | the table's outcome; permission wins; stdout is ignored |
| `check-outcome.test.ts` | F-0201 5.0 step 5, 7.E14, 7.E16 | one row per line of §3.4's table | the detail id |
| `preflight.test.ts` | F-0201 AC-48 | query 1 exits 0, query 2 exits 0 with a passing reply; the fake fails every other argv | `'proceed'`; the fake saw exactly those two argvs |
| `preflight.test.ts` | F-0201 AC-2, AC-3 | value `no-such-docker-cli-0201`, ENOENT; then each button: Install, License, nothing | one `showError(S146, "Command not found: 'no-such-docker-cli-0201'. Check the license for details.", ['Install', 'License'])`; Install and License open their URLs once; `'stopped'` each time; no third query |
| `preflight.test.ts` | F-0201 AC-15 | value `docker` (default and explicit), ENOENT | detail `Check the license for details.` only |
| `preflight.test.ts` | F-0201 AC-7, AC-32 | value `dk-0201`, query 2 exits 1 with stderr `Error: Permission Denied`; then Documentation | `showError(S103, S380, ['Documentation'])`, naming `'docker'`; Documentation opens its URL; `'stopped'` |
| `preflight.test.ts` | F-0201 AC-21, AC-31, BR-9 | Server ApiVersion `1.30`; answers Ignore, then Install, then nothing; then a second call with Ignore | items `['Install', 'License', 'Ignore']`; Ignore → `'proceed'`; Install → URL and `'stopped'`; the second call shows the dialog again |
| `preflight.test.ts` | F-0201 AC-8 | both queries exit 0 with `not-a-version-string` | `'proceed'`, no dialog |
| `preflight.test.ts` | F-0201 AC-16 | spawn `EACCES`; spawn `ENOTDIR`; then Show Log | `showError(S143, S226, ['Show Log'])`; Show Log calls `revealLog` once |
| `preflight.test.ts` | F-0201 AC-25 | exit 1 with stderr `Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?` | the S143/S226 dialog |
| `preflight.test.ts` | F-0201 AC-20 (C2's half) | query 1 never ends | after the fake timer reaches 60 000 ms, the run's cancellation fires (the fake records the abort) and the S143/S226 dialog shows; before 60 000 ms, nothing is shown |
| `preflight.test.ts` | F-0201 AC-22, BR-2 | a setting getter that answers `missing-a`, then `missing-b`, on two calls | each dialog names its own value |
| `preflight.test.ts` | F-0201 AC-38 | `~/bin/dk` and `/usr/bin/docker --debug`, both ENOENT | each dialog's detail names the value as written |
| `preflight.test.ts` | F-0201 BR-1, AC-55 (C2's half) | `tools/dk` with no base | the 7.E1 dialog naming `tools/dk`, and **no** query run |
| `preflight.test.ts` | F-0201 7.E14, 7.E16, AC-36, AC-46 (C2's half) | `secondCheck`: exit 0; ENOENT; exit 1 with `permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`; exit 1 with other text; never ends | passed; S339; S104; S144; S144 at 60 000 ms. No dialog is shown in any case |
| `preflight.test.ts` | F-0501 BR-2a | `currentContext`: stdout `default\n`; `desktop-linux\n`; `''`; exit 1; ENOENT | `undefined`; `desktop-linux`; `undefined`; `undefined` with the warn line; `undefined` with the warn line |
| `preflight.test.ts` | contracts §6, R-26 | a fixture whose process environment holds a token `secret-0201` | no argv the fake saw contains it |
| `preflight.test.ts` | contracts §6, no shell | value `/opt/my docker/dk 'q'` (spaces and quotes) | `engineFor` got exactly that file name, unchanged |
| `engine-dialogs.test.ts` | F-0201 3.4 | the table of §4 | every text equals the spec's, and every id is in the string table |
| `engine-dialogs.test.ts` | R-31 | `ENGINE_LINKS` | each value is an `https:` address that contains neither `aka.ms` nor `microsoft.com`; Install, License and Documentation open exactly `ENGINE_LINKS.install`, `.licence` and `.permission` |

**The acceptance row** (gate row 8: a bogus `dockerPath` shows F-0201's dialog before any reload) needs a containers
launch, which card (11) and the harness card (10) of slice 1 provide. It isn't written here. Card (11) writes it
against C6's Reopen in Container.

## 6. Notes for athena, and the choices the card made

1. **The second check's dialog.** Contracts §2 step 2 says a failed C2 check returns `Failed` with
   `userAlreadyNotified: true`. That fits the first check, which runs before the reload and shows its own dialog. The
   second check's dialog is F-0202's three-button one ("Edit devcontainer.json Locally" | "More Actions..." |
   "Retry"), whose buttons are lib-authority's presenter actions, like F-0410's.
   - **This card's choice:** `secondCheck` returns the detail id (S339, S104 or S144). C10 returns
     `Failed{userAlreadyNotified: false}`, with that reason, for C8 to present.
   - **What it needs:** C8's card adds these three details to F-0410's variants. athena, please confirm, or say if C2
     should show it itself.
2. **F-0202's shared texts.** F-0202 isn't in the release-1 cut, but F-0201's routing needs its texts S143, S226 and
   S144. C2 carries them, and the coverage file's F-0202 lines stay `deferred`. athena, please confirm that's the
   tagging you want.
3. **The values of `base`** (BR-1, AC-55) are decided by C6. This card only defines what `undefined` does: a relative
   value is not found, and nothing runs.

## 7. Catalogue

In `docs/architecture/catalogue/coverage-containers-r1.tsv` (seeded in parallel by the housekeeping card), set F-0201
AC-3, AC-7, AC-15, AC-16, AC-25, AC-32, AC-38 and AC-47 to `unit`. Each is fully proven by §5's rows: a dialog, its
buttons, and nothing run past the check.

The rows also cite AC-2, AC-8, AC-20, AC-21, AC-22, AC-31, AC-36, AC-46, AC-48 and AC-55, but each of those has a
window or connect half. They stay `todo` for the coverage card. `pnpm check-coverage` must pass. If the containers
file isn't on main yet when this lands, tag nothing, and list the eight in the PR body for the coverage card.

## 8. Gates and review

- **Gates:** all of them: typecheck, lint, format:check, dupes, dead, check-layout, check-identifiers,
  check-string-tables, check-coverage, check-licences and coverage. The new files must be at 100 %.
- **PR title:** `remote-containers: the engine and its pre-flight checks (card containers-03, #758)`.
- **Review:** themis or triton reviews; athena gives the design check, including §6.

## 9. Open rows (stop and report on #758)

1. containers-02's adapter doesn't end the child on cancellation, doesn't put Node's error code in a `failed` detail,
   or doesn't inherit `process.env` when `environment` is absent. Report what it does. Don't change the port's shape;
   the adapter is the place to fix it, as a change athena checks.
2. containers-01's string table or `revealLog` isn't there when you start. Build the pure modules of §3 first, and
   report.
3. athena answers §6.1 differently. Follow her answer: move the second check's dialog into C2, or not.
