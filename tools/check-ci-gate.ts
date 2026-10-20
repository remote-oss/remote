/**
 * @fileoverview check-ci-gate: ci.yml's ci-gate job needs every other job of the workflow (athena on #1076).
 *
 * The main ruleset requires only `ci-gate`, which passes when every job it needs passed or was skipped. A job the gate
 * doesn't need could fail and still leave the gate green, so a job added later must join the gate's `needs`.
 */

import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parse as parseYaml} from 'yaml';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

const WORKFLOW = '.github/workflows/ci.yml';
const GATE = 'ci-gate';

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

if (isMainModule(import.meta.url)) {
  const problems = ciGateProblems(
    readFileSync(path.join(REPOSITORY_ROOT, WORKFLOW), 'utf8'),
  );
  for (const problem of problems) {
    console.error(`check-ci-gate: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('check-ci-gate: ok');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
