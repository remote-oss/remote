import {deepStrictEqual} from 'node:assert';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {writeBuildContext} from '../../src/volumes/build-context.ts';

describe('the bootstrap image’s build context (card containers-151)', () => {
  let scratch = '';

  /** The sources under the scratch folder, with `changes` in place of the named ones. */
  function sourcesOf(changes: Partial<Record<string, string>> = {}) {
    return {
      dockerfile: path.join(scratch, 'Dockerfile'),
      cliFolder: path.join(scratch, 'cli'),
      preload: path.join(scratch, 'preload.js'),
      ...changes,
    };
  }

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'build-context-'));
    await mkdir(path.join(scratch, 'cli', 'lib'), {recursive: true});
    await writeFile(path.join(scratch, 'cli', 'lib', 'entry.js'), 'cli');
    await writeFile(path.join(scratch, 'Dockerfile'), 'FROM x');
    await writeFile(path.join(scratch, 'preload.js'), 'preload');
    await mkdir(path.join(scratch, 'temp'));
  });

  afterEach(() => rm(scratch, {recursive: true, force: true}));

  it('F-0704 BR-1: a fresh folder holds the image’s definition, the bundled CLI and its preload, and is gone once disposed of', async () => {
    const context = await writeBuildContext(
      sourcesOf(),
      path.join(scratch, 'temp'),
    );
    const written = await Promise.all(
      [
        'Dockerfile',
        'cli-preload.js',
        path.join('devcontainers-cli', 'lib', 'entry.js'),
      ].map(file => readFile(path.join(context.folder, file), 'utf8')),
    );
    await context.dispose();
    deepStrictEqual(
      [written, await readdir(path.join(scratch, 'temp'))],
      [['FROM x', 'preload', 'cli'], []],
    );
  });

  it('a source that can’t be copied fails the write and leaves no folder behind', async () => {
    const failures = await Promise.all(
      [
        sourcesOf({cliFolder: path.join(scratch, 'absent')}),
        sourcesOf({preload: path.join(scratch, 'absent.js')}),
      ].map(sources =>
        writeBuildContext(sources, path.join(scratch, 'temp')).then(
          () => 'written',
          (error: unknown) => (error as NodeJS.ErrnoException).code,
        ),
      ),
    );
    deepStrictEqual(
      [failures, await readdir(path.join(scratch, 'temp'))],
      [['ENOENT', 'ENOENT'], []],
    );
  });
});
