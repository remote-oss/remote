import {deepStrictEqual} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {endAfterGrace, timedStep} from './prepare-steps.ts';

/** A clock that each reading advances by `step` milliseconds, and the lines said. */
function environmentOf(step: number) {
  let now = 0;
  const said: string[] = [];
  return {
    said,
    environment: {
      now: () => {
        now += step;
        return now;
      },
      report: (line: string) => said.push(line),
    },
  };
}

describe('the timed and bounded steps of a run’s preparation (#2865)', () => {
  it('#2865: a step that finishes gives its value and says how long it took', async () => {
    const {said, environment} = environmentOf(3000);
    deepStrictEqual(
      [await timedStep('the editor', 1000, () => 'ok', environment), said],
      ['ok', ['acceptance: prepare: the editor done in 3 s']],
    );
  });

  it('#2865: a synchronous step is run and timed too', async () => {
    const {said, environment} = environmentOf(1000);
    deepStrictEqual(
      [await timedStep('the keys', 1000, () => 7, environment), said],
      [7, ['acceptance: prepare: the keys done in 1 s']],
    );
  });

  it('#2865: a step that throws says how long it ran and its own error stands', async () => {
    const {said, environment} = environmentOf(2000);
    const outcome = await timedStep(
      'the host',
      1000,
      () => Promise.reject(new Error('no host')),
      environment,
    ).then(
      () => 'finished',
      (caught: unknown) => String(caught),
    );
    deepStrictEqual(
      [outcome, said],
      ['Error: no host', ['acceptance: prepare: the host failed after 2 s']],
    );
  });

  it('#2865: a step that does not finish within its limit fails naming itself', async () => {
    const {said, environment} = environmentOf(1000);
    const outcome = await timedStep(
      'the editor download',
      20,
      () => new Promise<string>(() => undefined),
      environment,
    ).then(
      () => 'finished',
      (caught: unknown) => String(caught),
    );
    deepStrictEqual(
      [outcome, said],
      [
        'Error: acceptance: the preparation step "the editor download" had not finished after 0 s, so the run stops here and not at the job\'s limit',
        ['acceptance: prepare: the editor download failed after 1 s'],
      ],
    );
  });

  it('#2865: the grace timer calls exit once, after its time, and does not hold the process open', async () => {
    const exits: number[] = [];
    const timer = endAfterGrace(10, () => exits.push(1));
    const unref = !timer.hasRef();
    await new Promise(resolve => setTimeout(resolve, 60));
    deepStrictEqual([unref, exits], [true, [1]]);
  });

  it('#2865: a process held open by a step that never finishes ends after the grace with the run’s exit code', () => {
    const preparation = new URL('prepare-steps.ts', import.meta.url).href;
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import {endAfterGrace, timedStep} from '${preparation}';
         setInterval(() => undefined, 1000);
         await timedStep('stuck', 50, () => new Promise(() => undefined)).catch(() => {
           process.exitCode = 3;
         });
         endAfterGrace(100);`,
      ],
      {encoding: 'utf8', timeout: 30_000},
    );
    deepStrictEqual([child.status, child.signal], [3, null]);
  });
});
