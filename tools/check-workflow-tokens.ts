/**
 * @fileoverview check-workflow-tokens: no workflow holds a write permission on an event that someone without write
 * access can start.
 *
 * An edit that the github-actions App makes in this public repository is then always the work of a workflow that
 * someone with write access pushed. A job whose token may write runs only on `push`, `schedule`, `workflow_dispatch`,
 * or `pull_request` behind the guard that skips a fork's pull request. Every other event, `pull_request_target`,
 * `workflow_run`, `issue_comment` and `issues` among them, fails the check, and so does a workflow that leaves its
 * token to the repository's default.
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
    const guarded =
      typeof definition.if === 'string' && definition.if.includes(FORK_GUARD);
    if (events.includes('pull_request') && !guarded) {
      problems.push(
        `${file}: job ${name} holds a write permission on pull_request without the guard that skips a fork's pull request`,
      );
    }
  }
  return problems;
}

/** The problems of every workflow under `root`'s `.github/workflows`. */
export function workflowsTokenProblems(root: string): string[] {
  const folder = path.join(root, WORKFLOWS);
  return readdirSync(folder)
    .filter(entry => /\.ya?ml$/.test(entry))
    .sort()
    .flatMap(entry =>
      workflowTokenProblems(
        `${WORKFLOWS}/${entry}`,
        readFileSync(path.join(folder, entry), 'utf8'),
      ),
    );
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
