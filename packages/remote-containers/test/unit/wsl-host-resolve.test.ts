import {deepStrictEqual} from 'node:assert';
import {createWslRunner} from 'lib-wsl';
import {type FakeRun, fakeWsl, utf16Output} from 'lib-wsl/testing/fake-wsl';
import type {DistroChoice} from '../../src/engine/engine-host-of.ts';
import {resolvedHostOf} from '../../src/engine/wsl-host-resolve.ts';

const NEVER = new AbortController().signal;
const LIST = [
  '  NAME            STATE           VERSION',
  '* Ubuntu-24.04    Running         2',
  '  Debian          Stopped         2',
].join('\r\n');
const LISTS: FakeRun = {kind: 'exits', stdout: utf16Output(LIST), status: 0};

/** A choice of the distro `distro` by the settings. */
function chosen(distro: string | undefined): DistroChoice {
  return {kind: 'distro', distro, folder: 'c:\\work', chosenBy: 'settings'};
}

/** The resolution of `choice` over a `wsl.exe` that gives every process `behaviour`, and how many processes it started. */
async function resolved(
  choice: Parameters<typeof resolvedHostOf>[0],
  behaviour: FakeRun,
) {
  const fake = fakeWsl(() => behaviour);
  const outcome = await resolvedHostOf(choice, createWslRunner(fake), NEVER);
  return {outcome, started: fake.started.length};
}

describe('the host a choice comes to (card containers-203, F-0207 BR-17, ruling of dike’s review)', () => {
  it('F-0207 BR-15: a local choice is the local host as it is, with no process run', async () => {
    deepStrictEqual(
      await resolved({kind: 'local', folder: 'c:\\work'}, LISTS),
      {outcome: {kind: 'local', folder: 'c:\\work'}, started: 0},
    );
  });

  it('F-0207 BR-3: a name the list holds gives the host of its registered spelling, and the empty name the default distro', async () => {
    const typed = await resolved(chosen('debian'), LISTS);
    const fallback = await resolved(chosen(undefined), LISTS);
    deepStrictEqual(
      [typed, fallback].map(each =>
        each.outcome.kind === 'distro'
          ? [each.outcome.distro, each.started]
          : each.outcome,
      ),
      [
        ['Debian', 1],
        ['Ubuntu-24.04', 1],
      ],
    );
  });

  it('F-0207 BR-17: a name the list does not hold, one that looks like an option, an empty name with no default distro and a list that cannot be had are refused with only the list run', async () => {
    const unmarked = utf16Output(
      [
        '  NAME            STATE           VERSION',
        '  Debian          Stopped         2',
      ].join('\r\n'),
    );
    const results = [
      await resolved(chosen('Arch'), LISTS),
      await resolved(chosen('--unregister'), LISTS),
      await resolved(chosen(undefined), {
        kind: 'exits',
        stdout: unmarked,
        status: 0,
      }),
      await resolved(chosen('Debian'), {
        kind: 'exits',
        stdout: utf16Output(LIST),
        status: 1,
      }),
    ];
    deepStrictEqual(
      results.map(each =>
        each.outcome.kind === 'refused'
          ? [
              each.outcome.reason,
              'typed' in each.outcome
                ? each.outcome.typed
                : 'detail' in each.outcome
                  ? each.outcome.detail
                  : '',
              each.started,
            ]
          : each.outcome,
      ),
      [
        ['unknown', 'Arch', 1],
        ['unknown', '--unregister', 1],
        ['noDistro', '', 1],
        ['unavailable', 'wsl.exe --list ended with status 1', 1],
      ],
    );
  });
});
