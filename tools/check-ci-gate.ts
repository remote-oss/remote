/**
 * @fileoverview check-ci-gate: ci.yml's ci-gate job needs every other job of the workflow (athena on #1076), and every
 * job that can run on the organisation's pool keeps a fork's pull request off it.
 *
 * The main ruleset requires only `ci-gate`, which passes when every job it needs passed or was skipped. A job the gate
 * doesn't need could fail and still leave the gate green, so a job added later must join the gate's `needs`.
 *
 * A job whose `runs-on` reads a pool variable holds, in that expression, the same-repository guard (a fork's pull
 * request takes GitHub's runner), asks for X64 and ephemeral (a fresh machine per job), and reads no secret (athena on
 * #2219).
 *
 * The launch jobs give a dispatch concurrency groups of its own run (`github.run_id`): a group that names only the part
 * lets one dispatch replace another's pending part.
 */

import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {parse as parseYaml} from 'yaml';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

const WORKFLOWS = '.github/workflows';
const WORKFLOW = `${WORKFLOWS}/ci.yml`;
const GATE = 'ci-gate';
/** The repository variables that send a job to the organisation's pool. */
const POOL_VARIABLES = ['vars.CI_POOL_RUNS_ON', 'vars.CI_CHECKS_RUNS_ON'];
/** The guard a pool `runs-on` holds, so that a fork's pull request takes GitHub's runner. */
export const SAME_REPOSITORY_GUARD =
  "(github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository)";
/** The labels a pool `runs-on` asks for besides the pool's own. */
const POOL_LABELS = '"X64","ephemeral"';

/** What is wrong with the workflow text's gate: a job it doesn't need, a need that names no job, or no gate. */
export function ciGateProblems(text: string): string[] {
  const workflow = parseYaml(text) as {
    jobs?: Record<string, {needs?: string | string[]}>;
  };
  const jobs = Object.keys(workflow.jobs ?? {});
  const gate = workflow.jobs?.[GATE];
  if (gate === undefined) {
    return [`${WORKFLOW}: no ${GATE} job`];
  }
  const needs = new Set(
    typeof gate.needs === 'string' ? [gate.needs] : (gate.needs ?? []),
  );
  const problems: string[] = [];
  for (const name of jobs) {
    if (name !== GATE && !needs.has(name)) {
      problems.push(
        `${WORKFLOW}: ${GATE} doesn't need ${name}, so ${name} can fail and the gate still pass`,
      );
    }
  }
  for (const need of needs) {
    if (!jobs.includes(need)) {
      problems.push(`${WORKFLOW}: ${GATE} needs ${need}, which is no job`);
    }
  }
  return problems;
}

/** The launch jobs whose concurrency groups name the run for a dispatch. */
export const DISPATCH_GROUP_JOBS = [
  'acceptance-vscodium',
  'acceptance-genuine',
];

/** What is wrong with the launch jobs' groups in the workflow text: a group a dispatch of another run can share. */
export function dispatchGroupProblems(text: string): string[] {
  const workflow = parseYaml(text) as {
    jobs?: Record<string, {concurrency?: {group?: unknown}}>;
  };
  return DISPATCH_GROUP_JOBS.flatMap(name =>
    JSON.stringify(workflow.jobs?.[name]?.concurrency?.group ?? '').includes(
      'github.run_id',
    )
      ? []
      : [
          `${WORKFLOW}: ${name}'s concurrency group doesn't name the run, so one dispatch can replace another's pending job`,
        ],
  );
}

/** What is wrong with the pool jobs of the workflow `file`: a missing guard or labels, or a secret read. */
export function poolJobProblems(file: string, text: string): string[] {
  const workflow = parseYaml(text) as {
    jobs?: Record<string, Record<string, unknown>>;
  };
  const problems: string[] = [];
  for (const [name, definition] of Object.entries(workflow.jobs ?? {})) {
    const runsOn = JSON.stringify(definition['runs-on'] ?? '');
    if (!POOL_VARIABLES.some(variable => runsOn.includes(variable))) {
      continue;
    }
    const expression = String(definition['runs-on']);
    if (!expression.includes(SAME_REPOSITORY_GUARD)) {
      problems.push(
        `${file}: ${name} can run on the pool, and its runs-on lacks the same-repository guard`,
      );
    }
    if (!expression.includes(POOL_LABELS)) {
      problems.push(
        `${file}: ${name} can run on the pool without asking for X64 and ephemeral`,
      );
    }
    if (JSON.stringify(definition).includes('secrets.')) {
      problems.push(`${file}: ${name} can run on the pool and reads a secret`);
    }
  }
  return problems;
}

if (isMainModule(import.meta.url)) {
  const workflowText = readFileSync(
    path.join(REPOSITORY_ROOT, WORKFLOW),
    'utf8',
  );
  const problems = [
    ...ciGateProblems(workflowText),
    ...dispatchGroupProblems(workflowText),
    ...readdirSync(path.join(REPOSITORY_ROOT, WORKFLOWS))
      .filter(file => file.endsWith('.yml'))
      .flatMap(file =>
        poolJobProblems(
          `${WORKFLOWS}/${file}`,
          readFileSync(path.join(REPOSITORY_ROOT, WORKFLOWS, file), 'utf8'),
        ),
      ),
  ];
  for (const problem of problems) {
    console.error(`check-ci-gate: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('check-ci-gate: ok');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
