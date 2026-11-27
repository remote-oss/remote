import {deepStrictEqual} from 'node:assert';
import {failedWithReadout, stamped} from './stamped-steps.ts';

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

/** `finished` when `ending` resolves, and the text of its failure when it rejects. */
function endingOf(ending: Promise<unknown>): Promise<string> {
  return ending.then(
    () => 'finished',
    (caught: unknown) => String(caught),
  );
}

describe('the stamped and bounded steps of a row (card #3003)', () => {
  it('#3003: a step that finishes gives its value and says how long it took', async () => {
    const {said, environment} = environmentOf(1500);
    deepStrictEqual(
      [
        await stamped(
          'row',
          'delete',
          1000,
          () => Promise.resolve(7),
          environment,
        ),
        said,
      ],
      [7, ['row: delete took 1.5 s']],
    );
  });

  it('#3003: a step that throws says how long it ran, and its own error stands', async () => {
    const {said, environment} = environmentOf(2000);
    const outcome = await endingOf(
      stamped(
        'row',
        'kill',
        1000,
        () => Promise.reject(new Error('no palette')),
        environment,
      ),
    );
    deepStrictEqual(
      [outcome, said],
      ['Error: no palette', ['row: kill failed after 2.0 s']],
    );
  });

  it('#3003: a step that does not finish within its limit fails naming the step and the row', async () => {
    const {said, environment} = environmentOf(1000);
    const outcome = await endingOf(
      stamped(
        'row',
        'second connect',
        20,
        () => new Promise<string>(() => undefined),
        environment,
      ),
    );
    deepStrictEqual(
      [outcome, said],
      [
        'Error: row: the step "second connect" had not finished after 0.02 s',
        ['row: second connect failed after 1.0 s'],
      ],
    );
  });

  it('#3276: a failure carries the readout after it, as its message, with the failure as its cause', async () => {
    const failure = new Error('the connect did not finish');
    const error = await failedWithReadout(
      'row',
      failure,
      () => Promise.resolve('the host held a CLI'),
      1000,
    );
    deepStrictEqual(
      [error.message, error.cause],
      [`${String(failure)}\nthe host held a CLI`, failure],
    );
  });

  it('#3276: a readout that fails leaves the failure first, with a line that says the readout did not finish', async () => {
    const failure = new Error('the connect did not finish');
    const error = await failedWithReadout(
      'row',
      failure,
      () => Promise.reject(new Error('the container is gone')),
      1000,
    );
    deepStrictEqual(
      [error.message, error.cause],
      [
        `${String(failure)}\nthe readout did not finish: Error: the container is gone`,
        failure,
      ],
    );
  });

  it('#3276: a readout that does not end is bounded, and the failure is still first', async () => {
    const failure = new Error('the connect did not finish');
    const error = await failedWithReadout(
      'row',
      failure,
      () => new Promise<string>(() => undefined),
      20,
    );
    deepStrictEqual(
      error.message.startsWith(
        `${String(failure)}\nthe readout did not finish: Error: row: the step "the readout of the step that failed" had not finished`,
      ),
      true,
    );
  });
});
