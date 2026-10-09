import {deepStrictEqual} from 'node:assert';
import {execFileSync} from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  installLauncher,
  launcherText,
  type LauncherFiles,
  nodeLauncherFiles,
} from '../../src/index.ts';

const PROGRAM = path.join(
  import.meta.dirname,
  '..',
  'fixtures',
  'print-arguments.ts',
);

describe('askpass launcher', () => {
  let folder: string;

  beforeEach(() => {
    folder = mkdtempSync(path.join(tmpdir(), 'launcher-'));
  });

  afterEach(() => {
    rmSync(folder, {recursive: true, force: true});
  });

  it('runs the program on the editor runtime as Node.js and passes the arguments on', () => {
    deepStrictEqual(
      launcherText('/Apps/Code Helper', "/x/it's askpass.js"),
      [
        '#!/bin/sh',
        `ELECTRON_RUN_AS_NODE=1 exec '/Apps/Code Helper' '/x/it'\\''s askpass.js' "$@"`,
        '',
      ].join('\n'),
    );
  });

  it('names the file by its text and writes it through the port', async () => {
    const written: Array<[string, string]> = [];
    const files: LauncherFiles = {
      writeExecutable: (file, text) => {
        written.push([file, text]);
        return Promise.resolve();
      },
    };
    const first = await installLauncher(files, '/run', '/bin/node', '/a.js');
    const second = await installLauncher(files, '/run', '/bin/node', '/b.js');
    deepStrictEqual(
      [
        written.map(([, text]) => text),
        first === second,
        /^\/run\/askpass-[0-9a-f]{16}\.sh$/.test(first),
      ],
      [
        [
          launcherText('/bin/node', '/a.js'),
          launcherText('/bin/node', '/b.js'),
        ],
        false,
        true,
      ],
    );
  });

  it('writes a file only the user can read, write or run, also over an older one', async () => {
    const file = path.join(folder, 'run', 'askpass.sh');
    await nodeLauncherFiles.writeExecutable(file, 'one');
    await nodeLauncherFiles.writeExecutable(file, 'two');
    deepStrictEqual(
      [readFileSync(file, 'utf8'), statSync(file).mode & 0o777],
      ['two', 0o700],
    );
  });

  it('resets the mode of a file that was loosened', async () => {
    const file = path.join(folder, 'askpass.sh');
    writeFileSync(file, 'one');
    chmodSync(file, 0o644);
    await nodeLauncherFiles.writeExecutable(file, 'two');
    deepStrictEqual(statSync(file).mode & 0o777, 0o700);
  });

  it('starts the program from a path with a space and hands it the question', async () => {
    const launcher = await installLauncher(
      nodeLauncherFiles,
      path.join(folder, 'with space'),
      process.execPath,
      PROGRAM,
    );
    deepStrictEqual(
      execFileSync(launcher, ["it's a question: "], {encoding: 'utf8'}),
      JSON.stringify(["it's a question: "]),
    );
  });
});
