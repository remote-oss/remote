import {deepStrictEqual} from 'node:assert';
import {type ChildProcess, execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {
  BoundedLines,
  LONGEST_PENDING_LINE,
  TREE_KILL_SCRIPT,
} from '../../src/index.ts';

const runFile = promisify(execFile);

/** The lines `pieces` give, pushed in order and flushed. */
function linesOf(...pieces: string[]): string[] {
  const told: string[] = [];
  const lines = new BoundedLines(line => told.push(line));
  for (const piece of pieces) {
    lines.push(piece);
  }
  lines.flush();
  return told;
}

/** Whether the child `child` of this process has ended, waiting for its exit for up to 2 s. */
function endedWithin(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      resolve(false);
    }, 2000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Whether the process `processId`, not a child of this one, has gone, polling for up to 2 s. */
async function goneWithin(processId: number): Promise<boolean> {
  for (let tries = 0; tries < 40 && alive(processId); tries += 1) {
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return !alive(processId);
}

/** Whether the process `processId` is running. */
function alive(processId: number): boolean {
  try {
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

/** Runs the tree-kill script under `sh` for `processId`, resolving when it ends. */
async function treeKill(processId: number): Promise<void> {
  await runFile('sh', ['-c', TREE_KILL_SCRIPT, 'tree-kill', String(processId)]);
}

describe('the lines of a channel', () => {
  it('tells each line without its end, a CR LF end read as one, across pieces, and the last line with no end', () => {
    deepStrictEqual(linesOf('one\r\ntw', 'o\n', '\nthree\r'), [
      'one',
      'two',
      '',
      'three',
    ]);
  });

  it('tells nothing for no output', () => {
    deepStrictEqual(linesOf(), []);
  });

  it('cuts a pending line at the bound as it grows, before any line end or flush, and keeps all of it', () => {
    const told: number[] = [];
    const lines = new BoundedLines(line => told.push(line.length));
    lines.push('x'.repeat(LONGEST_PENDING_LINE));
    const atTheBound = [...told];
    lines.push('x'.repeat(LONGEST_PENDING_LINE + 10));
    const pastIt = [...told];
    lines.flush();
    deepStrictEqual(
      [atTheBound, pastIt, told],
      [
        [],
        [LONGEST_PENDING_LINE, LONGEST_PENDING_LINE],
        [LONGEST_PENDING_LINE, LONGEST_PENDING_LINE, 10],
      ],
    );
  });

  it('cuts a whole line longer than the bound into parts too', () => {
    deepStrictEqual(
      linesOf(`${'y'.repeat(LONGEST_PENDING_LINE + 1)}\nend`).map(
        line => line.length,
      ),
      [LONGEST_PENDING_LINE, 1, 3],
    );
  });
});

describe('the tree-kill script', function () {
  this.timeout(15000);

  it('ends a shell and the child it backgrounded, and leaves a process that left the tree', async () => {
    const shell = spawn('sh', [
      '-c',
      'sleep 40 & printf "%s\\n" "$!"; (sleep 40 >/dev/null 2>&1 &); sleep 40',
    ]);
    const childId = await new Promise<number>(resolve => {
      shell.stdout.once('data', (data: Buffer) => {
        resolve(Number(String(data).trim()));
      });
    });
    await new Promise(resolve => setTimeout(resolve, 200));
    const shellId = shell.pid ?? 0;
    const {stdout: table} = await runFile('ps', [
      '-A',
      '-o',
      'pid=',
      '-o',
      'ppid=',
      '-o',
      'args=',
    ]);
    const detached = table
      .split('\n')
      .map(entry => entry.trim().split(/\s+/u))
      .filter(
        entry => entry[1] === '1' && entry.slice(2).join(' ') === 'sleep 40',
      )
      .map(entry => Number(entry[0]));
    await treeKill(shellId);
    const outcome = [
      await endedWithin(shell),
      await goneWithin(childId),
      detached.some(alive),
    ];
    for (const processId of detached) {
      process.kill(processId);
    }
    deepStrictEqual(outcome, [true, true, true]);
  });

  it('ends a grandchild of the process, not only its children', async () => {
    const shell = spawn('sh', [
      '-c',
      'sh -c \'sleep 40 & printf "%s\\n" "$!"; wait\' & wait',
    ]);
    const grandchildId = await new Promise<number>(resolve => {
      shell.stdout.once('data', (data: Buffer) => {
        resolve(Number(String(data).trim()));
      });
    });
    await treeKill(shell.pid ?? 0);
    deepStrictEqual(
      [await endedWithin(shell), await goneWithin(grandchildId)],
      [true, true],
    );
  });

  it('kills a process that ignores TERM once the wait for it has passed', async () => {
    const stubborn = spawn('sh', [
      '-c',
      'trap "" TERM; printf "ready\\n"; sleep 40',
    ]);
    await new Promise(resolve => {
      stubborn.stdout.once('data', resolve);
    });
    const started = Date.now();
    await treeKill(stubborn.pid ?? 0);
    deepStrictEqual(
      [await endedWithin(stubborn), Date.now() - started >= 4500],
      [true, true],
    );
  });

  it('ends a process with no children, and does nothing for one that is gone', async () => {
    const lone = spawn('sleep', ['40']);
    const loneId = lone.pid ?? 0;
    await treeKill(loneId);
    await treeKill(loneId);
    deepStrictEqual(await endedWithin(lone), true);
  });
});
