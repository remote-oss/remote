import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  isPackagedSource,
  packagedSources,
  staleProblem,
  staleRefusal,
} from './acceptance-stale.ts';

/** Writes `text` to `file` under `root`, making its folders, with the change time `seconds` after the epoch. */
function written(
  root: string,
  file: string,
  seconds: number,
  text = 'x',
): string {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), {recursive: true});
  writeFileSync(full, text);
  utimesSync(full, seconds, seconds);
  return full;
}

/** Runs git in `root`. */
function gitIn(root: string, ...programArguments: string[]): void {
  execFileSync('git', programArguments, {cwd: root, stdio: 'ignore'});
}

describe('a run refuses packaged extensions older than their sources', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'acceptance-stale-'));
    gitIn(root, 'init', '-q');
    writeFileSync(path.join(root, '.gitignore'), 'dist/\n*.generated.ts\n');
  });

  afterEach(() => {
    rmSync(root, {recursive: true, force: true});
  });

  it('a package’s sources count, and its tests and coverage records do not', () => {
    deepStrictEqual(
      [
        'packages/remote-ssh/src/extension.ts',
        'packages/remote-ssh/package.json',
        'packages/remote-ssh/test/unit/extension.test.ts',
        'packages/remote-ssh/coverage.json',
        'tools/acceptance.ts',
      ].map(isPackagedSource),
      [true, true, false, false, false],
    );
  });

  it('the sources are the tracked and the new files that git would track, with their times; ignored, deleted and test files are left out', () => {
    written(root, 'packages/lib/src/tracked.ts', 1000);
    written(root, 'packages/lib/src/gone.ts', 1000);
    gitIn(root, 'add', '.');
    written(root, 'packages/lib/src/new.ts', 2000);
    written(root, 'packages/lib/src/table.generated.ts', 9000);
    written(root, 'packages/lib/test/unit/tracked.test.ts', 9000);
    written(root, 'tools/elsewhere.ts', 9000);
    rmSync(path.join(root, 'packages/lib/src/gone.ts'));
    deepStrictEqual(
      packagedSources(root).sort((left, right) =>
        left.file.localeCompare(right.file),
      ),
      [
        {
          file: path.join(root, 'packages/lib/src/new.ts'),
          changedAt: 2_000_000,
        },
        {
          file: path.join(root, 'packages/lib/src/tracked.ts'),
          changedAt: 1_000_000,
        },
      ],
    );
  });

  it('a VSIX older than the newest source is refused, named with that source', () => {
    deepStrictEqual(
      staleProblem(
        [
          {file: 'dist/remote-ssh-0.1.0.vsix', changedAt: 3000},
          {file: 'dist/remote-containers-0.1.0.vsix', changedAt: 1500},
        ],
        [
          {file: 'packages/lib/src/older.ts', changedAt: 1000},
          {file: 'packages/lib/src/newer.ts', changedAt: 2000},
        ],
      ),
      'dist/remote-containers-0.1.0.vsix is older than packages/lib/src/newer.ts: run `pnpm package` first ' +
        '(`pnpm test:acceptance:vscodium` packages before it runs)',
    );
  });

  it('VSIX files newer than every source, no VSIX, or no source are no refusal', () => {
    const sources = [{file: 'packages/lib/src/one.ts', changedAt: 1000}];
    deepStrictEqual(
      [
        staleProblem([{file: 'dist/a-0.1.0.vsix', changedAt: 1000}], sources),
        staleProblem([], sources),
        staleProblem([{file: 'dist/a-0.1.0.vsix', changedAt: 1}], []),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('a checkout with a source changed after packaging refuses its run, and packaging again clears it', () => {
    written(root, 'packages/lib/src/one.ts', 1000);
    gitIn(root, 'add', '.');
    const vsix = written(root, 'dist/lib-0.1.0.vsix', 2000);
    const before = staleRefusal(root, [vsix]);
    written(root, 'packages/lib/src/one.ts', 3000, 'changed');
    const after = staleRefusal(root, [vsix]);
    written(root, 'dist/lib-0.1.0.vsix', 4000);
    deepStrictEqual(
      [before, after, staleRefusal(root, [vsix])],
      [
        undefined,
        'dist/lib-0.1.0.vsix is older than packages/lib/src/one.ts: run `pnpm package` first ' +
          '(`pnpm test:acceptance:vscodium` packages before it runs)',
        undefined,
      ],
    );
  });
});
