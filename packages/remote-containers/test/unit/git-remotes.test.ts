import {deepStrictEqual} from 'node:assert';
import type {EngineRunOutcome} from '../../src/engine/engine-host.ts';
import {gitRemotesOf} from '../../src/config/git-remotes.ts';

/** The read over a host that answers `outcome` and records what it was asked. */
async function readWith(outcome: EngineRunOutcome) {
  const asked: Array<{argv: readonly string[]; input: unknown}> = [];
  const printed = await gitRemotesOf(
    {
      // eslint-disable-next-line id-length -- the member of the host port
      run: (argv, input) => {
        asked.push({argv, input});
        return Promise.resolve(outcome);
      },
    },
    '/w/p',
    new AbortController().signal,
  );
  return {printed, asked};
}

describe('the remotes of a folder (card containers-161, F-0302 BR-1)', () => {
  it('F-0302 BR-1: git is asked with its arguments apart, in the folder, and its text is what the remotes print', async () => {
    const stdout = 'remote.origin.url https://github.com/o/n.git\n';
    const {printed, asked} = await readWith({
      kind: 'ran',
      status: 0,
      stdout,
      stderr: '',
    });
    deepStrictEqual(
      [printed, asked],
      [
        stdout,
        [
          {
            argv: [
              '-C',
              '/w/p',
              'config',
              '--get-regexp',
              '^remote\\..*\\.url$',
            ],
            input: {kind: 'none'},
          },
        ],
      ],
    );
  });

  it('F-0302 BR-1: a status of 1 (no remote), a failed run, a signal and an empty output are no remotes', async () => {
    deepStrictEqual(
      [
        (await readWith({kind: 'ran', status: 1, stdout: '', stderr: ''}))
          .printed,
        (
          await readWith({
            kind: 'ran',
            status: 128,
            stdout: 'x',
            stderr: 'fatal',
          })
        ).printed,
        (await readWith({kind: 'failed', detail: 'ENOENT'})).printed,
        (
          await readWith({
            kind: 'ran',
            status: undefined,
            stdout: 'x',
            stderr: '',
          })
        ).printed,
        (await readWith({kind: 'ran', status: 0, stdout: '', stderr: ''}))
          .printed,
      ],
      [undefined, undefined, undefined, undefined, undefined],
    );
  });
});
