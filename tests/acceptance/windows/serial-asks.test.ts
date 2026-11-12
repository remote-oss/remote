import {deepStrictEqual} from 'node:assert';
import {createSerialAsks} from './serial-asks.ts';

/** A task a row finishes by hand, with the events it saw. */
function held(
  events: string[],
  name: string,
): {
  task: () => Promise<string>;
  finish: (result?: string) => void;
  fail: () => void;
} {
  let resolveTask: (result: string) => void = noResult;
  let rejectTask: (reason: Error) => void = noReason;
  function noResult(): void {
    // Not started yet: nothing to finish.
  }
  function noReason(): void {
    // Not started yet: nothing to fail.
  }
  return {
    task: () => {
      events.push(`${name} starts`);
      return new Promise<string>((resolve, reject) => {
        resolveTask = resolve;
        rejectTask = reject;
      });
    },
    finish: (result = name) => {
      events.push(`${name} ends`);
      resolveTask(result);
    },
    fail: () => {
      events.push(`${name} fails`);
      rejectTask(new Error(`${name} failed`));
    },
  };
}

/** Lets the promise chain run. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
}

describe('the asks of one key, one at a time (card #2430)', () => {
  it('tooling: asks of one key run in the order made and never overlap, each giving its own result, while another key runs at once', async () => {
    const events: string[] = [];
    const serial = createSerialAsks(() => 0);
    const first = held(events, 'first');
    const second = held(events, 'second');
    const other = held(events, 'other');
    const results = [
      serial('a', 1000, first.task),
      serial('a', 1000, second.task),
      serial('b', 1000, other.task),
    ];
    await settle();
    const started = [...events];
    first.finish();
    await settle();
    second.finish();
    other.finish();
    deepStrictEqual(
      [started, await Promise.all(results), events],
      [
        ['first starts', 'other starts'],
        ['first', 'second', 'other'],
        [
          'first starts',
          'other starts',
          'first ends',
          'second starts',
          'second ends',
          'other ends',
        ],
      ],
    );
  });

  it('tooling: an ask that fails does not stop the one behind it, and the failure reaches only its own caller', async () => {
    const events: string[] = [];
    const serial = createSerialAsks(() => 0);
    const first = held(events, 'first');
    const second = held(events, 'second');
    const failing = serial('a', 1000, first.task).then(
      () => 'resolved',
      (caught: unknown) => String(caught),
    );
    const next = serial('a', 1000, second.task);
    await settle();
    first.fail();
    await settle();
    second.finish();
    deepStrictEqual(
      [await failing, await next],
      ['Error: first failed', 'second'],
    );
  });

  it('tooling: an ask that has waited longer than its limit does not start, names its key and the wait, and the asks behind it still run', async () => {
    const events: string[] = [];
    let clock = 0;
    const serial = createSerialAsks(() => clock);
    const first = held(events, 'first');
    const stale = held(events, 'stale');
    const last = held(events, 'last');
    const running = serial('window w commands', 1000, first.task);
    const refused = serial('window w commands', 1000, stale.task).then(
      () => 'started',
      (caught: unknown) => String(caught),
    );
    await settle();
    clock = 1500;
    const fresh = serial('window w commands', 1000, last.task);
    first.finish();
    await settle();
    last.finish();
    deepStrictEqual(
      [await running, await refused, await fresh, events],
      [
        'first',
        'Error: window w commands: this ask waited 1500 ms behind the asks before it, more than its limit of 1000 ms, so it did not start',
        'last',
        ['first starts', 'first ends', 'last starts', 'last ends'],
      ],
    );
  });
});
