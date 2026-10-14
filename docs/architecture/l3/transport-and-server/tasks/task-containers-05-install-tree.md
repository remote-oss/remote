# Task card containers-05: lib-server installs into the volume tree, the containers policy row, and the version key

Issue: #765. Remote - Containers release 1, slice 1, item (6) (D-87; the user's priority of 2026-10-14). Size: M (about
2 agent-days). Builder: assigned by hermes. Area A code with area C's input. C10 (the connector) is its first caller.

**Spec:** F-0503 (`remote-oss/remote-containers#34`, republished 2026-10-14):
- 5.0 steps 4–5;
- BR-2, BR-3, BR-4, BR-5, BR-6, BR-14(e) and (f);
- AC-1, 5, 7, 25, 36, 38, 53, 54.

**Design:**
- containers contracts §5;
- transport contracts §5.0 (the remote-containers column) and V9;
- the brief's rulings 3 and 4;
- athena on remote-containers#122 (Q1: the server source order, and the version key of AC-38).

## 1. What exists, and what's missing

**Already on main:**
- **lib-product's `resolveServerArchive`** (`packages/lib-product/src/resolve.ts`) already does F-0503 BR-14(e)'s order, with no change needed:
  - (1) the override, here `remote.serverDownloadBaseUrl` from any layer, where a value without `${` is a base URL with `/commit:{commit}/server-{platform}/{quality}` appended (`OVERRIDE_POLICIES['remote-containers']`);
  - (2) the profile's `serverDownloadUrlTemplate` when non-empty;
  - (3) `BUILT_IN_SOURCES`, matched exactly on `codium` and `codium-insiders`;
  - (4) otherwise `noSource`.
  - The rows of §4.1 prove this for AC-36, 53 and 54. They're new rows over existing code.
- **The planner** (`install/plan.ts`) supports `clientOnly`: it gives `{where: 'client', clientFallback: false}`.
- **The cleanup body** (`scripts/bootstrap.ts`, `CLEANUP_BODY`) supports `onlyCurrentKeepLeftovers`, as WSL's single-script row uses it.
- **The completeness check** is the one lib-server already uses everywhere: `[ -x "<folder>/$LAUNCHER" ]` (the probe's `server.installed`, the install body, the start body). This card reuses it for the tree. A tree "is a complete server" exactly when `<tree>/<launcher>` is executable.

**Missing:**
1. **The policy row:** `CONTAINERS_POLICY` (`policy/rows.ts`) has `cleanup: {kind: 'keepNewest', count: 5}`, but §5.0 says `onlyCurrentKeepLeftovers`. Every other cell already matches §5.0.
2. **`installTree`:** no script, probe or plan knows a tree outside the data folder.
3. **V9's archive key:** `clientArchiveFolder(cacheRoot, product, commit)` keys by commit only. F-0503 BR-14(f) and AC-38 key a VSCodium-mapping archive by version(+release). Nothing in production calls `clientArchiveFolder` yet, so its signature can change.

## 2. The rules

- **R1. Without `installTree` nothing changes.** Every script, probe fact, plan and lock place is byte-identical for remote-ssh. §4.4's regression rows prove it.
- **R2. The tree is V9's `serverTree`.**
  - The caller passes `cacheFolders(product, commit, platform, true).serverTree`, for example `/vscode/codium-server/bin/linux-x64/<commit>`.
  - lib-server never computes the tree; it only installs into it and links to it.
- **R3. Extraction never leaves a partial tree.**
  - The archive is unpacked into a new sibling `<tree>_<epochMilliseconds>` (F-0503 BR-6: an underscore, the epoch milliseconds the script parameters already carry as `STAGING_SUFFIX`), then renamed to `<tree>` only once extraction has finished.
  - A sibling with an `_` suffix is never treated as an install, reused or cleaned up (BR-6). An interrupted install leaves its `_` sibling, and the next install makes a new one (AC-25).
- **R4. Two containers racing on one engine.** After extraction:
  - if `<tree>` is already complete (another container won), the script removes its own `_` sibling and uses the tree;
  - otherwise it runs `mv "<tree>_<suffix>" "<tree>"`;
  - if `<tree>` appeared between the check and the `mv`, `mv` moves the sibling *into* it, so the script then removes `<tree>/<basename of the sibling>` when that exists.

  The tree is never replaced while complete.
- **R5. The link (BR-3, "created or kept").** `<dataFolder>/bin/<commit>` is made a symbolic link to `<tree>`:
  - a link that already points at `<tree>` is kept;
  - a link to anything else is replaced: `rm -f`, then `ln -s`;
  - a real directory there that holds a complete server is left as it is (not replaced, since a server may run from it), with the fact `server.installLink realFolder`;
  - a real directory that isn't complete is removed (`rm -rf`) and the link made;
  - otherwise the link is made.

  Every case reports `server.installLink` as `kept`, `made` or `realFolder`.
- **R6. The host lock goes in `/tmp` when `installTree` is set.** `lock_path` puts the lock in `$DATA_DIR/bin/$COMMIT/`, which would be inside the link, and so inside the shared tree. So with `INSTALL_TREE` set the script sets `LOCK_IN_TEMPORARY=yes` before any lock is taken, in every step, through `COMMON_FUNCTIONS`. The `/tmp` lock is per container, and it guards the windows of one container. Cross-container safety is R4's.
- **R7. Where the link is ensured.**
  - **The install step:** after a successful extraction or a complete tree.
  - **The start step:** before its own `[ -x "$INSTALL_DIR/$LAUNCHER" ]` check. On a volume hit in a new container (AC-1), the planner reuses the tree (§3.3) and no install step runs. So the start must make the link, with no download, no "Installing server" phase and no install log line.
- **R8. Cleanup is unchanged.** It walks `$DATA_DIR/bin`, which now holds links. `rm -rf` on a link (no trailing slash) removes the link and never the tree it points at. So `onlyCurrentKeepLeftovers` never removes another commit's server from the volume. §4.2 proves it.
- **R9. The archive key (V9, AC-38; athena, remote-containers#122).**
  - **The key:** an archive the built-in table resolved (`ResolutionStep` `builtInTable`) is kept under `<version><release>`. Every other step (`override`, `productTemplate`) is kept under the commit.
  - **The folder:** `clientArchiveFolder` keeps its two levels, reference layout or `<applicationName>/`, then `<quality>/`. Only the last segment becomes the key.

## 3. Changes

### 3.1 `lib-server/src/cache/folders.ts`
- `export function archiveKeyOf(step: ResolutionStep, profile: {commit: string; version: string; release: string}): string`
  returns `` `${profile.version}${profile.release}` `` for `builtInTable`, and `profile.commit` otherwise. Import
  `ResolutionStep` from lib-product.
- `clientArchiveFolder(cacheRoot, product, archiveKey: string)`: the third parameter is renamed from `commit` to
  `archiveKey`, and its JSDoc says "the commit, or the version(+release) of a built-in-table archive (`archiveKeyOf`)".
  The body is unchanged.
- Export `archiveKeyOf` from `index.ts`.

### 3.2 `lib-server/src/scripts/bootstrap.ts` and `posix-script.ts`
- **The parameter:** `ScriptParameters` gains `installTree: string`, empty for none, with the JSDoc "V9's server tree
  the install extracts into and `bin/<commit>` links to; empty for a server installed in the data folder".
  `parameterBlock` adds `assignment('INSTALL_TREE', parameters.installTree)`.
- **`COMMON_FUNCTIONS`:** gains `[ -z "$INSTALL_TREE" ] || LOCK_IN_TEMPORARY=yes`, after the parameter-derived
  variables (R6).
- **A new group, `TREE_FUNCTIONS`** (in `posix-script.ts`), with two functions:
  - `ensure_install_link`: R5's cases, reporting `server.installLink`. A failing `ln`, `rm` or `mkdir -p "$DATA_DIR/bin"`
    calls `write_failed_leave "$INSTALL_DIR" "<the command's error text>"`, the existing `CreateInstallDirFailed` path.
  - `install_tree`: R3 and R4, using the existing `unpack_into`. A failed unpack leaves the `_` sibling, and runs
    `leave UnpackFailed`.
- **`PROBE_BODY`:** when `INSTALL_TREE` is set, it reports `server.treeComplete` `yes` when
  `[ -x "$INSTALL_TREE/$LAUNCHER" ]`, else `no`. Without it, it reports nothing new.
- **`INSTALL_BODY`:** when `INSTALL_TREE` is set, it takes a branch that does, in order:
  1. creates `$DATA_DIR/bin` with `mkdir -p`, not `$INSTALL_DIR`, which must stay free for the link;
  2. `take_lock_or_finish "$COMMIT"`, which is in `/tmp` by R6;
  3. if the tree isn't complete: `prepare_environment`, the archive (from `ARCHIVE_PATH`, or the existing host fetch),
     then `install_tree`, reporting `server.treeInstalled yes`. If the tree is complete, it reports `server.treeInstalled no`;
  4. `ensure_install_link`;
  5. `[ -x "$INSTALL_DIR/$LAUNCHER" ] || leave UnpackFailed`;
  6. the existing `server.installDir` and timing facts, then `leave Ok`.

  The branch without `INSTALL_TREE` is today's body, unchanged.
- **The start body** (`startBody`): when `INSTALL_TREE` is set, it calls `ensure_install_link` (R7) before its existing
  `[ -x "$INSTALL_DIR/$LAUNCHER" ] || finish ServerFailedToStart`.
- **The groups:** `FUNCTION_GROUPS` adds `TREE_FUNCTIONS` to `install` and `start`.
- **Every caller of `ScriptParameters`:** remote-ssh's `parametersFor`, the test fixtures and lib-server's own builders
  set `installTree: ''`. That keeps R1.

### 3.3 `lib-server/src/lifecycle/probe.ts` and `install/plan.ts`
- **The probe:** `ProbedHost` gains `treeComplete: boolean`, which is `serverFacts.treeComplete === 'yes'`, false when
  the fact is absent.
- **The layouts:** `ExistingLayout` gains `{kind: 'tree'; commit: string; path: string}`, the complete tree.
- **The plan input:** `PlanInput` gains `installTree?: string`.
- **`reuseBeforeSource`:** the order becomes `bin`, then `tree`, then `cliServers`. A `bin` layout means the link
  already resolves to a complete server. A `tree` layout means the tree is complete but this container has no link yet:
  the plan is `reuse`, and the start makes the link (R7).
- **The download plan:** the `download` plan gains `installTree: string`, which is the input's, or `''`, and C10 passes it
  into the script parameters. `installFolder` stays `<dataFolder>/bin/<commit>` (the link's place).

**The caller's mapping** (C10, documented here for it): `existingLayouts` gets
`{kind: 'tree', commit, path: installTree}` when `host.treeComplete`, and `{kind: 'bin', …}` when `host.installed`, as
remote-ssh does.

### 3.4 `lib-server/src/policy/rows.ts`
`CONTAINERS_POLICY.cleanup` becomes `{kind: 'onlyCurrentKeepLeftovers'}`, and its JSDoc becomes "The containers policy:
the client downloads and keeps the archive and copies it into the container; one window never removes another commit's
server from the shared volume". Its `allowedExtraStartOptions` becomes `['useHostProxy']` (F-0503 BR-18; athena on
remote-oss/remote-containers#122 Q6, transport contracts §5.0 as amended on main). The other cells are unchanged.

### 3.5 `useHostProxy`, the second extra start option (F-0503 BR-18)

Every in-container server start runs in host-proxy mode, with the server's `--use-host-proxy` option.
- **`policy/record.ts`:** `ExtraStartOption` becomes `'fileWatcherPolling' | 'useHostProxy'`.
- **`policy/validate.ts`:** the allow-list check accepts both, so the `option !== 'fileWatcherPolling'` test becomes a
  membership test of one constant list of the two.
- **`lifecycle/runtime.ts`:** `startOrReuse` sets a new `StartParameters.useHostProxy: boolean` to
  `allowedExtraOptions.includes('useHostProxy')`, beside `fileWatcherPollingMilliseconds`. No setting reads it: the
  policy alone decides.
- **`scripts/bootstrap.ts`:** `startOptions` adds `--use-host-proxy` to the optional words when `useHostProxy` is true,
  after `--file-watcher-polling`.
- **Remote-SSH:** `SSH_POLICY` and its rows are unchanged, and its start line has no `--use-host-proxy`.

## 4. Rows

### 4.1 lib-product (`packages/lib-product/test/unit/resolve.test.ts`), new rows over existing code

| Cite | Given | Expected |
|---|---|---|
| F-0503 AC-35 | each of the five layers holding `https://mirror.test/base` for `remote.serverDownloadBaseUrl`, a `codium` profile | `step` `override`; the address `https://mirror.test/base/commit:<commit>/server-linux-x64/stable` |
| F-0503 AC-53 | no override, a profile with `applicationName` `codium` and a non-empty `serverDownloadUrlTemplate` | `step` `productTemplate`; the template's URL (the built-in table isn't consulted) |
| F-0503 AC-36 | no override, `codium`, no template | `step` `builtInTable`; the URL starts `https://github.com/VSCodium/vscodium/releases/download/` |
| F-0503 AC-54 | no override, `codium-insiders`, no template | `step` `builtInTable`; the URL starts `https://github.com/VSCodium/vscodium-insiders/releases/download/` |
| F-0503 AC-37 | no override, `code`, no template | `noSource` with `settingKey` `remote.serverDownloadBaseUrl` |

If a row already exists for one of these, add the cite to its name instead of writing a second row.

### 4.2 lib-server unit rows

| File | Cite | Given | Expected |
|---|---|---|---|
| `cache-folders.test.ts` | F-0503 AC-38 | `archiveKeyOf('builtInTable', {commit: 'c0ffee', version: '1.106.0', release: '25090'})` | `'1.106.025090'` |
| `cache-folders.test.ts` | F-0503 AC-38 | the same with `override`, then `productTemplate` | `'c0ffee'`, twice |
| `cache-folders.test.ts` | F-0503 AC-38 | `clientArchiveFolder('/c', product('codium', 'stable'), archiveKeyOf('builtInTable', …))` | `/c/codium/stable/1.106.025090` |
| `policy-rows.test.ts` | transport contracts §5.0 | `CONTAINERS_POLICY` | deep-equals §5.0's column, cell by cell, `cleanup` `{kind: 'onlyCurrentKeepLeftovers'}` and `allowedExtraStartOptions` `['useHostProxy']` included |
| `policy-validate.test.ts` | F-0503 BR-18 | a record with `allowedExtraStartOptions: ['useHostProxy']`, then `['fileWatcherPolling', 'useHostProxy']`, then `['other']` | valid, valid, the existing `invalid value` problem |
| `runtime.test.ts` | F-0503 BR-18 | `startOrReuse` with `['useHostProxy']`, then with `[]` | the start parameters' `useHostProxy` is `true`, then `false` |
| `bootstrap-script.test.ts` (the script text) | F-0503 BR-18 | the start body with `useHostProxy` true, then false | the `set --` line holds `--use-host-proxy` once, then not at all |
| `bootstrap-script.test.ts` | containers-05 R1 | the start body for `SSH_POLICY`'s options | byte-identical to main's (the existing regression comparison) |
| `plan.test.ts` | F-0503 BR-4 | `installTree` set, the layouts `[{kind: 'tree', …}]` | `reuse` with the tree layout; no source read (a `noSource` input still gives `reuse`) |
| `plan.test.ts` | F-0503 BR-4 | `installTree` set, the layouts `[{kind: 'bin', …}, {kind: 'tree', …}]` | `reuse` with the bin layout |
| `plan.test.ts` | F-1402 | `installTree` set, no layouts, `clientOnly`, a resolved source | `download`, `where: 'client'`, `clientFallback: false`, `installTree` the input's, `installFolder` `<dataFolder>/bin/<commit>` |
| `plan.test.ts` | containers-05 R1 | no `installTree` | the `download` plan has `installTree: ''` and is otherwise today's |
| `lifecycle.test.ts` (the probe's parsing) | F-0503 BR-4 | a result block with `server.treeComplete=yes`, then `no`, then absent | `treeComplete` `true`, `false`, `false` |

### 4.3 Real-shell script rows (`bootstrap-script.test.ts`, the existing `fakeHost` style)

Each row puts the tree under the fake host's own temporary folder, for example `<host.home>/volume/bin/linux-x64/<commit>`,
and passes the archive with `copiedParameters`, as a client-placed archive is.

| Cite | Given | Expected |
|---|---|---|
| F-0503 AC-5 | `install` with `installTree` set, empty tree | `Ok`; `<tree>/<launcher>` is executable; `<dataFolder>/bin/<commit>` is a symbolic link whose target is `<tree>`; `server.treeInstalled` `yes`; `server.installLink` `made` |
| F-0503 BR-6 | the same, while the unpack runs: replace `tar` with a stub that records `ls <tree's parent>` and then runs the real `tar` | the listing shows `<commit>_<epochMilliseconds>` and no `<commit>`; after the step, only `<commit>` |
| F-0503 AC-25 | a leftover `<tree>_1700000000000` holding a partial tree (no launcher), then `install` | `Ok`; a complete `<tree>`; the leftover is still there, unchanged |
| F-0503 BR-6 | an archive that fails to unpack (the existing non-archive body) | `UnpackFailed`; no `<tree>`; the `_` sibling is still there; no link |
| F-0503 AC-7 | a complete `<tree>`, a second data folder (another `installRoot` under the fake host), `install` | `server.treeInstalled` `no`; no archive read (the fake host's calls log has no `tar`); the second data folder's link points at the same `<tree>` |
| containers-05 R4 | a complete `<tree>` put in place by the `tar` stub after extraction (simulating another container) | `Ok`; `<tree>` is the stub's (unchanged); the script's own `_` sibling is gone; no `<tree>/<commit>_*` inside it |
| F-0503 BR-3 | a link to another folder at `bin/<commit>`, `install` with a complete tree | `server.installLink` `made`; the link now targets `<tree>` |
| F-0503 BR-3 | a link already targeting `<tree>` | `server.installLink` `kept`; the link's inode unchanged |
| containers-05 R5 | a real, complete folder at `bin/<commit>` | `server.installLink` `realFolder`; the folder unchanged; `Ok` |
| F-0503 AC-1 | `start` with `installTree` set, a complete tree and no link (a new container on a volume hit) | the link is made before the start, and the server starts (the existing start rows' assertions); no archive is read |
| containers-05 R6 | `install` and `start` with `installTree` set and `lock.inTemporaryFolder` false | the lock file is in `/tmp` (the existing lock-place rows' check), and nothing is written under `<tree>` but the server's own files |
| containers-05 R8 | `cleanup` with `onlyCurrentKeepLeftovers`, `bin/` holding links to two other commits' trees | the two links are gone; both trees still exist, complete |
| F-0503 BR-4 | `probe` with `installTree` set: a complete tree, then none | `server.treeComplete` `yes`, then `no` |

### 4.4 Regression rows (R1)

| Cite | Given | Expected |
|---|---|---|
| containers-05 R1 | for each step (`probe`, `install`, `start`, `cleanup`), the script text with `installTree: ''` | the same text as before this card, apart from the added `INSTALL_TREE=''` assignment and the inert `[ -z "$INSTALL_TREE" ] \|\| …` line. Prove it with a row that builds both and compares them line by line, with only those two lines differing |
| containers-05 R1 | remote-ssh's existing script, plan and server-steps rows | pass unchanged |

## 5. Gates and review

**Gates:** all of them, with the changed files of lib-server and lib-product at 100 %. Also:
- shellcheck on the scripts;
- `pnpm test:acceptance:server` against the harness host, so that the real host's install, start and cleanup rows still pass;
- the full VSCodium run (`xvfb-run --auto-servernum pnpm -s test:acceptance:vscodium`), with remote-ssh's launches all green.

**PR title:** `lib-server, lib-product: install into the volume tree, the containers policy row, the version key (card
containers-05, #765)`. themis or triton reviews; athena gives the design check.

## 6. Catalogue

`docs/architecture/catalogue/coverage-containers-r1.tsv`, if it's on main when this lands; if not, list the moves in the
PR:
- F-0503 AC-35, 36, 37, 38, 53 and 54 go to `unit` (the §4.1 and §4.2 rows);
- AC-1, 5, 7 and 25 stay `todo`. The container rows of card (11) and C10 tag them `acceptance`, since this card's rows are
  on a fake host, not a container.

## 7. Open rows (stop and report on #765)

1. A step's script grows past a limit the existing rows assert (for example the PowerShell 8192-character check). The
   POSIX script has none, so report any such row that fails.
2. `mv` of a directory onto a name that appeared during the step behaves differently from R4 on the host image's
   BusyBox. Report what it did; don't add `mv -T` by guess.
3. **For athena (noted, not blocking):** R9 keys by the resolution step, as she ruled. F-0503 BR-14(f) words it as "what
   the resolved template substitutes", which for an override template using `${version}` tokens would also mean a
   version key. That case isn't in release 1's rows. If she wants the template-content rule instead, the change is
   `archiveKeyOf`'s first argument only.
