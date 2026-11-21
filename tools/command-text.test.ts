import {deepStrictEqual} from 'node:assert';
import {
  differenceText,
  eventsWords,
  labelledWords,
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

  it('#2900: two reads that differ give the failure text with both reads, the events, the labelled containers and the log, in that order', () => {
    const text = differenceText(
      {states: ['abc|running|2026-11-20T05:01:20Z'], seconds: 1000},
      {states: ['abc|exited|2026-11-20T05:01:20Z'], seconds: 1037},
      '1030 die abc c43\n1031 stop abc c43',
      'abc c43 Exited (137) run=77',
      ['a log line', 'another'],
    );
    deepStrictEqual(text.split('\n'), [
      'the states read at 1000: ["abc|running|2026-11-20T05:01:20Z"]',
      'the states read at 1037: ["abc|exited|2026-11-20T05:01:20Z"]',
      'the container events between them:',
      '1030 die abc c43',
      '1031 stop abc c43',
      "every container with the folder's label, of any run:",
      'abc c43 Exited (137) run=77',
      "the containers log since the row's mark:",
      'a log line',
      'another',
    ]);
  });

  it('#2900: no event, an unreadable list and an empty log are told as words under their headings', () => {
    const text = differenceText(
      {states: [], seconds: 1},
      {states: ['abc|running|x'], seconds: 2},
      '',
      'could not be read: Error: timed out',
      [],
    );
    deepStrictEqual(text.split('\n').slice(2), [
      'the container events between them:',
      'none',
      "every container with the folder's label, of any run:",
      'could not be read: Error: timed out',
      "the containers log since the row's mark:",
      'none',
    ]);
  });

  describe('the docker commands that explain a difference, against a real daemon', () => {
    before(async function () {
      if (
        (await outputOrReason('docker', ['info'], 20_000)).startsWith(
          'could not be read',
        )
      ) {
        this.skip();
      }
    });

    it('#2900 (#1288): the events command and its format are accepted by the daemon, and what it prints goes through the failure text', async () => {
      const now = Math.floor(Date.now() / 1000);
      const events = await outputOrReason('docker', eventsWords(now - 2, now));
      deepStrictEqual(
        [
          events.startsWith('could not be read'),
          differenceText(
            {states: [], seconds: now - 2},
            {states: [], seconds: now},
            events,
            '',
            [],
          ).includes('the container events between them:'),
        ],
        [false, true],
      );
    });

    it('#2900 (#1288): the labelled-containers command and its format are accepted by the daemon, and no container carries a label no one set', async () => {
      const labelled = await outputOrReason(
        'docker',
        labelledWords('remote-oss.states-difference=never-set'),
      );
      deepStrictEqual(labelled, '');
    });

    it('#2900 (#1288): a format the daemon rejects is a failure of the row, not an empty list', async () => {
      const words = labelledWords('remote-oss.states-difference=never-set');
      const broken = words.map(word =>
        word.replace('{{.Names}}', '{{.NoSuchField}}'),
      );
      deepStrictEqual(
        (await outputOrReason('docker', broken)).startsWith(
          'could not be read',
        ),
        true,
      );
    });
  });
});
