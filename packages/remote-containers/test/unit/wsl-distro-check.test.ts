import {deepStrictEqual} from 'node:assert';
import {createWslRunner} from 'lib-wsl';
import {type FakeRun, fakeWsl, utf16Output} from 'lib-wsl/testing/fake-wsl';
import {checkedDistroOf} from '../../src/engine/wsl-distro-check.ts';

const NEVER = new AbortController().signal;
const LIST = [
  '  NAME            STATE           VERSION',
  '* Ubuntu-24.04    Running         2',
  '  Debian          Stopped         2',
].join('\r\n');

/** The check of `typed` over a `wsl.exe` that gives every process `behaviour`, and how many processes it started. */
async function checked(typed: string, behaviour: FakeRun) {
  const fake = fakeWsl(() => behaviour);
  const outcome = await checkedDistroOf(createWslRunner(fake), typed, NEVER);
  return {outcome, started: fake.started.length};
}

const LISTS: FakeRun = {kind: 'exits', stdout: utf16Output(LIST), status: 0};

describe('the check of a distro name against WSL’s list (card containers-203, F-0207 BR-3, BR-19)', () => {
  it('F-0207 BR-3: a registered name gives its registered spelling, however it was typed, and the empty name gives the default distro, with one run of the list each', async () => {
    deepStrictEqual(
      [
        await checked('debian', LISTS),
        await checked('Debian', LISTS),
        await checked('', LISTS),
      ],
      [
        {outcome: {kind: 'registered', name: 'Debian'}, started: 1},
        {outcome: {kind: 'registered', name: 'Debian'}, started: 1},
        {outcome: {kind: 'registered', name: 'Ubuntu-24.04'}, started: 1},
      ],
    );
  });

  it('F-0207 BR-17: a name the list does not hold is unknown, and a name that looks like an option is too, and nothing but the list ran', async () => {
    const answers = [
      await checked('Arch', LISTS),
      await checked('--unregister', LISTS),
    ];
    deepStrictEqual(
      answers.map(each => [each.outcome, each.started]),
      [
        [{kind: 'unknown', typed: 'Arch'}, 1],
        [{kind: 'unknown', typed: '--unregister'}, 1],
      ],
    );
  });

  it('F-0207 BR-3: the empty name with no default distro is noDistro', async () => {
    const unmarked = [
      '  NAME            STATE           VERSION',
      '  Debian          Stopped         2',
    ].join('\r\n');
    deepStrictEqual(
      (
        await checked('', {
          kind: 'exits',
          stdout: utf16Output(unmarked),
          status: 0,
        })
      ).outcome,
      {kind: 'noDistro'},
    );
  });

  it('F-0207 BR-3: a list that cannot be had, ended badly or read is unavailable, with the reason', async () => {
    const results = [
      await checked('Debian', {
        kind: 'failsToStart',
        error: {message: 'denied'},
      }),
      await checked('Debian', {
        kind: 'exits',
        stdout: utf16Output(LIST),
        status: 1,
      }),
      await checked('Debian', {
        kind: 'exits',
        stdout: utf16Output('  NAME      STATE  VERSION\r\nbroken'),
        status: 0,
      }),
    ].map(each =>
      each.outcome.kind === 'unavailable' ? each.outcome.detail : each.outcome,
    );
    deepStrictEqual(results, [
      'spawnFailed: denied',
      'wsl.exe --list ended with status 1',
      'line:1',
    ]);
  });
});
