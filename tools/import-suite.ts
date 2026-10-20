/**
 * @fileoverview import-suite: imports a conformance suite from one branch of a staging repository into its target
 * repository, as a pull request.
 *
 *     node tools/import-suite.ts <staging owner/name> suite/<YYYY-MM-DD>-<sha12> <target owner/name>
 *
 * It reads that one branch and nothing else of the staging repository. The branch's commit must hold files under
 * tests/conformance/ only, and its subject must name the target repository and the branch's digest; anything else is
 * refused, never filtered, so a scope breach shows. The suite replaces the target repository's tests/conformance on a
 * branch suite-import/<date>-<sha12>, which the required check's own script (.github/workflows/suite-scope.yml) checks
 * before anything is pushed; the pull request's body names the staging branch, its commit and both results.
 */

import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parse} from 'yaml';
import {
  checked,
  type CommandResult,
  type CommandRunner,
  runCommand,
} from './command-runner.ts';
import {isMainModule, messageOf, REPOSITORY_ROOT} from './repository.ts';

/** A suite branch of the staging repository: its date and the first twelve hex of the suite's digest. */
const SUITE_BRANCH = /^suite\/(\d{4}-\d{2}-\d{2})-([0-9a-f]{12})$/;

/** A repository as owner/name. */
const REPOSITORY = /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/;

/** The subject the staging branch's commit carries: the suite's digest, the target repository, the features. */
const SUBJECT = /^Conformance suite ([0-9a-f]{12}) for (\S+): /;

/** The folder a suite lives in, in both repositories. */
const SUITE_FOLDER = 'tests/conformance';

/** The required check's step whose script is run on the import before it is pushed. */
const SCOPE_STEP = 'Every changed path is under tests/conformance/';

/** The required check of a target repository's pull requests. */
const SCOPE_WORKFLOW = path.join(
  REPOSITORY_ROOT,
  '.github',
  'workflows',
  'suite-scope.yml',
);

/** One import: where the suite comes from, where it goes, and the branch's date and digest. */
export interface ImportRequest {
  staging: string;
  branch: string;
  target: string;
  date: string;
  digest: string;
}

/** Why an import does not go on: it is refused, and nothing has been pushed. */
export class ImportRefusal extends Error {}

/** The import the arguments ask for; a refusal names the argument that is wrong. */
export function importRequestOf(
  programArguments: readonly string[],
): ImportRequest {
  const [staging = '', branch = '', target = ''] = programArguments;
  if (programArguments.length !== 3) {
    throw new ImportRefusal(
      'usage: import-suite <staging owner/name> suite/<YYYY-MM-DD>-<sha12> <target owner/name>',
    );
  }
  const match = SUITE_BRANCH.exec(branch);
  if (match === null) {
    throw new ImportRefusal(
      `${branch} is not a suite/<YYYY-MM-DD>-<sha12> branch`,
    );
  }
  for (const repository of [staging, target]) {
    if (!REPOSITORY.test(repository)) {
      throw new ImportRefusal(`${repository} is not an owner/name repository`);
    }
  }
  // Repository names ignore case on GitHub: both checks compare them folded.
  if (staging.toLowerCase().endsWith('-dirty')) {
    throw new ImportRefusal(
      `${staging} is a -dirty repository, which this side never reads`,
    );
  }
  if (staging.toLowerCase() === target.toLowerCase()) {
    throw new ImportRefusal(
      `the staging repository ${staging} is the target repository`,
    );
  }
  const [, date = '', digest = ''] = match;
  return {staging, branch, target, date, digest};
}

/** The modes a suite's entries may have: a file or an executable file; never a link or another repository. */
const FILE_MODES = new Set(['100644', '100755']);

/** One entry of `git ls-tree -r`: its mode and its path. */
export interface TreeEntry {
  mode: string;
  path: string;
}

/** The entries of `git ls-tree -r` output: `<mode> <type> <object>\t<path>` per line. */
export function treeEntriesOf(text: string): TreeEntry[] {
  return linesOf(text).map(line => {
    const [head = '', ...rest] = line.split('\t');
    const [mode = ''] = head.split(' ');
    return {mode, path: rest.join('\t')};
  });
}

/** A refusal unless every entry is a plain or executable file: a symbolic link or a submodule is refused by name. */
export function checkSuiteModes(entries: readonly TreeEntry[]): void {
  const others = entries.filter(entry => !FILE_MODES.has(entry.mode));
  if (others.length > 0) {
    throw new ImportRefusal(
      `the branch holds entries that are not files: ${others.map(entry => `${entry.path} (${entry.mode})`).join(', ')}`,
    );
  }
}

/** A refusal unless every path lies under tests/conformance/ and there is at least one. */
export function checkSuitePaths(paths: readonly string[]): void {
  if (paths.length === 0) {
    throw new ImportRefusal('the branch holds no files');
  }
  const outside = paths.filter(file => !file.startsWith(`${SUITE_FOLDER}/`));
  if (outside.length > 0) {
    throw new ImportRefusal(
      `the branch holds paths outside ${SUITE_FOLDER}/: ${outside.join(', ')}`,
    );
  }
}

/** A refusal unless the commit's subject names this target repository and the branch's digest. */
export function checkSubject(subject: string, request: ImportRequest): void {
  const match = SUBJECT.exec(subject);
  if (match === null) {
    throw new ImportRefusal(
      `the commit's subject is not "Conformance suite <sha12> for <owner/name>: ...": ${subject}`,
    );
  }
  const [, digest = '', repository = ''] = match;
  if (repository !== request.target) {
    throw new ImportRefusal(
      `the suite is for ${repository}, not ${request.target}`,
    );
  }
  if (digest !== request.digest) {
    throw new ImportRefusal(
      `the commit names the suite ${digest}, the branch ${request.digest}`,
    );
  }
}

interface Workflow {
  jobs?: Record<string, {steps?: Array<{name?: string; run?: string}>}>;
}

/** The script of the required check's step, from the workflow file's text. */
export function scopeScript(workflowText: string): string {
  const workflow = parse(workflowText) as Workflow;
  const step = Object.values(workflow.jobs ?? {})
    .flatMap(definition => definition.steps ?? [])
    .find(candidate => candidate.name === SCOPE_STEP);
  if (step?.run === undefined) {
    throw new Error(`the suite-scope workflow has no step "${SCOPE_STEP}"`);
  }
  return step.run;
}

/** Runs the required check's script in `folder` on the changes from `base` to `head`, as its workflow runs it. */
export function runScopeCheck(
  command: CommandRunner,
  folder: string,
  base: string,
  head: string,
  workflowText: string,
): CommandResult {
  return command('env', [
    '-C',
    folder,
    `BASE=${base}`,
    `HEAD=${head}`,
    'bash',
    '-e',
    '-c',
    scopeScript(workflowText),
  ]);
}

/** The pull request's body: the staging branch, its commit, the suite's size and the check's result. */
export function pullRequestBody(
  request: ImportRequest,
  commit: string,
  fileCount: number,
  changedCount: number,
): string {
  return [
    `The conformance suite of one staging branch, imported by \`tools/import-suite.ts\` of remote-oss/remote.`,
    '',
    `- **Staging repository:** \`${request.staging}\``,
    `- **Branch:** \`${request.branch}\`, at commit \`${commit}\``,
    `- **Files:** ${String(fileCount)}, every one under \`${SUITE_FOLDER}/\``,
    `- **suite-scope:** passed on this branch before it was pushed, with ${String(changedCount)} changed path(s)`,
    '',
    'Only that branch of the staging repository was read.',
  ].join('\n');
}

/** The lines of a command's output, without empty ones. */
function linesOf(text: string): string[] {
  return text.split('\n').filter(line => line !== '');
}

/** A repository's address for git, over HTTPS. */
function addressOf(repository: string): string {
  return `https://github.com/${repository}.git`;
}

/**
 * Imports the suite of `request` in the scratch `folder`: fetches the branch, checks its paths and subject, replaces
 * the target repository's suite on a branch of its own, runs the required check's script on it, pushes and opens
 * the pull request. Returns the pull request's address, or undefined when the target repository's main already holds
 * the suite.
 */
export function importSuite(
  request: ImportRequest,
  command: CommandRunner,
  folder: string,
  workflowText: string,
): string | undefined {
  /** Runs git and returns its trimmed output; a failure throws. */
  function runGit(...gitArguments: string[]): string {
    return checked(command, 'git', gitArguments).trim();
  }
  const staging = path.join(folder, 'staging');
  const clone = path.join(folder, 'target');
  const branchRef = `refs/heads/${request.branch}`;
  runGit('init', '-q', staging);
  runGit(
    '-C',
    staging,
    'fetch',
    '-q',
    '--depth=1',
    addressOf(request.staging),
    branchRef,
  );
  const commit = runGit('-C', staging, 'rev-parse', 'FETCH_HEAD');
  const entries = treeEntriesOf(
    runGit('-C', staging, 'ls-tree', '-r', 'FETCH_HEAD'),
  );
  checkSuitePaths(entries.map(entry => entry.path));
  checkSuiteModes(entries);
  checkSubject(
    runGit('-C', staging, 'log', '-1', '--format=%s', 'FETCH_HEAD'),
    request,
  );
  runGit('clone', '-q', '--depth=1', addressOf(request.target), clone);
  const base = runGit('-C', clone, 'rev-parse', 'HEAD');
  runGit(
    '-C',
    clone,
    'fetch',
    '-q',
    '--depth=1',
    addressOf(request.staging),
    branchRef,
  );
  const fetchedAgain = runGit('-C', clone, 'rev-parse', 'FETCH_HEAD');
  if (fetchedAgain !== commit) {
    throw new ImportRefusal(
      `the branch moved while it was imported (${commit}, then ${fetchedAgain})`,
    );
  }
  runGit('-C', clone, 'rm', '-r', '-q', '--ignore-unmatch', SUITE_FOLDER);
  runGit('-C', clone, 'checkout', commit, '--', SUITE_FOLDER);
  if (runGit('-C', clone, 'status', '--porcelain', '--', SUITE_FOLDER) === '') {
    return undefined;
  }
  const importBranch = `suite-import/${request.date}-${request.digest}`;
  runGit('-C', clone, 'checkout', '-q', '-b', importBranch);
  runGit(
    '-C',
    clone,
    'commit',
    '-q',
    '-m',
    `tests/conformance: the suite from ${request.staging}@${request.branch} (${commit})`,
  );
  const head = runGit('-C', clone, 'rev-parse', 'HEAD');
  const scope = runScopeCheck(command, clone, base, head, workflowText);
  if (scope.status !== 0) {
    throw new ImportRefusal(
      `suite-scope: ${(scope.stderr.trim() || scope.stdout.trim()).replaceAll('\n', ' ')}`,
    );
  }
  const changed = linesOf(
    runGit(
      '-C',
      clone,
      'diff',
      '--no-renames',
      '--name-only',
      `${base}...${head}`,
    ),
  );
  runGit(
    '-C',
    clone,
    'push',
    '-q',
    addressOf(request.target),
    `HEAD:refs/heads/${importBranch}`,
  );
  return checked(command, 'gh', [
    'pr',
    'create',
    '-R',
    request.target,
    '--base',
    'main',
    '--head',
    importBranch,
    '--title',
    `tests/conformance: the suite of ${request.branch}`,
    '--body',
    pullRequestBody(request, commit, entries.length, changed.length),
  ]).trim();
}

/** The program: one line of result, and its exit code (0 done, 2 refused, 1 failed). */
export function runImport(
  programArguments: readonly string[],
  command: CommandRunner,
  report: (line: string) => void,
  workflowText: () => string = () => readFileSync(SCOPE_WORKFLOW, 'utf8'),
): number {
  let folder: string | undefined;
  let exitCode = 0;
  try {
    const request = importRequestOf(programArguments);
    folder = mkdtempSync(path.join(os.tmpdir(), 'import-suite-'));
    const address = importSuite(request, command, folder, workflowText());
    report(
      address ??
        `import-suite: ${request.target}'s main already holds the suite of ${request.branch}; nothing pushed`,
    );
  } catch (caught) {
    const refused = caught instanceof ImportRefusal;
    report(`import-suite: ${refused ? 'refused: ' : ''}${messageOf(caught)}`);
    exitCode = refused ? 2 : 1;
  }
  if (folder !== undefined) {
    rmSync(folder, {recursive: true, force: true});
  }
  return exitCode;
}

if (isMainModule(import.meta.url)) {
  process.exitCode = runImport(process.argv.slice(2), runCommand, line => {
    console.log(line);
  });
}
