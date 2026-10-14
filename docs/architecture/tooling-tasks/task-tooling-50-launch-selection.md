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
| `docs/**`, `*.md` anywhere, `packages/*/test/unit/**`, `tools/**/*.test.ts` | no launch: the run is skipped and reported green with "no launch reachable" |
| `packages/remote-containers/**` (not its unit tests) | the launches whose `withExtensions` hold `remote-oss.remote-containers` |
| `packages/remote-explorer/**` (not its unit tests) | the launches whose `withExtensions` hold `remote-oss.remote-explorer` |
| `tests/acceptance/<folder>/**`, where `<folder>` is the `suite` of at least one launch in `launchesOf` | the launches whose `suite` is that folder |
| anything else: `packages/remote-ssh/**`, `packages/remote-ssh-edit/**`, `packages/lib-*/**`, every other `tools/**` (`build.ts`, `acceptance*.ts`, `package-extensions.ts`, `command-runner.ts`, `process-ids.ts`, `script-file.ts`, `host-variants.ts`, `repository.ts`, ...), every other path under `tests/acceptance/` (`host/`, the host image; `suite/`, the shared `settle.ts`; `window-agent/` and `slow-remote/`, extensions the launches install; `devcontainer-image/`, `windows/`, `runner*/`, `vscode-test.mjs`, `package.json`, `tsconfig.json`), root configuration, the lockfile and `.github/**` | every launch |

The no-launch row is a closed list and everything not on it runs more (dike on #915): a path the table does not name
falls to the last row. A change touching several rows gets the union. The main backstop (a push to main, #912) and a
release tag always run every launch.

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
- `tools/command-runner.ts` (a tool outside build and acceptance) gives every launch; so do `tests/acceptance/host/x`
  and `tests/acceptance/window-agent/x` (folders no launch has as its `suite`);
- a change touching two packages gives the union;
- an unmatched path anywhere gives every launch; a docs-only change, or a unit-test-only change, gives none;
- `--launches` with an unknown label fails and names the known ones; with a known list, `acceptance.ts` makes only
  those (a stubbed launch runner records the order);
- a new launch added to `launchesOf` with `withExtensions: ['remote-oss.remote-containers']` is selected by a
  Dev Containers change with no edit to the selector.

## 5. Not in scope

Splitting one VSCodium run over several runners (the one-group rule of #912 stays); selecting tests inside a launch.
