import {deepStrictEqual} from 'node:assert';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  localChannel,
  type HostChannel,
  type ScriptOutcome,
  type ScriptRequest,
} from '../../src/index.ts';

const LINUX = {identity: 'this-machine', platform: 'linux'} as const;

/** The folder of a row, removed by the suite. */
let folder = '';

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'lib-host-local-unit-'));
});

afterEach(() => {
  rmSync(folder, {recursive: true, force: true});
});

/** A request to run `script`, with the changes `changes` makes to it. */
function requestOf(
  script: string,
  changes: Partial<ScriptRequest> = {},
): ScriptRequest {
  return {
    script,
    interpreter: 'posixShell',
    environment: {},
    input: {kind: 'text', text: ''},
    cancellation: new AbortController().signal,
    ...changes,
  };
}

/** The lines `script` printed and how it ended. */
async function ranWith(
  channel: HostChannel,
  request: ScriptRequest,
): Promise<{lines: string[]; outcome: ScriptOutcome}> {
  const lines: string[] = [];
  const outcome = await channel.runScript(request, line => {
    lines.push(line);
  });
  return {lines, outcome};
}

describe('the channel of the local machine (card #3158)', () => {
  it('runs a PowerShell script as a failure to spawn that says this host runs POSIX scripts only', async () => {
    deepStrictEqual(
      (
        await ranWith(
          localChannel(LINUX),
          requestOf('Write-Output 1', {interpreter: 'powershell'}),
        )
      ).outcome,
      {
        kind: 'failed',
        failure: {
          kind: 'spawnFailed',
          detail: 'this host runs POSIX scripts only',
        },
      },
    );
  });

  it('names the identity it was given, and the platform hint of linux, macOS and any other system', () => {
    deepStrictEqual(
      [
        localChannel(LINUX).identity(),
        ...(['linux', 'darwin', 'win32', 'freebsd'] as const).map(platform =>
          localChannel({identity: 'x', platform}).platformHint(),
        ),
      ],
      ['this-machine', 'linux', 'macOS', 'unknown', 'unknown'],
    );
  });

  it('gives the lines of the standard output and of the standard error in the order they were written, a last line with no line break, and no carriage return', async () => {
    const script = [
      "printf 'one\\n'",
      "printf 'two\\n' >&2",
      "printf 'three\\r\\n'",
      "printf 'four' >&2",
    ].join('\n');
    deepStrictEqual(await ranWith(localChannel(LINUX), requestOf(script)), {
      lines: ['one', 'two', 'three', 'four'],
      outcome: {kind: 'exited', status: 0},
    });
  });

  it('adds the request’s environment to this process’s own, and the request’s value wins', async () => {
    deepStrictEqual(
      (
        await ranWith(
          localChannel(LINUX),
          requestOf('printf "%s %s\\n" "$ROW_ONLY" "$HOME"', {
            environment: {ROW_ONLY: 'set', HOME: '/row/home'},
          }),
        )
      ).lines,
      ['set /row/home'],
    );
  });

  it('gives the script this process’s own environment too', async () => {
    process.env.LIB_HOST_LOCAL_ROW = 'inherited';
    try {
      deepStrictEqual(
        (
          await ranWith(
            localChannel(LINUX),
            requestOf('printf "%s\\n" "$LIB_HOST_LOCAL_ROW"'),
          )
        ).lines,
        ['inherited'],
      );
    } finally {
      delete process.env.LIB_HOST_LOCAL_ROW;
    }
  });

  it('gives a script that ends on a signal the status of 128 plus its number', async () => {
    deepStrictEqual(
      (await ranWith(localChannel(LINUX), requestOf('kill -TERM $$'))).outcome,
      {kind: 'exited', status: 143},
    );
  });

  it('gives a shell that cannot start as a failure to spawn, with the system’s message', async () => {
    const {outcome} = await ranWith(
      localChannel({...LINUX, shell: path.join(folder, 'no-such-shell')}),
      requestOf('exit 0'),
    );
    deepStrictEqual(
      outcome.kind === 'failed' && [
        outcome.failure.kind,
        outcome.failure.detail.includes('ENOENT'),
      ],
      ['spawnFailed', true],
    );
  });

  it('goes on when the script ends before it has read all its input', async () => {
    deepStrictEqual(
      await ranWith(
        localChannel(LINUX),
        requestOf('exit 0', {
          input: {kind: 'text', text: 'x'.repeat(8 * 1024 * 1024)},
        }),
      ),
      {lines: [], outcome: {kind: 'exited', status: 0}},
    );
  });

  it('kills the whole process group of a cancelled script, so its children do not outlive it', async () => {
    const pidFile = path.join(folder, 'child.pid');
    const controller = new AbortController();
    const running = ranWith(
      localChannel(LINUX),
      requestOf(`sleep 30 & echo $! > '${pidFile}'; echo started; wait`, {
        cancellation: controller.signal,
      }),
    );
    await new Promise<void>(resolve => {
      const poll = setInterval(() => {
        if (
          existsSync(pidFile) &&
          readFileSync(pidFile, 'utf8').trim() !== ''
        ) {
          clearInterval(poll);
          resolve();
        }
      }, 10);
    });
    controller.abort();
    const {outcome} = await running;
    const child = readFileSync(pidFile, 'utf8').trim();
    await new Promise(resolve => setTimeout(resolve, 100));
    const state = spawnSync('ps', ['-o', 'stat=', '-p', child], {
      encoding: 'utf8',
    }).stdout.trim();
    // A process that has ended and waits to be reaped counts as gone.
    const alive = state !== '' && !state.startsWith('Z');
    deepStrictEqual(
      [outcome.kind === 'failed' && outcome.failure.kind, alive],
      ['cancelled', false],
    );
  });

  it('copies nothing from a file that is not there, and says why', async () => {
    const outcome = await localChannel(LINUX).copyToHost({
      localFile: path.join(folder, 'missing.tar.gz'),
      remotePath: path.join(folder, 'copy.tar.gz'),
      cancellation: new AbortController().signal,
    });
    deepStrictEqual(
      outcome.kind === 'failed' && [
        outcome.failure.kind,
        outcome.failure.detail.includes('ENOENT'),
      ],
      ['copyFailed', true],
    );
  });

  it('ends a copy cancelled while it runs as cancelled', async () => {
    const controller = new AbortController();
    const copying = localChannel(LINUX).copyToHost({
      localFile: '/dev/zero',
      remotePath: path.join(folder, 'copy'),
      cancellation: controller.signal,
    });
    setTimeout(() => {
      controller.abort();
    }, 20);
    const outcome = await copying;
    deepStrictEqual(
      outcome.kind === 'failed' && outcome.failure.kind,
      'cancelled',
    );
  });

  it('copies the bytes of the file to the path', async () => {
    const source = path.join(folder, 'source.bin');
    writeFileSync(source, Uint8Array.from([0, 1, 2, 255]));
    mkdirSync(path.join(folder, 'in'));
    const target = path.join(folder, 'in', 'copy.bin');
    const outcome = await localChannel(LINUX).copyToHost({
      localFile: source,
      remotePath: target,
      cancellation: new AbortController().signal,
    });
    deepStrictEqual(
      [outcome, [...readFileSync(target)]],
      [{kind: 'copied'}, [0, 1, 2, 255]],
    );
  });
});
