/**
 * @fileoverview acceptance-select: the launches of the VSCodium run a change can reach.
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import type {Launch} from './acceptance-launches.ts';
import {launchesInput, selectLaunches} from './acceptance-select.ts';

/** A launch table of each kind the selector reads: runner and plain launches, with and without extensions. */
const LAUNCHES: Launch[] = [
  {label: 'local', runner: 'runner', suite: 'suite-local'},
  {label: 'remote', runner: 'runner-remote', suite: 'suite-remote'},
  {
    label: 'explorer-one',
    kind: 'plain',
    suite: 'suite-explorer',
    withExtensions: ['remote-oss.remote-explorer'],
  },
  {label: 'trust-one', kind: 'plain', suite: 'suite-trust'},
  {label: 'windows', kind: 'plain', suite: 'windows'},
  {
    label: 'containers-one',
    kind: 'plain',
    suite: 'suite-containers',
    withExtensions: ['remote-oss.remote-containers'],
  },
  {
    label: 'containers-two',
    kind: 'plain',
    suite: 'suite-containers',
    withExtensions: ['remote-oss.remote-containers'],
  },
];
const EVERY = LAUNCHES.map(launch => launch.label);

/** The labels a list of changed paths selects from the fixture table. */
function labelsFor(...changed: string[]): string[] {
  return selectLaunches(changed, LAUNCHES).labels;
}

describe('acceptance-select', () => {
  it('a Dev Containers change reaches the containers launches only', () => {
    deepStrictEqual(labelsFor('packages/remote-containers/src/extension.ts'), [
      'containers-one',
      'containers-two',
    ]);
  });

  it('a Remote Explorer change reaches the explorer launches only', () => {
    deepStrictEqual(labelsFor('packages/remote-explorer/src/view.ts'), [
      'explorer-one',
    ]);
  });

  it("a suite's own test reaches the launches of that suite", () => {
    deepStrictEqual(labelsFor('tests/acceptance/suite-trust/x.test.ts'), [
      'trust-one',
    ]);
  });

  it('a containers test change reaches the containers launches only', () => {
    deepStrictEqual(
      labelsFor('tests/acceptance/suite-containers/gate/rows.test.ts'),
      ['containers-one', 'containers-two'],
    );
  });

  it('a helper in a suite folder (the shared windows harness) reaches every launch', () => {
    deepStrictEqual(labelsFor('tests/acceptance/windows/renderer.ts'), EVERY);
  });

  it('the reason names the helper that selected every launch', () => {
    deepStrictEqual(
      selectLaunches(['tests/acceptance/windows/renderer.ts'], LAUNCHES)
        .reasons,
      EVERY.map(label => `${label}: tests/acceptance/windows/renderer.ts`),
    );
  });

  it('documentation and unit tests reach no launch', () => {
    deepStrictEqual(
      labelsFor(
        'docs/architecture/x.md',
        'README.md',
        'packages/remote-containers/test/unit/a.test.ts',
        'tools/build.test.ts',
      ),
      [],
    );
  });

  it('a tool outside the table, and acceptance folders no launch has as its suite, reach every launch', () => {
    deepStrictEqual(
      [
        labelsFor('tools/command-runner.ts'),
        labelsFor('tests/acceptance/host/Dockerfile'),
        labelsFor('tests/acceptance/window-agent/extension.ts'),
      ],
      [EVERY, EVERY, EVERY],
    );
  });

  it('a change to two packages reaches the union, in the run order', () => {
    deepStrictEqual(
      labelsFor(
        'packages/remote-containers/src/a.ts',
        'packages/remote-explorer/src/b.ts',
      ),
      ['explorer-one', 'containers-one', 'containers-two'],
    );
  });

  it('a path the table does not name, with others, reaches every launch', () => {
    deepStrictEqual(
      labelsFor(
        'packages/remote-containers/src/a.ts',
        '.github/workflows/ci.yml',
      ),
      EVERY,
    );
  });

  it('a new containers launch is selected by its own fields, with no edit to the selector', () => {
    const more: Launch[] = [
      ...LAUNCHES,
      {
        label: 'containers-new',
        kind: 'plain',
        suite: 'suite-new',
        withExtensions: ['remote-oss.remote-containers'],
      },
    ];
    deepStrictEqual(
      selectLaunches(['packages/remote-containers/src/a.ts'], more).labels,
      ['containers-one', 'containers-two', 'containers-new'],
    );
  });

  it('names, per selected launch, the changed path that selected it', () => {
    deepStrictEqual(
      selectLaunches(['packages/remote-containers/src/a.ts'], LAUNCHES).reasons,
      [
        'containers-one: packages/remote-containers/src/a.ts',
        'containers-two: packages/remote-containers/src/a.ts',
      ],
    );
  });

  it('gives the dispatch input none, all, or the labels joined by commas', () => {
    deepStrictEqual(
      [
        launchesInput(selectLaunches(['docs/a.md'], LAUNCHES), LAUNCHES),
        launchesInput(selectLaunches(['tools/build.ts'], LAUNCHES), LAUNCHES),
        launchesInput(
          selectLaunches(['packages/remote-containers/src/a.ts'], LAUNCHES),
          LAUNCHES,
        ),
      ],
      ['none', 'all', 'containers-one,containers-two'],
    );
  });

  it('an empty change reaches no launch', () => {
    strictEqual(labelsFor().length, 0);
  });
});
