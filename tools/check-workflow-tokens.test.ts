import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {parse as parseYaml} from 'yaml';
import {
  cliArchivesCacheProblems,
  cliArchivesSecretProblems,
  workflowsTokenProblems,
  workflowTokenProblems,
} from './check-workflow-tokens.ts';
import {REPOSITORY_ROOT} from './repository.ts';
import {TemporaryWorkspace} from './temporary-workspace.ts';

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
  id?: string;
  run?: string;
  uses?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
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

/** A workflow whose one job, `run`, has one step of `action` whose `path` is `paths`, one per line. */
function cacheWorkflow(action: string, paths: readonly string[]): string {
  const lines = paths.map(each => `            ${each}\n`).join('');
  return secretWorkflow(
    `    runs-on: x\n    steps:\n      - uses: ${action}\n        with:\n          path: |\n${lines}`,
  );
}

describe('check-workflow-tokens: no cache holds the CLI archives (card #3197)', () => {
  it('a cache path that names a CLI archive, or a folder it is in, fails, however it is written from the checkout', () => {
    const paths = [
      '.vscode-test/downloads',
      './.vscode-test/downloads/',
      '.vscode-test/**',
      '.vscode-test/*/cli-*.tar.gz',
      '${{ github.workspace }}/.vscode-test',
      '.',
      '.vscode-test/downloads/cli-linux-x?4.tar.gz',
      '${{ github.workspace }}',
    ];
    deepStrictEqual(
      paths.map(
        each =>
          cliArchivesCacheProblems(
            'w.yml',
            cacheWorkflow('actions/cache@v6', [each]),
          ).length,
      ),
      [4, 4, 4, 4, 4, 4, 1, 4],
    );
  });

  it('a ** path reaches the archives across folders: **/cli-*.tar.gz, .vscode-test/**/cli-* and **/cli-linux-x64.tar.gz fail, and **/VSCodium-* passes', () => {
    deepStrictEqual(
      [
        '**/cli-*.tar.gz',
        '.vscode-test/**/cli-*',
        '**/cli-linux-x64.tar.gz',
        '**/VSCodium-*',
      ].map(
        each =>
          cliArchivesCacheProblems(
            'w.yml',
            cacheWorkflow('actions/cache@v6', [each]),
          ).length,
      ),
      [4, 4, 1, 0],
    );
  });

  it('an absolute path into the workspace fails: the check cannot place it in the checkout', () => {
    deepStrictEqual(
      cliArchivesCacheProblems(
        'w.yml',
        cacheWorkflow('actions/cache@v6', [
          '/home/runner/work/remote/remote/.vscode-test',
        ]),
      ),
      [
        "w.yml: jobs.run.steps.0.with.path caches /home/runner/work/remote/remote/.vscode-test, which is outside the checkout and not one of the outside cache paths the check knows; a fork's pull request can restore a cache saved on main",
      ],
    );
  });

  it('a home path off the list, a path with a .. folder and any other expression fail, a workspace one included', () => {
    deepStrictEqual(
      [
        '~/elsewhere',
        '~/.cache',
        '../remote/.vscode-test',
        '.vscode-test/../../x',
        '${{ matrix.folder }}',
        '${{ github.workspace }}/${{ matrix.folder }}',
        '${{ steps.store.outputs.path }}/x',
      ].map(
        each =>
          cliArchivesCacheProblems(
            'w.yml',
            cacheWorkflow('actions/cache@v6', [each]),
          ).length,
      ),
      [1, 1, 1, 1, 1, 1, 1],
    );
  });

  it('a path with a glob character the check does not read fails: braces, brackets, an extglob and a backslash', () => {
    deepStrictEqual(
      [
        '.vscode-test/downloads/{cli-linux-x64.tar.gz,none}',
        '.vscode-test/downloads/cli-linux-x64.tar.g[z]',
        '.vscode-test/downloads/@(cli-linux-x64.tar.gz)',
        '.vscode-test/{downloads}',
        '.vscode-test/down[l]oads',
        '.vscode-test/downloads/cli-linux-x64\\.tar.gz',
      ].map(
        each =>
          cliArchivesCacheProblems(
            'w.yml',
            cacheWorkflow('actions/cache@v6', [each]),
          ).length,
      ),
      [1, 1, 1, 1, 1, 1],
    );
  });

  it('each outside path on the list passes: the OpenSSH build and the pnpm store', () => {
    deepStrictEqual(
      cliArchivesCacheProblems(
        'w.yml',
        cacheWorkflow('actions/cache@v6', [
          '~/.cache/remote-oss',
          '${{ steps.store.outputs.path }}',
        ]),
      ),
      [],
    );
  });

  it('a ! path is not read, so a home, an absolute or an expression one passes, and a cache path beside it is still read', () => {
    deepStrictEqual(
      [
        [
          '!~/elsewhere',
          '!/home/runner/work/remote/remote/.vscode-test',
          '!${{ matrix.folder }}',
        ],
        ['!.vscode-test/downloads/VSCodium-*', '.vscode-test/downloads'],
      ].map(
        paths =>
          cliArchivesCacheProblems(
            'w.yml',
            cacheWorkflow('actions/cache@v6', paths),
          ).length,
      ),
      [0, 4],
    );
  });

  it('a cache step of a composite action that holds the CLI archives fails, named by its runs.steps index', () => {
    deepStrictEqual(
      cliArchivesCacheProblems(
        'action.yml',
        'runs:\n  using: composite\n  steps:\n    - run: true\n      shell: bash\n    - uses: actions/cache@v6\n      with:\n        path: .vscode-test/downloads/cli-alpine-x64.tar.gz\n        key: k\n',
      ),
      [
        "action.yml: runs.steps.1.with.path caches .vscode-test/downloads/cli-alpine-x64.tar.gz, which holds the CLI archive .vscode-test/downloads/cli-alpine-x64.tar.gz; a fork's pull request can restore a cache saved on main",
      ],
    );
  });

  it('the composite actions under .github/actions are read with the workflows: action.yml or action.yaml, each folder', () => {
    const workspace = new TemporaryWorkspace('workflow-tokens');
    try {
      workspace.write(
        '.github/workflows/w.yml',
        'on: push\npermissions: {contents: read}\njobs: {}\n',
      );
      const actions: Array<[string, string]> = [
        ['.github/actions/one/action.yml', '~/elsewhere'],
        [
          '.github/actions/two/action.yaml',
          '.vscode-test/downloads/cli-linux-x64.tar.gz',
        ],
        ['.github/actions/three/action.yml', '~/.cache/remote-oss'],
      ];
      for (const [file, cachePath] of actions) {
        workspace.write(
          file,
          `runs:\n  using: composite\n  steps:\n    - uses: actions/cache@v6\n      with:\n        path: ${cachePath}\n        key: k\n`,
        );
      }
      deepStrictEqual(
        workflowsTokenProblems(workspace.root).map(
          problem => problem.split(' caches ')[0],
        ),
        [
          '.github/actions/one/action.yml: runs.steps.0.with.path',
          '.github/actions/two/action.yaml: runs.steps.0.with.path',
        ],
      );
    } finally {
      workspace.remove();
    }
  });

  it('the restore and save actions are read too, and a problem names the step, the path and the archive', () => {
    deepStrictEqual(
      ['actions/cache/restore@v6', 'actions/cache/save@v6'].map(action =>
        cliArchivesCacheProblems(
          'w.yml',
          cacheWorkflow(action, [
            '.vscode-test/downloads/VSCodium-*',
            '.vscode-test/downloads/cli-alpine-x64.tar.gz',
          ]),
        ),
      ),
      [0, 1].map(() => [
        "w.yml: jobs.run.steps.0.with.path caches .vscode-test/downloads/cli-alpine-x64.tar.gz, which holds the CLI archive .vscode-test/downloads/cli-alpine-x64.tar.gz; a fork's pull request can restore a cache saved on main",
      ]),
    );
  });

  it('the VSCodium archives, a listed path outside the checkout, a ! path, a near name whose dot is literal, another action and a step with no path pass', () => {
    deepStrictEqual(
      [
        cacheWorkflow('actions/cache@v6', [
          '.vscode-test/downloads/VSCodium-*',
          '.vscode-test/downloads/vscodium-reh-*',
          '~/.cache/remote-oss',
          '!.vscode-test/downloads',
          '.vscode-test/downloads/cli.linux-x64.tar.gz',
        ]),
        cacheWorkflow('actions/upload-artifact@v5', ['.vscode-test']),
        secretWorkflow(
          '    runs-on: x\n    steps:\n      - uses: actions/cache@v6\n      - run: true\n',
        ),
        secretWorkflow('    uses: ./.github/workflows/other.yml\n'),
      ].map(text => cliArchivesCacheProblems('w.yml', text)),
      [[], [], [], []],
    );
  });

  it('the repository’s six VSCodium jobs cache the VSCodium archives alone, under the pins’ key with no fallback, before the acceptance step', () => {
    const jobs: Array<[string, string]> = [
      ['ci.yml', 'acceptance-vscodium'],
      ['ci.yml', 'acceptance-vscodium-containers'],
      ['ci.yml', 'acceptance-vscodium-cli'],
      ['acceptance-launches.yml', 'run'],
      ['acceptance-launches.yml', 'run-containers'],
      ['acceptance-launches.yml', 'run-cli'],
    ];
    deepStrictEqual(
      jobs.map(([file, name]) => {
        const steps = jobsOf(file)[name]?.steps ?? [];
        const pins = steps.findIndex(step => step.id === 'vscodium-pins');
        const acceptance = steps.findIndex(
          step =>
            step.run?.startsWith('pnpm test:acceptance:vscodium') === true,
        );
        return [
          steps[pins - 1]?.run,
          steps[pins]?.run,
          steps[pins + 1]?.uses,
          steps[pins + 1]?.with,
          pins + 1 < acceptance,
        ];
      }),
      jobs.map(() => [
        'pnpm install --frozen-lockfile',
        'node tools/vscodium-pins-key.ts >> "$GITHUB_OUTPUT"',
        'actions/cache@v6',
        {
          path: '.vscode-test/downloads/VSCodium-*\n.vscode-test/downloads/vscodium-reh-*\n',
          key: 'vscodium-archives-${{ runner.os }}-${{ runner.arch }}-${{ steps.vscodium-pins.outputs.key }}',
        },
        true,
      ]),
    );
  });
});
