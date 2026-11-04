import {deepStrictEqual} from 'node:assert';
import {deferred} from '../../src/deferred.ts';
import {
  STARTING_DOCKER_DELAY_MILLISECONDS,
  watchedCheck,
  type StartingDockerPorts,
} from '../../src/engine/starting-docker.ts';

/** The ports over a clock the test moves, with what was shown and how it ended. */
function sceneOf() {
  const timers: Array<{dueAt: number; callback: () => void; live: boolean}> =
    [];
  let now = 0;
  const shown: Array<{cancel: () => void; ended: boolean}> = [];
  const ports: StartingDockerPorts = {
    setTimer: (callback, milliseconds) => {
      const timer = {dueAt: now + milliseconds, callback, live: true};
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    show: (ended, cancel) => {
      const record = {cancel, ended: false};
      shown.push(record);
      void ended.then(() => {
        record.ended = true;
      });
    },
  };
  /** Moves the clock on and fires the timers dueAt. */
  async function advance(milliseconds: number): Promise<void> {
    now += milliseconds;
    for (const timer of timers) {
      if (timer.live && timer.dueAt <= now) {
        timer.live = false;
        timer.callback();
      }
    }
    await new Promise(resolve => setImmediate(resolve));
  }
  return {ports, shown, advance};
}

describe('the notice of the first check of a command (card containers-172, §3)', () => {
  it('F-0205 AC-21, F-0202 7.E5: a check that ends within the two seconds shows nothing, and its timer is gone', async () => {
    const scene = sceneOf();
    const outcome = await watchedCheck(
      scene.ports,
      () => Promise.resolve(7),
      new AbortController().signal,
    );
    await scene.advance(STARTING_DOCKER_DELAY_MILLISECONDS * 2);
    deepStrictEqual(
      [outcome, scene.shown.length],
      [{kind: 'done', result: 7}, 0],
    );
  });

  it('F-0205 AC-6a, BR-10: a check still running at two seconds shows the notice, once, and it ends when the check does', async () => {
    const scene = sceneOf();
    const finish = deferred<string>();
    const running = watchedCheck(
      scene.ports,
      () => finish.promise,
      new AbortController().signal,
    );
    await scene.advance(STARTING_DOCKER_DELAY_MILLISECONDS - 1);
    const early = scene.shown.length;
    await scene.advance(1);
    const atTwo = [scene.shown.length, scene.shown[0]?.ended];
    finish.resolve('ok');
    const outcome = await running;
    await scene.advance(0);
    deepStrictEqual(
      [early, atTwo, outcome, scene.shown[0]?.ended],
      [0, [1, false], {kind: 'done', result: 'ok'}, true],
    );
  });

  it('F-0205 AC-6b: Cancel ends the command at once as stopped, aborts the check’s signal, and ends the notice', async () => {
    const scene = sceneOf();
    let seen: AbortSignal | undefined;
    const running = watchedCheck(
      scene.ports,
      cancellation => {
        seen = cancellation;
        return new Promise<never>(() => undefined);
      },
      new AbortController().signal,
    );
    await scene.advance(STARTING_DOCKER_DELAY_MILLISECONDS);
    scene.shown[0]?.cancel();
    const outcome = await running;
    await scene.advance(0);
    deepStrictEqual(
      [outcome, seen?.aborted, scene.shown[0]?.ended],
      [{kind: 'stopped'}, true, true],
    );
  });

  it('F-0205 BR-10: the outer signal reaches the check, and a check that is already cancelled starts aborted', async () => {
    const scene = sceneOf();
    const outer = new AbortController();
    let seen: AbortSignal | undefined;
    const finish = deferred<undefined>();
    const running = watchedCheck(
      scene.ports,
      cancellation => {
        seen = cancellation;
        return finish.promise;
      },
      outer.signal,
    );
    const before = seen?.aborted;
    outer.abort();
    const after = seen?.aborted;
    finish.resolve(undefined);
    await running;
    const late = new AbortController();
    late.abort();
    let started: boolean | undefined;
    await watchedCheck(
      scene.ports,
      cancellation => {
        started = cancellation.aborted;
        return Promise.resolve();
      },
      late.signal,
    );
    deepStrictEqual([before, after, started], [false, true, true]);
  });
});
