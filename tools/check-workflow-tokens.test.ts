import {deepStrictEqual} from 'node:assert';
import {
  workflowsTokenProblems,
  workflowTokenProblems,
} from './check-workflow-tokens.ts';
import {REPOSITORY_ROOT} from './repository.ts';

const GUARD =
  'github.event.pull_request.head.repo.full_name == github.repository';

/** A workflow on `events` whose one job, `strip`, has `permissions` at the top and the job's own `jobPermissions` and `guard`. */
function workflow(
  events: string,
  permissions: string,
  jobPermissions = '',
  guard = '',
): string {
  const ownPermissions =
    jobPermissions === '' ? '' : `    permissions: ${jobPermissions}\n`;
  const ownGuard = guard === '' ? '' : `    if: ${guard}\n`;
  return `on: ${events}\npermissions: ${permissions}\njobs:\n  strip:\n    runs-on: x\n${ownPermissions}${ownGuard}`;
}

const WRITE = '{contents: read, pull-requests: write}';

describe('check-workflow-tokens', () => {
  it('a write token on pull_request_target, workflow_run, issue_comment or issues fails', () => {
    deepStrictEqual(
      ['pull_request_target', 'workflow_run', 'issue_comment', 'issues'].map(
        event => workflowTokenProblems('w.yml', workflow(event, WRITE)),
      ),
      ['pull_request_target', 'workflow_run', 'issue_comment', 'issues'].map(
        event => [
          `w.yml: job strip holds a write permission and runs on ${event}, which someone without write access can start`,
        ],
      ),
    );
  });

  it('a write token on push, schedule or a dispatch passes, and on pull_request only behind the fork guard', () => {
    deepStrictEqual(
      [
        workflowTokenProblems(
          'w.yml',
          workflow('[push, schedule, workflow_dispatch]', 'write-all'),
        ),
        workflowTokenProblems(
          'w.yml',
          workflow('pull_request', WRITE, '', GUARD),
        ),
        workflowTokenProblems('w.yml', workflow('pull_request', WRITE)),
      ],
      [
        [],
        [],
        [
          "w.yml: job strip holds a write permission on pull_request without the guard that skips a fork's pull request",
        ],
      ],
    );
  });

  it('the fork guard counts as the whole if or one operand of its top-level &&, never negated, OR-ed or beside a top-level ||', () => {
    deepStrictEqual(
      [
        `\${{ ${GUARD} }}`,
        `!cancelled() && (${GUARD}) && github.actor != 'x'`,
        `!(${GUARD})`,
        `${GUARD} || github.event_name == 'push'`,
        `(github.event_name == 'push' || ${GUARD}) && always()`,
        `${GUARD} && always() || github.event_name == 'pull_request'`,
        `(${GUARD} || always()) && ${GUARD}`,
      ].map(
        condition =>
          workflowTokenProblems(
            'w.yml',
            workflow('pull_request', WRITE, '', JSON.stringify(condition)),
          ).length,
      ),
      [0, 0, 1, 1, 1, 1, 0],
    );
  });

  it('a read-only token passes on any event, and a job keeps its own permissions over the workflow’s', () => {
    deepStrictEqual(
      [
        workflowTokenProblems(
          'w.yml',
          workflow('pull_request_target', '{contents: read}'),
        ),
        workflowTokenProblems(
          'w.yml',
          workflow('pull_request_target', 'read-all'),
        ),
        workflowTokenProblems(
          'w.yml',
          workflow('workflow_run', WRITE, '{contents: read}'),
        ),
        workflowTokenProblems(
          'w.yml',
          workflow('workflow_run', '{contents: read}', '{issues: write}'),
        ).length,
      ],
      [[], [], [], 1],
    );
  });

  it('the events may be a name, a list or a map, and a workflow with no top-level permissions fails', () => {
    deepStrictEqual(
      [
        workflowTokenProblems(
          'w.yml',
          `on: {issue_comment: {types: [created]}}\npermissions: write-all\njobs:\n  a:\n    runs-on: x\n`,
        ).length,
        workflowTokenProblems(
          'w.yml',
          'on: push\njobs:\n  a:\n    runs-on: x\n',
        ),
        workflowTokenProblems(
          'w.yml',
          'permissions: write-all\njobs:\n  a:\n    runs-on: x\n',
        ),
      ],
      [
        1,
        [
          "w.yml: no top-level permissions, so its token takes the repository's default, which may write",
        ],
        [],
      ],
    );
  });

  it('the repository’s workflows pass', () => {
    deepStrictEqual(workflowsTokenProblems(REPOSITORY_ROOT), []);
  });
});
