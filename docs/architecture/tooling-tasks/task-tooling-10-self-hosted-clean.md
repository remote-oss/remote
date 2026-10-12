# Task card tooling-10: self-hosted CI jobs start clean (#283 note, ruled on #253)

Why: since #283 the CI jobs can run on self-hosted runners (`runs-on: ${{ vars.CI_RUNS_ON || 'ubuntu-latest' }}`).
A self-hosted runner keeps its workspace and its Docker state between jobs, so a test can pass or fail on another
job's leftovers, and "green" would mean the head plus the runner's history. The architect ruled (#253, from themis's
review of #283) that every job starts clean, by job-level clean-up that does not depend on how the runner is set up.
Reviewing coder: `remote-coding-worker-1`.

## What the acceptance jobs create today (checked on main, 2026-10-12)

Two harnesses start the SSH host the same way: `tools/acceptance.ts` `prepare` (the editor suite, `pnpm
test:acceptance`) and `tests/acceptance/server/host-fixture.ts` `startHost` (`pnpm test:acceptance:server` and
`…:real-server`). Each runs `docker build --tag remote-oss-acceptance-host` (`HOST_IMAGE`) and then `docker run
--detach --rm --publish 127.0.0.1::22` an **anonymous** container, removed by `docker rm --force` when the run ends
normally. No network and no named volume is created. What survives a job that is killed or crashes: the container
(`--rm` acts only when it stops), and the shared image tag, which two jobs on one runner rebuild under the same name.

## 1. File boundary

| File | Change |
|---|---|
| `tools/acceptance-run.ts` | new: the run's identity, the one start of the host container, and the clean-up (section 2) |
| `tools/acceptance-run.test.ts` | new |
| `tools/acceptance.ts` | `prepare` calls `startHostContainer` instead of its own build, keygen and run; its private `checked` moves to `acceptance-run.ts` and is imported |
| `tests/acceptance/server/host-fixture.ts` | `startHost` calls `startHostContainer` with `runCommand`; its private `checked` is deleted and imported |
| `.github/workflows/ci.yml` | the three acceptance jobs gain a first step and an `if: always()` last step (section 2) |
| `package.json` | one script, `acceptance:clean` (section 2) |

Nothing else. The two harnesses copy the same build, keygen and run sequence today, and two copies of `checked`; this
card leaves one of each, which is also the one place the run's label is set. `actions/checkout` stays as it is: its
`clean: true` default already removes untracked files from the workspace, `node_modules` and `.tsc` included, because
both are inside the checkout.

## 2. Contract

`tools/acceptance-run.ts`:

```ts
/** The label every Docker object of an acceptance run carries; its value is the run's id. */
export const RUN_LABEL = 'remote-oss.acceptance.run';
/** Runs a program and waits for it; the shape of `tools/acceptance.ts`'s `CommandRunner`. */
export type CommandRunner = (program: string, programArguments: readonly string[]) => CommandResult;
/** The standard output of a command that must succeed; it throws with the command and its standard error otherwise. */
export function checked(command: CommandRunner, program: string, programArguments: readonly string[]): string;
/** The run's id: `GITHUB_RUN_ID-GITHUB_RUN_ATTEMPT` in CI, else `local-<process id>`. */
export function acceptanceRunId(environment: NodeJS.ProcessEnv, processId: number): string;
/** The image tag of the run: `remote-oss-acceptance-host:<run id>`. */
export function hostImageOf(runId: string): string;
/** What a started host container is: its id, its mapped SSH port, and the key file of the run. */
export interface HostContainer {
  container: string;
  port: number;
  keyFile: string;
}
/** Builds the run's image, makes the run's key in `runFolder`, and runs the labelled container. */
export function startHostContainer(command: CommandRunner, root: string, runId: string, runFolder: string): HostContainer;
/** Removes the run's containers (by label, forced) and its image tag; what is already gone is not an error. */
export function cleanRun(command: CommandRunner, runId: string): void;
```

- `CommandRunner` and `CommandResult` move here from `tools/acceptance.ts`, which imports them, as `checked` does.
- `acceptanceRunId`: `${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-${GITHUB_JOB}` when all three are set and non-empty (a
  re-run is a new attempt with its own objects; the three acceptance jobs of ONE workflow run share run id and attempt
  and may run at the same time on runners that share a Docker daemon, so the job's id keeps one job's clean-up from
  removing another job's live container; amended by athena 2026-10-12, #287); otherwise `local-${processId}`.
- `startHostContainer` is the shared sequence exactly as both harnesses run it today (build `--load --quiet`, the
  ed25519 key with comment `acceptance` and no passphrase, `run --detach --rm --env AUTHORIZED_KEY=… --publish
  127.0.0.1::22`, then `docker port … 22` through `mappedPort`), with two changes: the build's `--tag` is
  `hostImageOf(runId)` and the run adds `--label ${RUN_LABEL}=${runId}` and uses that tag. `HOST_IMAGE` stays the
  image's name; the tag is the run.
- `prepare` and `startHost` each read `acceptanceRunId(process.env, process.pid)` once and pass it in. What each does
  after the container is up (ssh_config, the wait for sshd, settings, the channel) is unchanged.
- `cleanRun`: `docker ps --all --quiet --filter label=${RUN_LABEL}=${runId}`, then `docker rm --force` for each id;
  then `docker image rm --force hostImageOf(runId)`. A non-zero status of the image removal (the image is gone) is
  ignored. Then it lists the label once more: a container still carrying the run's label after the removals makes
  `cleanRun` throw, naming the ids (amended by athena 2026-10-12: this is the check that a later run on the same
  runner starts from the same state, which the ruling asks for; a silent `rm` failure must fail the job, not leave
  state behind). It never runs `docker system prune`, `docker container prune`, `docker volume prune` or a filter that is
  not this run's label: the machine is shared.
- `package.json`: `"acceptance:clean": "node tools/acceptance-run.ts --clean"`, which runs `cleanRun(runCommand,
  acceptanceRunId(process.env, process.pid))` and exits 0.
- `ci.yml`, in each of `acceptance-slice-1`, `acceptance-server` and `acceptance-real-server`: after `pnpm install`,
  a step `pnpm acceptance:clean` (a leftover of an earlier attempt of the same run); and a last step with
  `if: always()` running `pnpm acceptance:clean`. The `checks` and `quality` jobs use no Docker and are unchanged.

## 3. Test table

All rows in `tools/acceptance-run.test.ts` with a fake `CommandRunner` that records each call and answers from a
script, except the last.

| Given | Expected |
|---|---|
| `GITHUB_RUN_ID=77`, `GITHUB_RUN_ATTEMPT=2`, `GITHUB_JOB=acceptance-server` | `acceptanceRunId` gives `77-2-acceptance-server` |
| the same run and attempt with `GITHUB_JOB=acceptance-slice-1` | a different id: two jobs of one run never share a label |
| `GITHUB_JOB` empty | `local-<process id>` |
| no GitHub variables, process id 4242 | `local-4242` |
| `GITHUB_RUN_ID` set, `GITHUB_RUN_ATTEMPT` empty | `local-<process id>` |
| `hostImageOf('77-2')` | `remote-oss-acceptance-host:77-2` |
| `checked` with a command that exits 1 with stderr `bad` | throws an error naming the program, its arguments, the status and `bad` |
| `startHostContainer(fake, root, '77-2', folder)` | the `build` call has `--tag remote-oss-acceptance-host:77-2`; the `run` call has `--label remote-oss.acceptance.run=77-2` and the same tag; the result's port is the fake `docker port` answer's |
| `cleanRun(fake, '77-2')` with the fake listing two containers | the fake saw `ps` with the label filter, two `rm --force`, one `image rm --force` of the run's tag, in that order |
| `cleanRun` when the image removal fails | no throw |
| `cleanRun` when the second label listing still returns a container | throws, naming that container's id |
| any `cleanRun` | no call contains `prune`, and every `ps` filter is `label=remote-oss.acceptance.run=<the run id>` |
| `tools/acceptance.test.ts` and the server acceptance tests | pass unchanged |
| a second run on the same runner | starts from the same state. Run locally, output in the PR: run `pnpm test:acceptance:server` and kill it with `SIGKILL` once its container is up; `docker ps --all --filter label=remote-oss.acceptance.run` lists that run's container only; `pnpm acceptance:clean` with that run's id leaves none; a second `pnpm test:acceptance:server` then passes |

## 4. Rule for the worker

As card log-01; the tools ratchet may only rise. Do not change how the host behaves inside the container, and do not
touch the `checks` or `quality` jobs.

## 5. Gates and review

PR title `tooling: acceptance runs clean their own Docker objects (card tooling-10)`; answers R1–R6. A CI-only change
merges on athena's approval plus green CI (R-99).

## 6. Open rows

None for the code.

**The stronger option is the user's (D-82):** register the self-hosted runners with `--ephemeral`, so each runner
takes one job and is replaced. That clears the workspace and every Docker object between jobs. This card does not
depend on it: the clean-up above holds on a long-lived runner too.

**Until this card lands (athena's ruling):** a red acceptance job on a self-hosted runner gets one re-run before it
counts as a code failure.
