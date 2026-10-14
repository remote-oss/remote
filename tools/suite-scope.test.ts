/**
 * @fileoverview suite-scope: the required check of a conformance suite repository's pull requests. The workflow's own
 * script runs here against scratch repositories, as the organisation's ruleset runs it against a suite's pull request.
 */

import {deepStrictEqual, notStrictEqual, strictEqual} from 'node:assert';
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
import {parse} from 'yaml';

const WORKFLOW = path.join(
  import.meta.dirname,
  '..',
  '.github',
  'workflows',
  'suite-scope.yml',
);
const STEP = 'Every changed path is under tests/conformance/';
const GIT_ENVIRONMENT = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'suite',
  GIT_AUTHOR_EMAIL: 'suite@example.invalid',
  GIT_COMMITTER_NAME: 'suite',
  GIT_COMMITTER_EMAIL: 'suite@example.invalid',
};

interface Workflow {
  jobs: Record<string, {steps: Array<{name?: string; run?: string}>}>;
}

/** The step's script as the workflow file holds it. */
function stepScript(): string {
  const workflow = parse(readFileSync(WORKFLOW, 'utf8')) as Workflow;
  const step = Object.values(workflow.jobs)
    .flatMap(definition => definition.steps)
    .find(candidate => candidate.name === STEP);
  if (step?.run === undefined) {
    throw new Error(`no step "${STEP}" in ${WORKFLOW}`);
  }
  return step.run;
}

/** Runs git in `folder` and returns its trimmed output; a failure throws. */
function runGit(folder: string, ...gitArguments: string[]): string {
  const result = spawnSync('git', gitArguments, {
    cwd: folder,
    env: GIT_ENVIRONMENT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`git ${gitArguments.join(' ')}: ${result.stderr}`);
  }
  return result.stdout.trim();
}

/** Writes `text` to `file` in `folder`, commits everything and returns the new commit. */
function commit(folder: string, file: string, text: string): string {
  mkdirSync(path.dirname(path.join(folder, file)), {recursive: true});
  writeFileSync(path.join(folder, file), text);
  runGit(folder, 'add', '--all');
  runGit(folder, 'commit', '--quiet', '--message', file);
  return runGit(folder, 'rev-parse', 'HEAD');
}

/**
 * Runs the step's script in `folder` for a pull request from `head` into `base`, with GitHub's default `bash -e`, and
 * gives its exit status and whether its output names `file` (stderr for a refusal, stdout's list for a pass).
 */
function check(folder: string, base: string, head: string, file = '') {
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-e', '-c', stepScript()],
    {
      cwd: folder,
      env: {...GIT_ENVIRONMENT, BASE: base, HEAD: head},
      encoding: 'utf8',
    },
  );
  const output = result.status === 0 ? result.stdout : result.stderr;
  return {status: result.status, names: file !== '' && output.includes(file)};
}

describe('suite-scope', () => {
  let folder = '';
  let main = '';

  beforeEach(() => {
    folder = mkdtempSync(path.join(os.tmpdir(), 'suite-scope-'));
    runGit(folder, 'init', '--quiet', '--initial-branch=main');
    commit(folder, 'x/b', 'outside\n');
    main = commit(folder, 'tests/conformance/suite/a.yaml', 'inside\n');
    runGit(
      folder,
      'switch',
      '--quiet',
      '--create',
      'suite/2026-10-14-0123456789ab',
    );
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('passes a change inside tests/conformance/', () => {
    const head = commit(folder, 'tests/conformance/suite/c.yaml', 'new\n');
    strictEqual(check(folder, main, head).status, 0);
  });

  it('refuses a path outside tests/conformance/, .github/ among them', () => {
    commit(folder, 'tests/conformance/suite/c.yaml', 'new\n');
    const head = commit(folder, '.github/workflows/x.yml', 'on: push\n');
    deepStrictEqual(check(folder, main, head, '.github/workflows/x.yml'), {
      status: 1,
      names: true,
    });
  });

  it('refuses a rename into tests/conformance/ from outside, by its source', () => {
    runGit(folder, 'mv', 'x/b', 'tests/conformance/suite/b');
    runGit(folder, 'commit', '--quiet', '--message', 'rename');
    const head = runGit(folder, 'rev-parse', 'HEAD');
    deepStrictEqual(check(folder, main, head, 'x/b'), {status: 1, names: true});
  });

  it('refuses a pull request that changes nothing', () => {
    deepStrictEqual(check(folder, main, main, 'changes nothing'), {
      status: 1,
      names: true,
    });
  });

  it('passes a branch cut before main gained an unrelated commit', () => {
    const head = commit(folder, 'tests/conformance/suite/c.yaml', 'new\n');
    runGit(folder, 'switch', '--quiet', 'main');
    const movedMain = commit(folder, 'README.md', 'an admin edit\n');
    deepStrictEqual(check(folder, movedMain, head, 'README.md'), {
      status: 0,
      names: false,
    });
  });

  it('refuses a head that shares no history with main', () => {
    runGit(folder, 'switch', '--quiet', '--orphan', 'unrelated');
    const head = commit(folder, 'tests/conformance/suite/c.yaml', 'new\n');
    notStrictEqual(check(folder, main, head).status, 0);
  });
});
