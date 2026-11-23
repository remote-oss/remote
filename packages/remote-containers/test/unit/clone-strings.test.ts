import {deepStrictEqual} from 'node:assert';
import {cloneText} from '../../src/volumes/clone-strings.ts';
import {runHostProgram} from '../../src/volumes/host-program.ts';
import {pickedSourceOf, sourceRowsOf} from '../../src/volumes/source-pick.ts';

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

  it('F-0701 5.0 steps 3 and 4, AC-2, AC-3, BR-1, BR-15: the GitHub row under remote sources, then the clone row with the text trimmed above it', () => {
    const github = {
      kind: 'github',
      label: '«Clone a repository from «GitHub» in a Container Volume»',
      description: '',
    };
    deepStrictEqual(
      [
        sourceRowsOf('', marked, 'local'),
        sourceRowsOf('   ', marked, 'local'),
        sourceRowsOf('  o/r ', marked, 'local'),
      ],
      [
        [{kind: 'separator', label: '«remote sources»'}, github],
        [{kind: 'separator', label: '«remote sources»'}, github],
        [
          {
            kind: 'url',
            label: '«Clone git repository from URL»',
            description: 'o/r',
          },
          github,
        ],
      ],
    );
  });

  it('F-0701 BR-8: from a remote window the GitHub row says GitHub alone, and without the GitHub source there is only the clone row', () => {
    deepStrictEqual(
      [
        sourceRowsOf('', marked, 'remote'),
        sourceRowsOf('', marked, 'none'),
        sourceRowsOf('o/r', marked, 'none'),
      ],
      [
        [
          {kind: 'separator', label: '«remote sources»'},
          {kind: 'github', label: '«GitHub»', description: ''},
        ],
        [],
        [
          {
            kind: 'url',
            label: '«Clone git repository from URL»',
            description: 'o/r',
          },
        ],
      ],
    );
  });

  it('F-0701 6.3: a repository picked on GitHub is its address, or with a branch the branch’s URL', () => {
    deepStrictEqual(
      [
        pickedSourceOf({url: 'https://github.com/o/r.git'}),
        pickedSourceOf({url: 'https://github.com/o/r.git', branch: 'a/b'}),
        pickedSourceOf({url: 'https://github.com/o/r/', branch: 'main'}),
      ],
      [
        'https://github.com/o/r.git',
        'https://github.com/o/r/tree/a/b',
        'https://github.com/o/r/tree/main',
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
