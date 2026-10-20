import {deepStrictEqual, rejects} from 'node:assert';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {
  type LauncherProcess,
  nodeLauncherProcess,
  type ProcessSpawn,
  runTreeLeavingLauncher,
  type SpawnSpecification,
  spawnerOf,
  type StartedProcess,
} from '../../src/index.ts';

/** A started process that a row ends as it likes, counting its unrefs. */
class FakeProcess extends EventEmitter implements StartedProcess {
  unrefs = 0;

  unref(): void {
    this.unrefs += 1;
  }
}

/** One start a fake spawn saw. */
interface SeenStart {
  command: string;
  commandArguments: readonly string[];
  options: Parameters<ProcessSpawn>[2];
}

/** A spawn that hands out `child` and notes each start. */
function fakeSpawn(child: FakeProcess, seen: SeenStart[]): ProcessSpawn {
  return (command, commandArguments, options) => {
    seen.push({command, commandArguments, options});
    return child;
  };
}

const HELPER: SpawnSpecification = {
  command: '/editor/code',
  commandArguments: ['/ext/dist/helpers/x.js'],
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  environment: {ELECTRON_RUN_AS_NODE: '1'},
};

const LAUNCHED: SpawnSpecification = {
  ...HELPER,
  commandArguments: ['/ext/dist/helper-launcher.js', '/ext/dist/helpers/x.js'],
  waitForExit: true,
};

describe('the Node.js spawner', () => {
  it('starts the process detached, lets it go once it has started and resolves', async () => {
    const child = new FakeProcess();
    const seen: SeenStart[] = [];
    const started = spawnerOf(fakeSpawn(child, seen))(HELPER);
    child.emit('spawn');
    await started;
    deepStrictEqual(
      [seen, child.unrefs],
      [
        [
          {
            command: '/editor/code',
            commandArguments: ['/ext/dist/helpers/x.js'],
            options: {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              env: {ELECTRON_RUN_AS_NODE: '1'},
            },
          },
        ],
        1,
      ],
    );
  });

  it('rejects when the process cannot start', async () => {
    const child = new FakeProcess();
    const started = spawnerOf(fakeSpawn(child, []))(HELPER);
    child.emit('error', new Error('no such file'));
    await rejects(started, {message: 'no such file'});
  });

  it('resolves for a launcher that exits with 0, and only then', async () => {
    const child = new FakeProcess();
    let settled = false;
    const started = spawnerOf(fakeSpawn(child, []))(LAUNCHED).then(() => {
      settled = true;
    });
    child.emit('spawn');
    await Promise.resolve();
    const beforeExit = settled;
    child.emit('exit', 0);
    await started;
    deepStrictEqual([beforeExit, settled, child.unrefs], [false, true, 0]);
  });

  it('rejects for a launcher that exits otherwise', async () => {
    const child = new FakeProcess();
    const started = spawnerOf(fakeSpawn(child, []))(LAUNCHED);
    child.emit('exit', 1);
    await rejects(started, {message: 'the launcher exited with 1'});
  });

  it('rejects for a launcher that cannot start', async () => {
    const child = new FakeProcess();
    const started = spawnerOf(fakeSpawn(child, []))(LAUNCHED);
    child.emit('error', new Error('no such file'));
    await rejects(started, {message: 'no such file'});
  });
});

describe("the launcher that leaves the starter's tree", () => {
  /** A launcher process over a fake spawn, with the exit codes it gave. */
  function launcherOver(
    child: FakeProcess,
    argv: readonly string[],
  ): {launcher: LauncherProcess; seen: SeenStart[]; exits: number[]} {
    const seen: SeenStart[] = [];
    const exits: number[] = [];
    return {
      launcher: {
        argv,
        execPath: '/editor/code',
        environment: {
          ELECTRON_RUN_AS_NODE: '1',
          REMOTE_OSS_HELPER_PARAMETERS: '{}',
        },
        spawnProcess: fakeSpawn(child, seen),
        exit: code => {
          exits.push(code);
        },
      },
      seen,
      exits,
    };
  }

  it('starts the script on its own runtime, detached, with its environment, and exits 0 once it has started', () => {
    const child = new FakeProcess();
    const {launcher, seen, exits} = launcherOver(child, [
      '/editor/code',
      '/ext/dist/helper-launcher.js',
      '/ext/dist/helpers/x.js',
    ]);
    runTreeLeavingLauncher(launcher);
    const exitsBeforeSpawn = [...exits];
    child.emit('spawn');
    deepStrictEqual(
      [seen, exitsBeforeSpawn, exits, child.unrefs],
      [
        [
          {
            command: '/editor/code',
            commandArguments: ['/ext/dist/helpers/x.js'],
            options: {
              detached: true,
              stdio: 'ignore',
              windowsHide: true,
              env: {
                ELECTRON_RUN_AS_NODE: '1',
                REMOTE_OSS_HELPER_PARAMETERS: '{}',
              },
            },
          },
        ],
        [],
        [0],
        1,
      ],
    );
  });

  it('exits 1 when the helper cannot start', () => {
    const child = new FakeProcess();
    const {launcher, exits} = launcherOver(child, [
      '/editor/code',
      '/ext/dist/helper-launcher.js',
      '/ext/dist/helpers/x.js',
    ]);
    runTreeLeavingLauncher(launcher);
    child.emit('error', new Error('no such file'));
    deepStrictEqual(exits, [1]);
  });

  it('exits 1, starting nothing, when no script is named', () => {
    const child = new FakeProcess();
    const {launcher, seen, exits} = launcherOver(child, [
      '/editor/code',
      '/ext/dist/helper-launcher.js',
    ]);
    runTreeLeavingLauncher(launcher);
    deepStrictEqual([seen, exits], [[], [1]]);
  });

  it("is this process by default: its command line, runtime, environment and Node.js's spawn", () => {
    const launcher = nodeLauncherProcess();
    deepStrictEqual(
      [
        launcher.argv,
        launcher.execPath,
        launcher.environment,
        launcher.spawnProcess,
        typeof launcher.exit,
      ],
      [process.argv, process.execPath, process.env, spawn, 'function'],
    );
  });
});
