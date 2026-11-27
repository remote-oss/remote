import {deepStrictEqual} from 'node:assert';
import {execFile, spawn} from 'node:child_process';
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
  this.timeout(10000);

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
    const outcome = [alive(shellId), alive(childId), detached.some(alive)];
    for (const processId of detached) {
      process.kill(processId);
    }
    deepStrictEqual(outcome, [false, false, true]);
  });

  it('ends a process with no children, and does nothing for one that is gone', async () => {
    const lone = spawn('sleep', ['40']);
    const loneId = lone.pid ?? 0;
    await treeKill(loneId);
    await treeKill(loneId);
    deepStrictEqual(alive(loneId), false);
  });
});
