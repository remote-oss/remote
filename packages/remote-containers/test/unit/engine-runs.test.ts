import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnedEngineHost} from '../../src/engine/engine-runs.ts';
import {fakeEngine, type SpawnPlan} from './fake-engine.ts';

const NEVER = new AbortController().signal;

/** The engine host over a fake engine's spawns, run once with `plan`. */
function hostOver(plan: SpawnPlan): {
  host: ReturnType<typeof spawnedEngineHost>;
  engine: ReturnType<typeof fakeEngine>;
} {
  const engine = fakeEngine(plan);
  return {
    engine,
    host: spawnedEngineHost((argv, options) => engine.spawn(argv, options)),
  };
}

describe('a one-shot run over any spawn (card containers-174)', () => {
  it('a run is given its text, and gives what the command printed on each output and its status', async () => {
    const {host, engine} = hostOver(async process => {
      await process.stdinEnded;
      process.print('out');
      process.printError('err');
      process.exit(3);
    });
    const outcome = await host.run(
      ['version'],
      {kind: 'text', text: 'hello'},
      {cancellation: NEVER},
    );
    deepStrictEqual(
      [outcome, engine.processes[0]?.stdin().toString('utf8')],
      [{kind: 'ran', status: 3, stdout: 'out', stderr: 'err'}, 'hello'],
    );
  });

  it('a run with no input has its input closed at once, and a signal is no status', async () => {
    const {host, engine} = hostOver(async process => {
      await process.stdinEnded;
      process.exit(undefined);
    });
    const outcome = await host.run(
      ['ps'],
      {kind: 'none'},
      {cancellation: NEVER},
    );
    deepStrictEqual(
      [outcome, engine.processes[0]?.stdin().length],
      [{kind: 'ran', status: undefined, stdout: '', stderr: ''}, 0],
    );
  });

  it('a run of a local file streams its bytes unchanged', async () => {
    const folder = mkdtempSync(path.join(tmpdir(), 'engine-runs-'));
    const file = path.join(folder, 'input.bin');
    writeFileSync(file, Buffer.from([0, 255, 10, 13]));
    try {
      const {host, engine} = hostOver(async process => {
        await process.stdinEnded;
        process.exit(0);
      });
      await host.run(
        ['load'],
        {kind: 'file', localFile: file},
        {cancellation: NEVER},
      );
      deepStrictEqual(
        [...(engine.processes[0]?.stdin() ?? [])],
        [0, 255, 10, 13],
      );
    } finally {
      rmSync(folder, {recursive: true, force: true});
    }
  });

  it('a spawn that fails is the run’s failure, with its detail', async () => {
    const {host} = hostOver({failure: 'no docker'});
    deepStrictEqual(
      await host.run(['info'], {kind: 'none'}, {cancellation: NEVER}),
      {kind: 'failed', detail: 'no docker'},
    );
  });

  it('a spawn goes through as it is', async () => {
    const {host, engine} = hostOver(process => {
      process.exit(0);
    });
    const spawned = await host.spawn(['events'], {
      environment: {DOCKER_HOST: 'unix:///x'},
      cancellation: NEVER,
    });
    deepStrictEqual(
      [
        spawned.kind,
        engine.processes[0]?.argv,
        engine.processes[0]?.environment,
      ],
      ['spawned', ['events'], {DOCKER_HOST: 'unix:///x'}],
    );
  });
});
