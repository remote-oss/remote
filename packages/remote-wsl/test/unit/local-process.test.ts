import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  localFiles,
  localSession,
  localSpawner,
} from '../../src/process/local-process.ts';

/** Runs a Node script as a child, feeds it `input`, and collects what it gave back. */
async function runScript(
  script: string,
  input: string,
): Promise<{output: string; error: string; status: number | undefined}> {
  const child = await localSpawner({
    program: process.execPath,
    programArguments: ['-e', script],
    environment: {PATH: process.env.PATH ?? ''},
  });
  const output: Uint8Array[] = [];
  const error: Uint8Array[] = [];
  child.onOutput(chunk => output.push(chunk));
  child.onError(chunk => error.push(chunk));
  const status = new Promise<number | undefined>(resolve => {
    child.onExit(resolve);
  });
  await child.write(new TextEncoder().encode(input));
  child.endInput();
  return {
    status: await status,
    output: Buffer.concat(output).toString(),
    error: Buffer.concat(error).toString(),
  };
}

describe('the local process, file and session ports (wsl.package)', () => {
  it('starts a program with its arguments, hands it its input, and gives its output, its errors and its exit status', async () => {
    deepStrictEqual(
      await runScript(
        "process.stdin.pipe(process.stdout); process.stderr.write('warn'); process.stdin.on('end', () => process.exit(3));",
        'given',
      ),
      {output: 'given', error: 'warn', status: 3},
    );
  });

  it('rejects with the system code for a program that does not exist, and a killed process ends with no status', async () => {
    const missing = await localSpawner({
      program: path.join(tmpdir(), 'no-such-program-here'),
      programArguments: [],
      environment: {},
    }).then(
      () => 'started',
      (caught: unknown) => (caught as {code?: string}).code,
    );
    const child = await localSpawner({
      program: process.execPath,
      programArguments: ['-e', 'setInterval(() => {}, 1000)'],
      environment: {},
    });
    const status = new Promise<number | undefined>(resolve => {
      child.onExit(resolve);
    });
    child.kill();
    deepStrictEqual([missing, await status], ['ENOENT', undefined]);
  });

  it('a write to a process whose input is closed rejects', async () => {
    const child = await localSpawner({
      program: process.execPath,
      programArguments: [
        '-e',
        'process.stdin.destroy(); setTimeout(() => {}, 200)',
      ],
      environment: {},
    });
    child.endInput();
    const outcome = await child.write(new Uint8Array([1])).then(
      () => 'written',
      () => 'rejected',
    );
    child.kill();
    deepStrictEqual(outcome, 'rejected');
  });

  it('reads a local file and tells whether one exists', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'wsl-files-'));
    try {
      const file = path.join(folder, 'wsl.exe');
      writeFileSync(file, 'bytes');
      const chunks: Uint8Array[] = [];
      for await (const chunk of localFiles.read(file)) {
        chunks.push(chunk);
      }
      deepStrictEqual(
        [
          await localFiles.exists(file),
          await localFiles.exists(path.join(folder, 'other')),
          Buffer.concat(chunks).toString(),
        ],
        [true, false, 'bytes'],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('takes the session from the environment, leaving out unset variables', () => {
    deepStrictEqual(
      [
        localSession({SystemRoot: 'C:\\Windows', PATH: 'p', UNSET: undefined}),
        localSession({PATH: 'p'}).systemRoot,
      ],
      [
        {
          systemRoot: 'C:\\Windows',
          environment: {SystemRoot: 'C:\\Windows', PATH: 'p'},
        },
        undefined,
      ],
    );
  });
});
