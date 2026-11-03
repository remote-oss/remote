import {deepStrictEqual} from 'node:assert';
import {cloneText} from '../../src/volumes/clone-strings.ts';
import {runHostProgram} from '../../src/volumes/host-program.ts';
import {sourceRowsOf} from '../../src/volumes/source-pick.ts';

/** A translation that marks the text it was given. */
function marked(template: string): string {
  return `«${template}»`;
}

describe('the texts and the source pick of Clone Repository in Container Volume (card containers-151)', () => {
  it('F-0701 7.E1: S052 names the repository, through the translation', () => {
    deepStrictEqual(
      cloneText('S052', marked, ['https://h.invalid/r']),
      "«Cannot access the repository 'https://h.invalid/r'.»",
    );
  });

  it('F-0701 5.0 steps 3 and 4, BR-15: no row before any text, then the clone row with the text trimmed', () => {
    deepStrictEqual(
      [
        sourceRowsOf('', marked),
        sourceRowsOf('   ', marked),
        sourceRowsOf('  o/r ', marked),
      ],
      [
        [],
        [],
        [{label: '«Clone git repository from URL»', description: 'o/r'}],
      ],
    );
  });
});

describe('a program of a clone’s check (card containers-151)', () => {
  it('gives the exit status, with the added variables, and null for a program that doesn’t start', async () => {
    deepStrictEqual(
      [
        await runHostProgram(
          process.execPath,
          ['-e', 'process.exit(process.env.EXIT_WITH === "3" ? 3 : 0)'],
          {EXIT_WITH: '3'},
          new AbortController().signal,
        ),
        await runHostProgram(
          '/nonexistent/program',
          [],
          {},
          new AbortController().signal,
        ),
      ],
      [3, null],
    );
  });

  it('a cancelled run ends the program', async () => {
    const cancellation = new AbortController();
    const running = runHostProgram(
      process.execPath,
      ['-e', 'setTimeout(() => undefined, 60_000)'],
      {},
      cancellation.signal,
    );
    cancellation.abort();
    deepStrictEqual(await running, null);
  });
});
