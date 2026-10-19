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

**Group B, the environment (hold until athena rules).** `containerEnv`, `remoteEnv`, `userEnvProbe` and the `HOME`
and `SHELL` overrides (6.4, 6.7, 6.10, 7.E1, 7.E1a, 7.E5, 7.E6, VS-6, VS-7, VS-9). `containerEnv` is the CLI's and
reaches the container itself, so its rows are group A. But **our server start applies no `remoteEnv` and runs no
`userEnvProbe`** today: `server-steps.ts` passes `environmentSetup: ''`, and nothing in `remote-containers/src`
reads either property. Whether release 1 carries them is a scope question; daedalus has put it to athena on the
design issue. Until she rules, tag nothing in group B except `containerEnv`'s own criteria, and leave the rest `todo`
with no reason. If she rules them in, daedalus cards the server-environment change, and this card's group B rows
follow it; if out, they become `deferred` with her reason.

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

(a) Group A's user resolution and the UID image; (b) group A's errors and reload cases, and the tags. Group B comes
after athena's ruling, in this card or the follow-up. Each PR moves only its own lines of the coverage file. PR
titles: `tests: F-0416's <subject> rows (card containers-42, #1051)`. Request athena only; hermes assigns the peer.

## 5. Gates

All gates; the changed files at 100 %; `node tools/check-coverage.ts` green; the `containers` launch locally
(`docker ps` first; remove your leftovers after, images included).

## 6. Open rows (stop that criterion, report it on the issue, carry on with the others)

1. The CLI or the window does something other than the criterion. Post the row, its output and the criterion;
   daedalus decides between a bridge change (a card), a spec question, or a `deferred`.
2. A criterion needs a harness capability that `tests/acceptance/windows/` lacks. Report it; daedalus adds it.
3. A group B criterion turns out to be decided by the CLI alone (so not held by the question): post why, and tag it
   with group A.
