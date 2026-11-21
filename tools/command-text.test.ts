import {deepStrictEqual} from 'node:assert';
import {
  lastLines,
  outputOrReason,
} from '../tests/acceptance/windows/command-text.ts';

describe('the text of a command that explains a failure (card #2900)', () => {
  it('#2900: the output of a command that ends in time is its trimmed standard output', async () => {
    deepStrictEqual(await outputOrReason('echo', ['hello']), 'hello');
  });

  it('#2900: a command that runs past its time is killed and gives the reason as text, not a hang or a throw', async () => {
    const started = Date.now();
    const text = await outputOrReason('sleep', ['30'], 100);
    deepStrictEqual(
      [text.startsWith('could not be read: '), Date.now() - started < 10_000],
      [true, true],
    );
  });

  it('#2900: a command that does not exist gives the reason as text', async () => {
    deepStrictEqual(
      (await outputOrReason('no-such-command-2900', [])).startsWith(
        'could not be read: ',
      ),
      true,
    );
  });

  it('#2900: a list within the limit comes back as it is', () => {
    deepStrictEqual(lastLines(['one', 'two'], 5), 'one\ntwo');
  });

  it('#2900: a huge list shows its last lines after a line that counts the others, and stays under the cap', () => {
    const lines = [...Array(100_000).keys()].map(
      number => `line ${String(number)}`,
    );
    const text = lastLines(lines, 60);
    deepStrictEqual(
      [text.split('\n').length, text.split('\n')[0], text.split('\n').at(-1)],
      [61, 'and 99940 more', 'line 99999'],
    );
  });

  it('#2900: a line of more than 240 characters is cut to 240 and marked', () => {
    const text = lastLines(['x'.repeat(1000)], 5);
    deepStrictEqual([text.length, text.endsWith('...')], [243, true]);
  });

  it('#2900: no list of any size is longer than the limit times the line width plus the count line', () => {
    const text = lastLines(
      Array.from({length: 500}, () => 'y'.repeat(5000)),
      100,
    );
    deepStrictEqual(text.length <= 100 * 243 + 100 + 20, true);
  });
});
