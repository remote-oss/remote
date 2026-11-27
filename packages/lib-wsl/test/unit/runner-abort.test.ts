import {deepStrictEqual} from 'node:assert/strict';
import {createWslRunner, type WslRunner} from '../../src/runner.ts';
import {fakeWsl} from '../../src/testing/fake-wsl.ts';

interface Outcome {
  kind: string;
  failure?: {kind: string};
}

type Where = 'locating' | 'starting';

/** A runner over a fake that aborts `controller` when it looks for a file (`locating`) or spawns a process (`starting`). */
function abortingRunner(
  where: Where,
  controller: AbortController,
): {
  runner: WslRunner;
  spawned: {count: number; kills: number};
} {
  const fake = fakeWsl(() => ({kind: 'printsUntilKilled', lines: []}));
  fake.local.set('C:\\Windows\\System32\\wslconfig.exe', new Uint8Array(0));
  const spawned = {count: 0, kills: 0};
  const runner = createWslRunner({
    ...fake,
    session: fake.session,
    files: {
      ...fake.files,
      exists: path => {
        if (where === 'locating') {
          controller.abort();
        }
        return fake.files.exists(path);
      },
    },
    spawner: async specification => {
      spawned.count += 1;
      const handle = await fake.spawner(specification);
      if (where === 'starting') {
        controller.abort();
      }
      return {
        ...handle,
        kill: () => {
          spawned.kills += 1;
          handle.kill();
        },
      };
    },
  });
  return {runner, spawned};
}

/** What a call of each kind reports when its cancellation fires at `where`, and the processes it started and killed. */
async function ended(
  where: Where,
  call: (runner: WslRunner, signal: AbortSignal) => Promise<Outcome>,
): Promise<{outcome: string; spawned: number; kills: number}> {
  const controller = new AbortController();
  const {runner, spawned} = abortingRunner(where, controller);
  const outcome = await call(runner, controller.signal);
  return {
    outcome: outcome.failure?.kind ?? outcome.kind,
    spawned: spawned.count,
    kills: spawned.kills,
  };
}

const CALLS: ReadonlyArray<
  [string, (runner: WslRunner, signal: AbortSignal) => Promise<Outcome>]
> = [
  [
    'manage',
    (runner, signal) =>
      runner.manage({
        verb: 'install',
        operands: ['Ubuntu'],
        cancellation: signal,
      }),
  ],
  [
    'setDefaultByWslconfig',
    (runner, signal) => runner.setDefaultByWslconfig('Ubuntu', signal),
  ],
  [
    'exec',
    (runner, signal) =>
      runner.exec(
        {
          distro: 'Ubuntu',
          program: 'echo',
          programArguments: [],
          environment: {},
          input: {kind: 'none'},
          cancellation: signal,
        },
        () => undefined,
      ),
  ],
  [
    'start',
    (runner, signal) =>
      runner.start({
        distro: 'Ubuntu',
        program: 'echo',
        programArguments: [],
        environment: {},
        cancellation: signal,
      }),
  ],
];

describe('the runner, cancelled while it sets up (#3282)', () => {
  for (const [name, call] of CALLS) {
    it(`#3282 ${name}: cancelled while wsl.exe is located is cancelled and starts nothing`, async () => {
      deepStrictEqual(await ended('locating', call), {
        outcome: 'cancelled',
        spawned: 0,
        kills: 0,
      });
    });

    it(`#3282 ${name}: cancelled while the process starts is cancelled and kills it`, async () => {
      deepStrictEqual(await ended('starting', call), {
        outcome: 'cancelled',
        spawned: 1,
        kills: 1,
      });
    });
  }
});
