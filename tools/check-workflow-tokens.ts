/**
 * @fileoverview check-workflow-tokens: no workflow holds a write permission on an event that someone without write
 * access can start.
 *
 * An edit that the github-actions App makes in this public repository is then always the work of a workflow that
 * someone with write access pushed. A job whose token may write runs only on `push`, `schedule`, `workflow_dispatch`,
 * or `pull_request` behind the guard that skips a fork's pull request. Every other event, `pull_request_target`,
 * `workflow_run`, `issue_comment` and `issues` among them, fails the check, and so does a workflow that leaves its
 * token to the repository's default.
 *
 * The secret that reads the CLI archives' repository reaches one kind of step only: the step that fetches the CLI
 * archives, which holds it in its own `env`. A job that calls a workflow may pass it there by name; no job passes
 * every secret (`secrets: inherit`), and no workflow or job `env` holds it, so the acceptance step, which starts the
 * editor, the hosts and the containers with its environment, never sees it.
 */

import {readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {parse as parseYaml} from 'yaml';
import {isMainModule, REPOSITORY_ROOT} from './repository.ts';

const WORKFLOWS = '.github/workflows';

/** The events a job whose token may write can run on. */
const WRITE_EVENTS = new Set([
  'pull_request',
  'push',
  'schedule',
  'workflow_dispatch',
]);

/** The guard that skips a fork's pull request, as the workflows write it. */
const FORK_GUARD =
  'github.event.pull_request.head.repo.full_name == github.repository';

/** A workflow's or a job's `permissions`: `read-all`, `write-all`, or a scope per permission. */
type Permissions = string | Readonly<Record<string, string>> | undefined;

interface Workflow {
  on?: unknown;
  permissions?: Permissions;
  jobs?: Record<string, {permissions?: Permissions; if?: unknown}>;
}

/** The secret that reads the CLI archives' repository, the expression that reads it, and the one step that may. */
const CLI_ARCHIVES_SECRET = 'REMOTE_OSS_CLI_ARCHIVES_TOKEN';
const CLI_ARCHIVES_EXPRESSION = `secrets.${CLI_ARCHIVES_SECRET}`;
const CLI_ARCHIVES_STEP = 'node tools/fetch-cli-archives.ts';

/** Each string in `value` with the path of keys and indexes to it. */
function stringsOf(
  value: unknown,
  keyPath: ReadonlyArray<string | number> = [],
): Array<[ReadonlyArray<string | number>, string]> {
  if (typeof value === 'string') {
    return [[keyPath, value]];
  }
  if (Array.isArray(value)) {
    return value.flatMap((each, index) => stringsOf(each, [...keyPath, index]));
  }
  return typeof value === 'object' && value !== null
    ? Object.entries(value).flatMap(([key, each]) =>
        stringsOf(each, [...keyPath, key]),
      )
    : [];
}

/**
 * Whether the string at `keyPath` in `workflow` may read the CLI archives' secret: the value of that variable in the
 * `env` of a step that runs the CLI archives' fetch, or of that name in a job's `secrets` for the workflow it calls.
 */
function mayReadCliArchivesSecret(
  workflow: Record<string, unknown>,
  keyPath: ReadonlyArray<string | number>,
): boolean {
  const [jobsKey, jobName, part, index, field, variable] = keyPath;
  if (jobsKey !== 'jobs' || typeof jobName !== 'string') {
    return false;
  }
  if (keyPath.length === 4 && part === 'secrets') {
    return index === CLI_ARCHIVES_SECRET;
  }
  if (
    keyPath.length !== 6 ||
    part !== 'steps' ||
    field !== 'env' ||
    variable !== CLI_ARCHIVES_SECRET
  ) {
    return false;
  }
  const steps = (
    workflow.jobs as Record<string, {steps?: Array<{run?: unknown}>}>
  )[jobName]?.steps;
  const command = steps?.[Number(index)]?.run;
  return typeof command === 'string' && command.startsWith(CLI_ARCHIVES_STEP);
}

/** What is wrong with the workflow `file` whose text is `text` in the reach of the CLI archives' secret. */
export function cliArchivesSecretProblems(
  file: string,
  text: string,
): string[] {
  const workflow = (parseYaml(text) ?? {}) as Record<string, unknown>;
  const problems = Object.entries(
    (workflow.jobs ?? {}) as Record<string, {secrets?: unknown}>,
  )
    .filter(([, definition]) => definition.secrets === 'inherit')
    .map(
      ([name]) =>
        `${file}: job ${name} passes every secret to the workflow it calls (secrets: inherit)`,
    );
  for (const [keyPath, value] of stringsOf(workflow)) {
    if (
      value.includes(CLI_ARCHIVES_EXPRESSION) &&
      !mayReadCliArchivesSecret(workflow, keyPath)
    ) {
      problems.push(
        `${file}: ${keyPath.join('.')} reads ${CLI_ARCHIVES_EXPRESSION}, which only the env of the CLI archives' fetch step may`,
      );
    }
  }
  return problems;
}

/** The events of a workflow's `on`: a name, a list of names, or a map from name to its filters. */
function eventsOf(on: unknown): string[] {
  if (typeof on === 'string') {
    return [on];
  }
  if (Array.isArray(on)) {
    return on.map(String);
  }
  return typeof on === 'object' && on !== null ? Object.keys(on) : [];
}

/**
 * The operands of the top-level `&&` of an expression, each trimmed, with `${{ }}` around the whole taken off; none
 * when the expression has a top-level `||`, since `||` binds looser and its other side would run the job alone.
 */
function conjunctsOf(expression: string): string[] | undefined {
  const text = expression
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .trim();
  const operands: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    depth += character === '(' ? 1 : character === ')' ? -1 : 0;
    if (depth === 0 && text.startsWith('||', index)) {
      return undefined;
    }
    if (depth === 0 && text.startsWith('&&', index)) {
      operands.push(text.slice(start, index).trim());
      start = index + 2;
      index += 1;
    }
  }
  operands.push(text.slice(start).trim());
  return operands;
}

/** Whether a job's `if` holds the fork guard as the whole condition or as one operand of its top-level `&&`. */
function forkGuarded(condition: unknown): boolean {
  const operands =
    typeof condition === 'string' ? conjunctsOf(condition) : undefined;
  return (operands ?? []).some(
    operand => operand === FORK_GUARD || operand === `(${FORK_GUARD})`,
  );
}

/** Whether `permissions` lets the token write anything. */
function writes(permissions: Permissions): boolean {
  if (typeof permissions === 'string') {
    return permissions === 'write-all';
  }
  return Object.values(permissions ?? {}).includes('write');
}

/** What is wrong with the workflow `file` whose text is `text`: each write token on an event too many can start. */
export function workflowTokenProblems(file: string, text: string): string[] {
  const workflow = parseYaml(text) as Workflow;
  if (workflow.permissions === undefined) {
    return [
      `${file}: no top-level permissions, so its token takes the repository's default, which may write`,
    ];
  }
  const events = eventsOf(workflow.on);
  const problems: string[] = [];
  for (const [name, definition] of Object.entries(workflow.jobs ?? {})) {
    if (!writes(definition.permissions ?? workflow.permissions)) {
      continue;
    }
    for (const event of events) {
      if (!WRITE_EVENTS.has(event)) {
        problems.push(
          `${file}: job ${name} holds a write permission and runs on ${event}, which someone without write access can start`,
        );
      }
    }
    if (events.includes('pull_request') && !forkGuarded(definition.if)) {
      problems.push(
        `${file}: job ${name} holds a write permission on pull_request without the guard that skips a fork's pull request`,
      );
    }
  }
  return problems;
}

/** The problems of every workflow under `root`'s `.github/workflows`: its tokens, and the reach of the CLI archives' secret. */
export function workflowsTokenProblems(root: string): string[] {
  const folder = path.join(root, WORKFLOWS);
  return readdirSync(folder)
    .filter(entry => /\.ya?ml$/.test(entry))
    .sort()
    .flatMap(entry => {
      const file = `${WORKFLOWS}/${entry}`;
      const text = readFileSync(path.join(folder, entry), 'utf8');
      return [
        ...workflowTokenProblems(file, text),
        ...cliArchivesSecretProblems(file, text),
      ];
    });
}

if (isMainModule(import.meta.url)) {
  const problems = workflowsTokenProblems(REPOSITORY_ROOT);
  for (const problem of problems) {
    console.error(`check-workflow-tokens: ${problem}`);
  }
  if (problems.length === 0) {
    console.log('check-workflow-tokens: ok');
  }
  process.exitCode = problems.length === 0 ? 0 : 1;
}
