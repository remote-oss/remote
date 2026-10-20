/**
 * @fileoverview import-suite: a conformance suite imported from one staging branch into its target repository. Every
 * import row runs on a scripted command runner, so nothing is fetched or pushed; one row runs the required check's
 * script on a scratch repository, and one starts the program with an argument it refuses before any command.
 */

import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {type CommandResult, runCommand} from './command-runner.ts';
import {
  checkSubject,
  checkSuitePaths,
  ImportRefusal,
  importRequestOf,
  pullRequestBody,
  runImport,
  runScopeCheck,
  scopeScript,
} from './import-suite.ts';

const STAGING = 'staging-org/suite-staging';
const TARGET = 'remote-oss/remote-ssh';
const BRANCH = 'suite/2026-10-20-0123456789ab';
const COMMIT = 'c'.repeat(40);
const REQUEST = importRequestOf([STAGING, BRANCH, TARGET]);
const WORKFLOW = readFileSync(
  path.join(
    import.meta.dirname,
    '..',
    '.github',
    'workflows',
    'suite-scope.yml',
  ),
  'utf8',
);

/** What the scripted repositories answer; a row changes any of it. */
interface Script {
  fetched: string[];
  paths: string;
  subject: string;
  status: string;
  scope: CommandResult;
}

const ANSWERS: Script = {
  fetched: [COMMIT, COMMIT],
  paths:
    'tests/conformance/cases/F-2104-AC5-1.yaml\ntests/conformance/runner/encode/suite.py\n',
  subject: `Conformance suite 0123456789ab for ${TARGET}: F-2104`,
  status: ' M tests/conformance/cases/F-2104-AC5-1.yaml\n',
  scope: {status: 0, stdout: 'changed:\n', stderr: ''},
};

type Runner = (
  program: string,
  programArguments: readonly string[],
) => CommandResult;

/** A command's success with `stdout`. */
function reply(stdout: string): CommandResult {
  return {status: 0, stdout, stderr: ''};
}

/** One import on the scripted repositories: its exit code, its line, each command as one line, and `gh`'s arguments. */
function importOn(changes: Partial<Script> = {}, failing?: Runner) {
  const answers = {...ANSWERS, ...changes};
  const fetched = [...answers.fetched];
  const heads = ['b'.repeat(40), 'd'.repeat(40)];
  const calls: string[] = [];
  const pullRequests: string[][] = [];

  /** The scripted answer of one command; a command not named here succeeds with no output. */
  function answer(
    program: string,
    programArguments: readonly string[],
  ): CommandResult {
    const line = [program, ...programArguments].join(' ');
    if (program === 'env') {
      return answers.scope;
    }
    if (program === 'gh') {
      pullRequests.push([...programArguments]);
      return reply('https://github.com/remote-oss/remote-ssh/pull/77\n');
    }
    if (line.endsWith('rev-parse FETCH_HEAD')) {
      return reply(`${fetched.shift() ?? ''}\n`);
    }
    if (line.endsWith('rev-parse HEAD')) {
      return reply(`${heads.shift() ?? ''}\n`);
    }
    const outputs: Array<[string, string]> = [
      [' ls-tree ', answers.paths],
      [' log -1 ', `${answers.subject}\n`],
      [' status --porcelain ', answers.status],
      [' diff --no-renames ', 'tests/conformance/cases/F-2104-AC5-1.yaml\n'],
    ];
    return reply(outputs.find(([part]) => line.includes(part))?.[1] ?? '');
  }

  /** Notes the command as one line of its arguments' first lines, then answers it. */
  function noted(
    program: string,
    programArguments: readonly string[],
  ): CommandResult {
    calls.push(
      [program, ...programArguments.map(value => value.split('\n')[0])].join(
        ' ',
      ),
    );
    return answer(program, programArguments);
  }

  const lines: string[] = [];
  const code = runImport([STAGING, BRANCH, TARGET], failing ?? noted, line => {
    lines.push(line);
  });
  return {code, lines, calls, pullRequests};
}

/** Whether one of `calls` matches `pattern`. */
function gave(calls: readonly string[], pattern: RegExp): boolean {
  return calls.some(call => pattern.test(call));
}

/** The message of what `check` throws, or "accepted". */
function refusalOf(check: () => unknown): string {
  try {
    check();
    return 'accepted';
  } catch (caught) {
    return caught instanceof Error ? caught.message : 'not an error';
  }
}

/** A scratch repository's three commits: a README, then a suite file, then a README change; their shas. */
function scratchRepository(folder: string): string[] {
  const environment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'suite',
    GIT_AUTHOR_EMAIL: 'suite@example.invalid',
    GIT_COMMITTER_NAME: 'suite',
    GIT_COMMITTER_EMAIL: 'suite@example.invalid',
  };
  spawnSync('git', ['init', '-q', folder], {env: environment});
  mkdirSync(path.join(folder, 'tests', 'conformance'), {recursive: true});
  return [
    ['README.md', 'a suite repository\n'],
    ['tests/conformance/a.yaml', 'id: a\n'],
    ['README.md', 'changed\n'],
  ].map(([file = '', text = '']) => {
    writeFileSync(path.join(folder, file), text);
    spawnSync('git', ['-C', folder, 'add', '--all'], {env: environment});
    spawnSync('git', ['-C', folder, 'commit', '-q', '-m', file], {
      env: environment,
    });
    return spawnSync('git', ['-C', folder, 'rev-parse', 'HEAD'], {
      env: environment,
      encoding: 'utf8',
    }).stdout.trim();
  });
}

describe('import-suite', () => {
  it('the arguments give the request: a staging repository, a suite branch with its date and digest, a target repository', () => {
    deepStrictEqual(REQUEST, {
      staging: STAGING,
      branch: BRANCH,
      target: TARGET,
      date: '2026-10-20',
      digest: '0123456789ab',
    });
  });

  it('a wrong count, a branch that is not suite/<date>-<sha12> and a repository that is not owner/name are refused', () => {
    deepStrictEqual(
      [
        ['only-one'],
        ['a/b', 'main', 'c/d'],
        ['a/b', 'suite/2026-10-20-0123456789AB', 'c/d'],
        ['nobody', BRANCH, 'c/d'],
        ['a/b', BRANCH, 'c/d/e'],
      ].map(programArguments =>
        refusalOf(() => importRequestOf(programArguments)),
      ),
      [
        'usage: import-suite <staging owner/name> suite/<YYYY-MM-DD>-<sha12> <target owner/name>',
        'main is not a suite/<YYYY-MM-DD>-<sha12> branch',
        'suite/2026-10-20-0123456789AB is not a suite/<YYYY-MM-DD>-<sha12> branch',
        'nobody is not an owner/name repository',
        'c/d/e is not an owner/name repository',
      ],
    );
  });

  it('paths outside tests/conformance/ are refused by name, so is a branch with none, and a suite alone passes', () => {
    deepStrictEqual(
      [
        ['tests/conformance/a.yaml', '.github/x.yml', 'README.md'],
        [],
        ['tests/conformance/a.yaml'],
      ].map(paths =>
        refusalOf(() => {
          checkSuitePaths(paths);
        }),
      ),
      [
        'the branch holds paths outside tests/conformance/: .github/x.yml, README.md',
        'the branch holds no files',
        'accepted',
      ],
    );
  });

  it('a subject of another form, for another target repository or with another digest is refused', () => {
    deepStrictEqual(
      [
        'a suite',
        'Conformance suite 0123456789ab for remote-oss/remote-containers: F-0409',
        'Conformance suite ffffffffffff for remote-oss/remote-ssh: F-2104',
        ANSWERS.subject,
      ].map(subject =>
        refusalOf(() => {
          checkSubject(subject, REQUEST);
        }),
      ),
      [
        'the commit\'s subject is not "Conformance suite <sha12> for <owner/name>: ...": a suite',
        'the suite is for remote-oss/remote-containers, not remote-oss/remote-ssh',
        'the commit names the suite ffffffffffff, the branch 0123456789ab',
        'accepted',
      ],
    );
  });

  it("the required check's script is read from its workflow, and a workflow without that step is an error", () => {
    const missing =
      'the suite-scope workflow has no step "Every changed path is under tests/conformance/"';
    deepStrictEqual(
      [
        scopeScript(WORKFLOW).includes(
          'git diff --no-renames --name-only "$BASE...$HEAD"',
        ),
        refusalOf(() => scopeScript('name: x\n')),
        refusalOf(() => scopeScript('jobs:\n  check:\n    runs-on: x\n')),
      ],
      [true, missing, missing],
    );
  });

  it("the required check's script runs as the import runs it: a change inside the suite passes, one outside is refused", () => {
    const folder = mkdtempSync(path.join(os.tmpdir(), 'import-suite-scope-'));
    try {
      const [base = '', inside = '', outside = ''] = scratchRepository(folder);
      const passed = runScopeCheck(runCommand, folder, base, inside, WORKFLOW);
      const refused = runScopeCheck(
        runCommand,
        folder,
        base,
        outside,
        WORKFLOW,
      );
      deepStrictEqual(
        [
          passed.status,
          refused.status,
          refused.stderr.includes(
            'refused: paths outside tests/conformance/:\nREADME.md',
          ),
        ],
        [0, 1, true],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('an import fetches the one branch, checks the result, pushes its own branch and opens the pull request naming the staging branch and its commit', () => {
    const {code, lines, calls, pullRequests} = importOn();
    deepStrictEqual(
      [
        code,
        lines,
        gave(
          calls,
          /^git -C \S+staging fetch -q --depth=1 https:\/\/github\.com\/staging-org\/suite-staging\.git refs\/heads\/suite\/2026-10-20-0123456789ab$/,
        ),
        gave(calls, /^env -C \S+target BASE=b{40} HEAD=d{40} bash -e -c /),
        gave(
          calls,
          /^git -C \S+target push -q https:\/\/github\.com\/remote-oss\/remote-ssh\.git HEAD:refs\/heads\/suite-import\/2026-10-20-0123456789ab$/,
        ),
        pullRequests,
      ],
      [
        0,
        ['https://github.com/remote-oss/remote-ssh/pull/77'],
        true,
        true,
        true,
        [
          [
            'pr',
            'create',
            '-R',
            TARGET,
            '--base',
            'main',
            '--head',
            'suite-import/2026-10-20-0123456789ab',
            '--title',
            `tests/conformance: the suite of ${BRANCH}`,
            '--body',
            pullRequestBody(REQUEST, COMMIT, 2, 1),
          ],
        ],
      ],
    );
  });

  it("the pull request's body names the staging repository, the branch, its commit, the file count and the check's result", () => {
    deepStrictEqual(pullRequestBody(REQUEST, COMMIT, 2, 1).split('\n'), [
      'The conformance suite of one staging branch, imported by `tools/import-suite.ts` of remote-oss/remote.',
      '',
      `- **Staging repository:** \`${STAGING}\``,
      `- **Branch:** \`${BRANCH}\`, at commit \`${COMMIT}\``,
      '- **Files:** 2, every one under `tests/conformance/`',
      '- **suite-scope:** passed on this branch before it was pushed, with 1 changed path(s)',
      '',
      'Only that branch of the staging repository was read.',
    ]);
  });

  it('a branch with a path outside the suite is refused before the target repository is cloned', () => {
    const {code, lines, calls} = importOn({
      paths: 'tests/conformance/a.yaml\nnotes.md\n',
    });
    deepStrictEqual(
      [code, lines, gave(calls, / clone /), gave(calls, /^gh /)],
      [
        2,
        [
          'import-suite: refused: the branch holds paths outside tests/conformance/: notes.md',
        ],
        false,
        false,
      ],
    );
  });

  it('a subject for another target repository is refused, and nothing is pushed', () => {
    const {code, lines, calls} = importOn({
      subject:
        'Conformance suite 0123456789ab for remote-oss/remote-wsl: F-7001',
    });
    deepStrictEqual(
      [code, lines, gave(calls, / push /)],
      [
        2,
        [
          'import-suite: refused: the suite is for remote-oss/remote-wsl, not remote-oss/remote-ssh',
        ],
        false,
      ],
    );
  });

  it('a branch that moves between the two fetches is refused', () => {
    const moved = 'e'.repeat(40);
    deepStrictEqual(importOn({fetched: [COMMIT, moved]}).lines, [
      `import-suite: refused: the branch moved while it was imported (${COMMIT}, then ${moved})`,
    ]);
  });

  it('a suite the target repository already holds is neither committed nor pushed', () => {
    const {code, lines, calls} = importOn({status: ''});
    deepStrictEqual(
      [code, lines, gave(calls, / commit /), gave(calls, / push /)],
      [
        0,
        [
          `import-suite: ${TARGET}'s main already holds the suite of ${BRANCH}; nothing pushed`,
        ],
        false,
        false,
      ],
    );
  });

  it("the required check's refusal is the import's, in its own words from stderr or else stdout, and nothing is pushed", () => {
    const fromError = importOn({
      scope: {
        status: 1,
        stdout: 'changed:\nREADME.md\n',
        stderr: 'refused: paths outside tests/conformance/:\nREADME.md\n',
      },
    });
    const fromOutput = importOn({
      scope: {status: 1, stdout: 'refused', stderr: ''},
    });
    deepStrictEqual(
      [
        fromError.code,
        fromError.lines,
        gave(fromError.calls, / push /),
        fromOutput.lines,
      ],
      [
        2,
        [
          'import-suite: refused: suite-scope: refused: paths outside tests/conformance/: README.md',
        ],
        false,
        ['import-suite: refused: suite-scope: refused'],
      ],
    );
  });

  it('a command that fails is a failure, exit code 1, not a refusal', () => {
    const {code, lines} = importOn({}, () => ({
      status: 128,
      stdout: '',
      stderr: 'fatal: could not read from remote',
    }));
    deepStrictEqual(
      [code, lines[0]?.startsWith('import-suite: git init -q ')],
      [1, true],
    );
  });

  it('wrong arguments are refused with exit code 2, and no command runs', () => {
    const commands: string[] = [];
    const lines: string[] = [];
    const code = runImport(
      [STAGING, 'main'],
      program => {
        commands.push(program);
        return reply('');
      },
      line => {
        lines.push(line);
      },
    );
    deepStrictEqual(
      [code, lines, commands],
      [
        2,
        [
          'import-suite: refused: usage: import-suite <staging owner/name> suite/<YYYY-MM-DD>-<sha12> <target owner/name>',
        ],
        [],
      ],
    );
  });

  it('the program refuses a wrong branch with exit code 2 before any command', () => {
    const result = spawnSync(
      process.execPath,
      [
        path.join(import.meta.dirname, 'import-suite.ts'),
        STAGING,
        'main',
        TARGET,
      ],
      {encoding: 'utf8'},
    );
    deepStrictEqual(
      [result.status, result.stdout],
      [
        2,
        'import-suite: refused: main is not a suite/<YYYY-MM-DD>-<sha12> branch\n',
      ],
    );
  });

  it('a refusal is an ImportRefusal, which the program tells from a failure', () => {
    deepStrictEqual(
      refusalOf(() => {
        throw new ImportRefusal('why');
      }),
      'why',
    );
  });
});
