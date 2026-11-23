import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parse as parseYaml} from 'yaml';
import {
  cliArchivesSecretProblems,
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

/** A workflow with one job, `run`, whose YAML lines after `jobs:` are `jobLines`, and `topLines` before `jobs:`. */
function secretWorkflow(jobLines: string, topLines = ''): string {
  return `on: push\npermissions: {contents: read}\n${topLines}jobs:\n  run:\n${jobLines}`;
}

const SECRET = '${{ secrets.REMOTE_OSS_CLI_ARCHIVES_TOKEN }}';
const FETCH = 'node tools/fetch-cli-archives.ts --launches "$LAUNCHES"';
const REFUSED =
  "reads secrets.REMOTE_OSS_CLI_ARCHIVES_TOKEN, which only the env of the CLI archives' fetch step may";

/** A step of a workflow, as the rows below read it. */
interface ReadStep {
  run?: string;
  env?: Record<string, string>;
}

/** The jobs of the repository's workflow `file`. */
function jobsOf(file: string): Record<string, {steps?: ReadStep[]}> {
  return (
    parseYaml(
      readFileSync(
        path.join(REPOSITORY_ROOT, '.github', 'workflows', file),
        'utf8',
      ),
    ) as {jobs: Record<string, {steps?: ReadStep[]}>}
  ).jobs;
}

describe('check-workflow-tokens: the reach of the CLI archives’ secret', () => {
  it('the env of the CLI archives’ fetch step and a called workflow’s secret of that name may read it', () => {
    deepStrictEqual(
      [
        cliArchivesSecretProblems(
          'w.yml',
          secretWorkflow(
            `    runs-on: x\n    steps:\n      - run: ${FETCH}\n        env:\n          REMOTE_OSS_CLI_ARCHIVES_TOKEN: ${SECRET}\n      - run: pnpm test:acceptance:vscodium\n`,
          ),
        ),
        cliArchivesSecretProblems(
          'w.yml',
          secretWorkflow(
            `    uses: ./.github/workflows/acceptance-launches.yml\n    secrets:\n      REMOTE_OSS_CLI_ARCHIVES_TOKEN: ${SECRET}\n`,
          ),
        ),
      ],
      [[], []],
    );
  });

  it('the acceptance step, a job’s or the workflow’s env, a called workflow’s secret of another name, and an action’s inputs may not', () => {
    deepStrictEqual(
      [
        `    runs-on: x\n    steps:\n      - run: pnpm test:acceptance:vscodium\n        env:\n          REMOTE_OSS_CLI_ARCHIVES_TOKEN: ${SECRET}\n`,
        `    runs-on: x\n    env:\n      REMOTE_OSS_CLI_ARCHIVES_TOKEN: ${SECRET}\n    steps:\n      - run: ${FETCH}\n`,
        `    uses: ./.github/workflows/acceptance-launches.yml\n    secrets:\n      OTHER: ${SECRET}\n`,
        `    runs-on: x\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          token: ${SECRET}\n`,
      ]
        .map(jobLines =>
          cliArchivesSecretProblems('w.yml', secretWorkflow(jobLines)),
        )
        .concat([
          cliArchivesSecretProblems(
            'w.yml',
            secretWorkflow(
              '    runs-on: x\n    steps:\n      - run: true\n',
              `env:\n  REMOTE_OSS_CLI_ARCHIVES_TOKEN: ${SECRET}\n`,
            ),
          ),
        ]),
      [
        `w.yml: jobs.run.steps.0.env.REMOTE_OSS_CLI_ARCHIVES_TOKEN ${REFUSED}`,
        `w.yml: jobs.run.env.REMOTE_OSS_CLI_ARCHIVES_TOKEN ${REFUSED}`,
        `w.yml: jobs.run.secrets.OTHER ${REFUSED}`,
        `w.yml: jobs.run.steps.0.with.token ${REFUSED}`,
        `w.yml: env.REMOTE_OSS_CLI_ARCHIVES_TOKEN ${REFUSED}`,
      ].map(problem => [problem]),
    );
  });

  it('a job that passes every secret to the workflow it calls fails', () => {
    deepStrictEqual(
      cliArchivesSecretProblems(
        'w.yml',
        secretWorkflow(
          '    uses: ./.github/workflows/acceptance-launches.yml\n    secrets: inherit\n',
        ),
      ),
      [
        'w.yml: job run passes every secret to the workflow it calls (secrets: inherit)',
      ],
    );
  });

  it('the repository’s CLI jobs fetch the CLI archives just before the acceptance step, which runs without the secret, and their steps are the other VSCodium jobs’ but for the fetch', () => {
    const pairs: Array<[string, string, string]> = [
      ['ci.yml', 'acceptance-vscodium-cli', 'acceptance-vscodium'],
      ['acceptance-launches.yml', 'run-cli', 'run'],
    ];
    deepStrictEqual(
      pairs.map(([file, cliJob, poolJob]) => {
        const jobs = jobsOf(file);
        const cliSteps = jobs[cliJob]?.steps ?? [];
        const fetch = cliSteps.findIndex(
          step =>
            step.run?.startsWith('node tools/fetch-cli-archives.ts') === true,
        );
        return [
          file,
          cliSteps[fetch]?.run,
          cliSteps[fetch]?.env?.REMOTE_OSS_CLI_ARCHIVES_TOKEN,
          cliSteps[fetch + 1]?.run?.startsWith('pnpm test:acceptance:vscodium'),
          Object.keys(cliSteps[fetch + 1]?.env ?? {}),
          JSON.stringify(cliSteps.filter((each, index) => index !== fetch)) ===
            JSON.stringify(jobs[poolJob]?.steps),
        ];
      }),
      pairs.map(([file]) => [file, FETCH, SECRET, true, ['LAUNCHES'], true]),
    );
  });
});
