# Task card tooling-50: a VSCodium run covers only the launches a change can reach

Issue: #914. R-112 (athena, decisions.md): in-scope code PRs merge only with a green VSCodium run at
their head, one run at a time (#912: one concurrency group). This card is piece 3 of R-112. R-99: CI and tools only,
nothing under `packages/*/src`. Size: M. Builder: proteus (ops), athena's design check.

## 1. Why

Every VSCodium run makes every launch of `tools/acceptance-launches.ts` (the ssh launches, the failing connects, the
explorer, trust and containers launches): 23 to 28 minutes per run today (four runs on 2026-10-14). With one run at a time, a queue of PRs
waits on launches their change cannot reach. A Dev Containers change does not need the failing-connect launches of
Remote - SSH, and an explorer change does not need the containers ones.

## 2. The rule

A run takes a list of launch labels. The list comes from the files the PR changes against its base:

| Changed path | Launches |
|---|---|
| `packages/remote-containers/**` | the launches whose `withExtensions` hold `remote-oss.remote-containers` |
| `packages/remote-explorer/**` | the launches whose `withExtensions` hold `remote-oss.remote-explorer` |
| `packages/remote-ssh/**`, `packages/remote-ssh-edit/**` | every launch (every window runs Remote - SSH) |
| `tests/acceptance/<suite>/**` (a suite folder) | the launches whose `suite` is that folder |
| `packages/lib-*/**`, `tools/build.ts`, `tools/acceptance*.ts`, `tests/acceptance/windows/**`, `tests/acceptance/runner*/**`, `package.json`, `pnpm-lock.yaml`, `.github/workflows/ci.yml` | every launch |
| anything else (`docs/**`, other packages' tests, cards) | no launch: the run is skipped and reported green with "no launch reachable" |

A path that matches no row of the table but lies under `packages/` or `tests/acceptance/` selects every launch:
the rule fails toward running more, never less. The main backstop (a push to main, #912) and a release tag always run
every launch.

## 3. The change

1. `tools/acceptance-select.ts`: `selectLaunches(changed: string[], launches: Launch[]): {labels: string[]; why: string[]}`
   implements the table from `launchesOf` (no list of labels kept by hand: a new launch is selected by its own fields).
   `why` names, per selected label, the changed path that selected it, printed in the run's log.
2. `tools/acceptance.ts --launches <label,...>` makes only those launches, in their usual order; an unknown label is an
   error naming the known ones. Without the flag, every launch, as today.
3. `ci.yml`: the dispatch takes a `launches` input (`all`, `none`, or a comma list). hermes's R-112 dispatch passes the
   output of `node tools/acceptance-select.ts --base <base sha> --head <head sha>`; `all` stays the default.
4. The job's summary lists the launches it made and the ones it skipped, so a green run says what it covered.

## 4. Rows

- each row of the table, on a fixture `launchesOf`, gives exactly its launches;
- a change touching two packages gives the union;
- an unmatched path under `packages/` gives every launch; a docs-only change gives none;
- `--launches` with an unknown label fails and names the known ones; with a known list, `acceptance.ts` makes only
  those (a stubbed launch runner records the order);
- a new launch added to `launchesOf` with `withExtensions: ['remote-oss.remote-containers']` is selected by a
  Dev Containers change with no edit to the selector.

## 5. Not in scope

Splitting one VSCodium run over several runners (the one-group rule of #912 stays); selecting tests inside a launch.
