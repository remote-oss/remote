import {deepStrictEqual} from 'node:assert';
import {stamped} from './stamped-steps.ts';

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
});
