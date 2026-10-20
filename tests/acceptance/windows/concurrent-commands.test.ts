import {deepStrictEqual} from 'node:assert';
import {inWindow, startInWindow, waitFor, windowEvents} from './harness.ts';

/** Whether window `name` has reported the end of the first command it accepted after its event number `mark`. */
function firstEnded(name: string, mark: number): boolean {
  const events = windowEvents(name).slice(mark);
  const first = events.find(each => each.event === 'accepted');
  return (
    first !== undefined &&
    events.some(each => each.id === first.id && each.event === 'done')
  );
}

describe('the window agent runs a command while another is in flight (harness)', function () {
  this.timeout(120_000);

  it('harness (concurrent): a command started with startInWindow does not hold back the next one', async () => {
    const mark = windowEvents('local').length;
    await startInWindow('local', 'acceptance.agent.sleep', 5000);
    const started = Date.now();
    await inWindow('local', 'acceptance.agent.state');
    const stateTook = Date.now() - started;
    const sleepEndedFirst = firstEnded('local', mark);
    await waitFor('the sleep to end', () => firstEnded('local', mark), 30_000);
    deepStrictEqual(
      {sleepEndedFirst, stateWithinTheSleep: stateTook < 5000},
      {sleepEndedFirst: false, stateWithinTheSleep: true},
    );
  });
});
