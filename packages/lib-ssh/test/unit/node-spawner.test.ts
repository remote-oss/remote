import {deepStrictEqual} from 'node:assert';
import {createNodeProcessSpawner} from '../../src/process/node-spawner.ts';
import type {GroupSystem} from '../../src/process/process-group.ts';

/** A system for a client of `posix` kind that records what it was asked to end and does nothing about it. */
function recording(posix: boolean): {system: GroupSystem; done: string[]} {
  const done: string[] = [];
  return {
    done,
    system: {
      posix,
      signalGroup: (leader, signal) =>
        done.push(`${signal} -${String(leader)}`),
      killTree: leader => done.push(`tree ${String(leader)}`),
      later: () => undefined,
    },
  };
}

const IDLE = {
  program: process.execPath,
  programArguments: ['-e', 'setTimeout(() => undefined, 30000)'],
  environment: {},
};

describe('the Node.js process spawner over a system that ends groups and trees (#2664)', () => {
  it('on Windows a kill ends the process tree while the client runs, and does not kill the client first', async () => {
    const made = recording(false);
    const handle = await createNodeProcessSpawner(made.system)(IDLE);
    let exited = false;
    handle.onExit(() => {
      exited = true;
    });
    handle.kill();
    const [call = ''] = made.done;
    const processId = Number(call.replace('tree ', ''));
    // The fake system ended nothing, so the client is still there unless the spawner killed it itself.
    await new Promise(resolve => setTimeout(resolve, 300));
    process.kill(processId, 'SIGKILL');
    deepStrictEqual(
      [made.done.length, call.startsWith('tree '), exited],
      [1, true, false],
    );
  });

  /** Runs a client that exits at once over `system`, and waits for its exit to be reported. */
  async function exitedUnder(system: GroupSystem): Promise<void> {
    const handle = await createNodeProcessSpawner(system)({
      ...IDLE,
      programArguments: ['-e', 'process.exit(0)'],
    });
    await new Promise<void>(resolve => {
      handle.onExit(() => {
        resolve();
      });
    });
  }

  it('on Windows the exit of a client ends nothing, as its process id may be another process’s by then', async () => {
    const made = recording(false);
    await exitedUnder(made.system);
    deepStrictEqual(made.done, []);
  });

  it('on POSIX the exit of a client ends its group, SIGTERM first', async () => {
    const made = recording(true);
    await exitedUnder(made.system);
    deepStrictEqual(
      made.done.map(each => each.split(' ')[0]),
      ['SIGTERM'],
    );
  });
});
