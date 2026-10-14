import {deepStrictEqual} from 'node:assert';
import {withContext} from '../../src/connect/context-engine.ts';
import {fakeEngine} from './fake-engine.ts';

const NEVER = new AbortController().signal;

describe('the engine of a Docker context (card containers-08)', () => {
  it('F-0502 BR-21: a spawn gets DOCKER_CONTEXT in its environment, in front of the caller’s own values', async () => {
    const engine = fakeEngine(() => undefined);
    await withContext(engine, 'ctx1').spawn(['info'], {
      environment: {OTHER: 'x'},
      cancellation: NEVER,
    });
    deepStrictEqual(engine.processes[0]?.environment, {
      DOCKER_CONTEXT: 'ctx1',
      OTHER: 'x',
    });
  });

  it('F-0502 BR-21: a spawn with no environment of its own gets the context alone', async () => {
    const engine = fakeEngine(() => undefined);
    await withContext(engine, 'ctx1').spawn(['info'], {cancellation: NEVER});
    deepStrictEqual(engine.processes[0]?.environment, {
      DOCKER_CONTEXT: 'ctx1',
    });
  });

  it('F-0502 BR-21: a one-shot run gets the context too, and the argument list is unchanged', async () => {
    const engine = fakeEngine();
    const seen: unknown[] = [];
    engine.answer = {kind: 'ran', status: 0, stdout: '', stderr: ''};
    const wrapped = withContext(
      {
        // eslint-disable-next-line id-length -- the port's method is named run
        run: (argv, input, options) => {
          seen.push([argv, options.environment]);
          return engine.run(argv, input, options);
        },
        spawn: (argv, options) => engine.spawn(argv, options),
      },
      'ctx1',
    );
    await wrapped.run(['inspect', 'c1'], {kind: 'none'}, {cancellation: NEVER});
    deepStrictEqual(seen, [[['inspect', 'c1'], {DOCKER_CONTEXT: 'ctx1'}]]);
  });
});
