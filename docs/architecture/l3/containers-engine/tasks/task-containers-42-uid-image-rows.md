# Task card containers-42: F-0416's user and UID image rows and tags (containers release 1)

Issue: #1051. Milestone 0.4, containers release 1. Size: L (two PRs). Builder: `task:claude` (dike). F-0415 follows
in a card of its own.

**What this card is:** every F-0416 line of `docs/architecture/catalogue/coverage-containers-r1.tsv` that is `todo`
(39 today) ends with a final tag, and every criterion this release builds gets the row that proves it. No row cites
F-0416 today. F-0416 is in release 1 because the pinned CLI makes the `-uid` image as part of `up`, and core criteria
of F-0401, F-0403, F-0405, F-0412 and F-0501 depend on it (brief §2, "Two features outside the P0 list"). C3, the CLI
bridge, owns it. Product code changes only where a row shows that the product misses the spec **and** the fix is
inside one component's existing contract; anything else is an open row (§6).

Sources: F-0416 (remote-oss/remote-containers#63), all of it; the brief `brief-release-1.md` §2 and §3 ruling 6
(the pinned CLI 0.89.0, ADR-0005); ADR-0009 (C3 hands the CLI the folder and the configuration); card containers-04
(C3) and containers-06 (C7's `up`).

## 1. The method

The same as containers-41 §1 (#1050): for each F-0416 `todo` line, in file order, read the criterion and give it
one tag by the first rule that applies: `deferred` (the cut's form, e.g. `containers release 1: later (Compose)`),
`core`, `acceptance`, `unit`, else write the row and tag it. An existing row that proves a criterion gets the cite;
don't duplicate a row.

## 2. Two groups, and one question already with athena

**Group A, the user and the UID image (rows now).** What the CLI decides and our extension only drives: the
resolved `containerUser` and `remoteUser` (with image metadata's default, 6.3), the `-uid` image and when it is or
isn't made (`updateRemoteUserUID`, 6.2, 6.6, root or numeric targets, the collision no-op), an Alpine account (6.8),
`remoteUser` edited and reloaded without a rebuild (6.9, 6.11, 7.E4), and the invalid-account errors (7.E2, 7.E3,
7.E7) with the F-0410 dialog they reach. These rows are acceptance rows in the `containers` launch, asserting what
`docker inspect`, `docker exec <id> id -u <user>` and the window show.

**Group B, the environment: `deferred` (athena on #1049, 2026-10-19, in `brief-release-1.md` via #1055).**
`remoteEnv`, `userEnvProbe` and the terminal and task environment aren't in release 1: the CLI applies them only to
the lifecycle commands it runs, and our server start applies neither (`connector.ts` returns `extensionHostEnv: {}`,
`server-steps.ts` passes `environmentSetup: ''`). Tag these `deferred` with the reason
`containers release 1: later (the remote environment, F-0416)`: AC-14, AC-17, AC-18, AC-22, AC-23, AC-25, AC-27,
AC-28, AC-29, AC-31, AC-42, AC-43, AC-44, AC-45, AC-46 and AC-47, and the terminal halves of AC-15 and AC-32. A
criterion with a terminal half and a `containerEnv` or user half (AC-15, AC-32) is tagged by the half this release
proves: write the row for the other half and tag it `acceptance`; say so in the PR. `containerEnv`'s own criteria
(the variable reaches the container itself) are group A. Moving the half into release 1 is the user's call (hermes
has it); if it comes in, it is a product card first, and these lines move with it.

## 3. Writing the rows

- **Acceptance rows** go in `tests/acceptance/containers/users.test.ts` (new), `describe('F-0416 users and the UID
  image (card containers-42)')`, `this.timeout(900_000)`. Use the helpers of `tests/acceptance/windows/` that
  `gate.test.ts` and `workspace-mount.test.ts` use; write no helper that duplicates one.
- **Images:** build what a row needs from the run's image (`HARNESS_DEVCONTAINER_IMAGE`) with a `build.dockerfile`
  that adds the accounts (`adduser`), so no row pulls an image from a registry. A row that needs image metadata's
  `remoteUser` sets the `devcontainer.metadata` label in its Dockerfile.
- **The host's UID** is the runner's (`process.getuid()`); a row that needs a *different* account UID than the host's
  creates the account with a fixed UID that isn't it.
- **Folder names** start `c42-`. Each row removes its containers in `finally` (`removeContainers`), and its images
  (`docker image rm -f`), including the `-uid` image the CLI made.
- **Measure before you assert.** Run the row against main first and read what the CLI and the window do. Matching the
  criterion: assert it. Otherwise: open row (§6).

## 4. PRs

(a) Group A's user resolution and the UID image; (b) group A's errors and reload cases, group B's `deferred` tags and
the rest of the tags. Each PR moves only its own lines of the coverage file. PR
titles: `tests: F-0416's <subject> rows (card containers-42, #1051)`. Request athena only; hermes assigns the peer.

## 5. Gates

All gates; the changed files at 100 %; `node tools/check-coverage.ts` green; the `containers` launch locally
(`docker ps` first; remove your leftovers after, images included).

## 6. Open rows (stop that criterion, report it on the issue, carry on with the others)

1. The CLI or the window does something other than the criterion. Post the row, its output and the criterion;
   daedalus decides between a bridge change (a card), a spec question, or a `deferred`.
2. A criterion needs a harness capability that `tests/acceptance/windows/` lacks. Report it; daedalus adds it.
3. A group B criterion turns out to be decided by the CLI alone (so not the remote environment): post why, and tag it
   with group A.
