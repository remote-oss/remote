import {deepStrictEqual} from 'node:assert';
import {
  type ContributionPolling,
  contributionsAfterRuns,
  contributionsFailure,
} from '../tests/acceptance/windows/contribution-polling.ts';

/** A clock that each pause moves on by the pause. */
function clockOf() {
  const state = {now: 1000};
  return {
    state,
    environment: {
      now: () => state.now,
      pause: (milliseconds: number) => {
        state.now += milliseconds;
        return Promise.resolve();
      },
    },
  };
}

/**
 * A wait whose command's list holds `lists[run]` (the last again for later runs), over the clock `clock`; the number of
 * runs is counted.
 */
function waitOver(
  lists: readonly string[],
  clock: ReturnType<typeof clockOf>,
  replaced: Partial<ContributionPolling> = {},
) {
  const counted = {runs: 0};
  const polling: ContributionPolling = {
    show: () => {
      counted.runs += 1;
      return Promise.resolve();
    },
    read: () =>
      Promise.resolve(lists[Math.min(counted.runs, lists.length) - 1]),
    wanted: 'DISPLAY',
    milliseconds: 30_000,
    perRunMilliseconds: 3000,
    everyMilliseconds: 250,
    environment: clock.environment,
    ...replaced,
  };
  return {counted, polling};
}

describe('the wait for the environment contributions to carry an entry (card #2923)', () => {
  it('#2923: a first run that came before the extension contributed does not end the wait: the second run carries the entry and is the text given', async () => {
    const {polling, counted} = waitOver(
      ['## Extension: other\n- `PATH`', '- `DISPLAY=localhost:10.0`'],
      clockOf(),
    );
    const outcome = await contributionsAfterRuns(polling);
    deepStrictEqual(
      [outcome.found, outcome.text, counted.runs, outcome.runs.length],
      [true, '- `DISPLAY=localhost:10.0`', 2, 2],
    );
  });

  it('#2923: a list that carries the entry at the first run ends the wait with one run', async () => {
    const {polling, counted} = waitOver(['DISPLAY=:10'], clockOf());
    const outcome = await contributionsAfterRuns(polling);
    deepStrictEqual([outcome.found, counted.runs], [true, 1]);
  });

  it('#2923, negative: an extension that never contributes still fails the wait: every run is counted and the last text is kept', async () => {
    const {polling, counted} = waitOver(['## Extension: other'], clockOf());
    const outcome = await contributionsAfterRuns(polling);
    deepStrictEqual(
      [outcome.found, outcome.text, counted.runs > 5, counted.runs <= 12],
      [false, '## Extension: other', true, true],
    );
  });

  it('#2923: a command that fails and a read that fails are kept as words and the wait goes on to the next run', async () => {
    const clock = clockOf();
    const state = {runs: 0};
    const outcome = await contributionsAfterRuns({
      show: () => {
        state.runs += 1;
        return state.runs === 1
          ? Promise.reject(new Error('window gone'))
          : Promise.resolve();
      },
      read: () =>
        state.runs === 1
          ? Promise.reject(new Error('no editor'))
          : Promise.resolve('DISPLAY=:1'),
      wanted: 'DISPLAY',
      milliseconds: 30_000,
      perRunMilliseconds: 500,
      everyMilliseconds: 250,
      environment: clock.environment,
    });
    deepStrictEqual(
      [outcome.found, outcome.runs.map(each => each.result)],
      [
        true,
        [
          'the command failed: Error: window gone; the read failed: Error: no editor',
          'the command ran; the editor held 10 characters with DISPLAY',
        ],
      ],
    );
  });

  it('#2923: the failure names how many times the command ran, the last text and the first runs, bounded to 12 runs and 800 characters', async () => {
    const {polling} = waitOver(['x'.repeat(2000)], clockOf());
    const outcome = await contributionsAfterRuns(polling);
    const failure = contributionsFailure(outcome, 'DISPLAY', 30);
    const lines = failure.split('\n');
    deepStrictEqual(
      [
        lines[0]?.startsWith(
          'timed out waiting for the environment contributions to carry DISPLAY: the command ran ',
        ),
        lines[1]?.includes('(2000 characters, the first 800 shown)'),
        lines.length <= 2 + 12 + 1,
        failure.length < 3000,
      ],
      [true, true, true, true],
    );
  });
});
