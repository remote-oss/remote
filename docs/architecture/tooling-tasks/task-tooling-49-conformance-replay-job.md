# Task card tooling-49: a CI job that replays a recorded conformance suite against our build

Issue: #886. Priority: Remote - Containers (the user's decision of 2026-10-14). It unblocks the Containers
recorded gate: F-0201 and F-0409, replayed on linux/x86_64 against our `remote-oss.remote-containers` VSIX. R-99: CI and
tools only, nothing under `packages/*/src`. Size: M. Builder: proteus (ops), athena's design check.

## 1. Why

The Containers release takes a recorded gate: the dirty side's cases of F-0201 (110 confirmable) and F-0409 (70),
confirmed on linux/x86_64, replayed by the conformance runner (`tests/conformance/runner`) against our build. Nothing in
CI runs that runner today: `.github/workflows/ci.yml` has no conformance step, so the gate has nowhere to run.

Measured on the runners (probe on remote-labs-ci-1, 2026-10-14), the runner's requirements
(`tests/conformance/runner/README.md`, "Requirements") all hold:
- `docker run --privileged docker:28-dind` works: the private daemons can start;
- the Docker bridge is 172.17.0.1, and a container port published on 172.17.0.1:5055 is reachable from the job (the
  fixture mirror's address);
- `bwrap`, `socat`, `python3` with PyYAML, `Xvfb` and `git` are installed; `sudo -n dnf` works;
- `packages.microsoft.com` (the VS Code yum repository) and `mcr.microsoft.com` (the mirror's sources) answer;
- about 297 GB free under `$HOME` and Docker's root; each runner has its own Docker daemon, 2 CPUs and 8 GiB.
The system Node is older than 20; the job installs Node 24 with `actions/setup-node`, as `ci.yml` does.

## 2. The change

### 2.1 A workflow of its own: `.github/workflows/conformance.yml`

A separate workflow, so it never shares `ci.yml`'s concurrency groups or slows pull requests. Triggers:
`workflow_dispatch` only, with inputs:

| Input | Meaning |
|---|---|
| `package` | the package under test, `remote-containers` (the only choice for now) |
| `suite_ref` | the commit of `remote-oss/<package>` whose `tests/conformance` is replayed (a full sha, never a branch) |
| `features` | space-separated feature ids, default `F-0201 F-0409` |
| `shards` | how many runners share the cases, default 4 |

Concurrency: `conformance-${{ inputs.package }}`, `cancel-in-progress: false`: a second dispatch waits.

### 2.2 Jobs

1. **`build`** (one runner): check out this repository at the dispatched ref, `pnpm install --frozen-lockfile`,
   `pnpm package`, upload `dist/<package>-<version>.vsix` as an artifact.
2. **`list`** (one runner): check out the suite (2.3), list the case ids of `features` whose `recorded.platform` or
   `recorded.confirmed` holds `linux/x86_64` (the runner skips the others as `not-applicable` anyway; listing them first
   keeps the shards even), and split them round-robin into `shards` lists, given to the matrix as a JSON output.
3. **`replay`** (matrix over the shard lists, `fail-fast: false`, `timeout-minutes: 240`), each:
   - check out this repository and the suite; download the VSIX;
   - install VS Code stable **1.139.1** (`recorded.vscode_version`): `sudo dnf install -y code-1.139.1-<build>` from
     `packages.microsoft.com/yumrepos/vscode`, with the rpm's sha256 pinned in the workflow and checked before install;
     skipped when `/usr/share/code/code --version` already says 1.139.1 (the runner container keeps it between jobs);
   - `actions/setup-node` 24; `npm ci` in `tests/conformance/runner/lab`;
   - environment: `CONFORMANCE_SUITE=<suite>/tests/conformance`, `CONFORMANCE_WORK=$HOME/conformance-work` (never under
     `/tmp`, which the runner refuses), `ENCODE_SLOTS=31-31` (one slot: 2 CPUs), `ENCODE_EXTENSION=<the VSIX>`,
     `ENCODE_IDENTITY`/`ENCODE_RULES` = `tests/conformance/packages/<package>/{identity.yaml,rules.json}`, `DISPLAY` from
     `xvfb-run`;
   - fixtures, built once per runner and kept: `bin/conformance build mirror --pull`, `build engine/base`,
     `build engine/pilot-states`, `build editor/fresh-public`, and each `git/<name>` the cases need. A fixture whose
     definition hash matches the local catalogue is not rebuilt (`fixture.py verify`); the mirror container
     `encode-registry` and the engine images stay on the runner's daemon between jobs;
   - `bin/conformance run --feature … --case <id> …` for the shard's cases;
   - upload `$CONFORMANCE_WORK/results/<suite-run>/` (one JSON per case, `summary.json`, no transcripts) as an artifact;
     transcripts stay on the runner and are removed with the run folder.
4. **`summary`** (one runner, `needs: replay`, `if: always()`): merge the shards' `summary.json` into one table in
   the job summary: per feature, pass / fail / not-applicable / not-comparable, and the failing case ids with their first
   difference line. The workflow fails when any case fails or is not-comparable (the runner's own exit rule).

### 2.3 The suite checkout

The suites live in private repositories, and the workflow's `GITHUB_TOKEN` reaches this repository only. The suite is
checked out with `actions/checkout` (`repository: remote-oss/<package>`, `ref: ${{ inputs.suite_ref }}`,
`sparse-checkout: tests/conformance`) and a token from the repository secret **`CONFORMANCE_SUITES_TOKEN`**: read-only
`contents` on the `remote-oss/remote-*` suite repositories, nothing else. Creating it is an org-owner action (§6).

### 2.4 The package's identity and rules

`tests/conformance/packages/remote-containers/{identity.yaml,rules.json}`, copied byte for byte from the published suite's
runner copy (`tests/conformance/runner/encode/` at the `suite_ref` that carries them), as remote-ssh-edit's are. The dirty
side is publishing the containers `rules.json` there (made by the kit's own function at kit 5a13f57). A separate small PR
adds the two files; this job reads them.

### 2.5 Leftovers

After every shard, whatever its outcome: the runner's private daemons, slot editors and workspaces of that run are gone
(the runner's own teardown, checked with `docker ps -a --filter label=encode.run`), and `$CONFORMANCE_WORK/slots`,
`workspaces` and `results` are emptied. The fixtures (`$CONFORMANCE_WORK/fixtures`, the mirror and the engine images) stay.

## 3. Rows

| Where | Row |
|---|---|
| `tools/conformance-shards.test.ts` (the `list` job's script) | the platform filter: a case recorded on linux/arm64 with no x86_64 confirm is not listed; one confirmed for linux/x86_64 is |
| same | round-robin: 10 ids over 4 shards gives 3, 3, 2, 2 in id order; 0 ids gives one empty shard and the replay matrix skips it |
| same | the merge of shard summaries: counts add per feature; a not-comparable makes the merged result fail |
| `tools/conformance-shards.test.ts` | the VS Code rpm pin: the workflow's version is the suite's `recorded.vscode_version` |

## 4. Verification (proteus)

The build PR opens with `needs-verification`. proteus dispatches it at the remote-containers suite commit that carries
`rules.json`, with `features: F-0201`, and checks:
- every shard ran its cases; the merged summary counts match the case files of F-0201 confirmed for linux/x86_64;
- no case is not-comparable;
- leftovers (2.5) on each runner used.
The pass or fail counts of our build are the result, not a condition: a failing case is a product finding for the
Containers cards.

## 5. Gates and review

`pnpm lint`, `format:check`, `test:unit` (the new rows), `dupes`, `dead`. athena reviews the design; a peer reviews.

## 6. Open rows (stop and report on this card's issue)

1. **The suite token (org owner):** `CONFORMANCE_SUITES_TOKEN` is a repository secret with read access to the private
   `remote-oss/remote-*` suite repositories. Creating it (a fine-grained token or a GitHub App installation token) is
   for the organization's owner. Until it exists, the job can't check out the suite.
2. Microsoft's repository no longer offers `code-1.139.1`: report it; do not take another version (the cases were
   recorded on 1.139.1).
3. The mirror's sources can't be pulled by their pinned digests on the runner: report the image and the error.
4. A shard needs more than 240 minutes: report the per-case times; raise `shards` before the timeout.
