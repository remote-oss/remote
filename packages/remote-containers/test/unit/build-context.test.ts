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
import {BOOTSTRAP_DOCKERFILE} from '../../src/volumes/bootstrap.ts';
import {writeBuildContext} from '../../src/volumes/build-context.ts';

describe('the bootstrap image’s build context (card containers-151)', () => {
  let scratch = '';

  beforeEach(async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'build-context-'));
    await mkdir(path.join(scratch, 'cli', 'lib'), {recursive: true});
    await writeFile(path.join(scratch, 'cli', 'lib', 'entry.js'), 'cli');
    await mkdir(path.join(scratch, 'temp'));
  });

  afterEach(() => rm(scratch, {recursive: true, force: true}));

  it('F-0704 BR-1: a fresh folder holds our Dockerfile and the bundled CLI, and is gone once disposed of', async () => {
    const context = await writeBuildContext(
      path.join(scratch, 'cli'),
      path.join(scratch, 'temp'),
    );
    const written = [
      await readFile(path.join(context.folder, 'Dockerfile'), 'utf8'),
      await readFile(
        path.join(context.folder, 'devcontainers-cli', 'lib', 'entry.js'),
        'utf8',
      ),
    ];
    await context.dispose();
    deepStrictEqual(
      [written, await readdir(path.join(scratch, 'temp'))],
      [[BOOTSTRAP_DOCKERFILE, 'cli'], []],
    );
  });

  it('a CLI folder that can’t be copied fails the write and leaves no folder behind', async () => {
    const failure = await writeBuildContext(
      path.join(scratch, 'absent'),
      path.join(scratch, 'temp'),
    ).then(
      () => 'written',
      (error: unknown) => (error as NodeJS.ErrnoException).code,
    );
    deepStrictEqual(
      [failure, await readdir(path.join(scratch, 'temp'))],
      ['ENOENT', []],
    );
  });
});
