/**
 * @fileoverview acceptance-select: the launches of the VSCodium run a change can reach.
 */

import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import path from 'node:path';
import {type Launch, launchesOf} from './acceptance-launches.ts';
import {
  FILE_PART_MINUTES,
  FILE_PARTS,
  launchesInput,
  narrowedParts,
  planOfChange,
  selectedParts,
  selectLaunches,
  SMOKE_PART,
} from './acceptance-select.ts';
import {chosenLaunches} from './acceptance.ts';
import {REPOSITORY_ROOT} from './repository.ts';

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
  {
    label: 'containers-three',
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
      'containers-three',
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

  it("coverage-25c: the explorer-trust, explorer-home and explorer-rows suites' tests select their own launches in the real table", () => {
    deepStrictEqual(
      selectLaunches(
        [
          'tests/acceptance/explorer-home/home-files.test.ts',
          'tests/acceptance/explorer-rows/refresh.test.ts',
          'tests/acceptance/explorer-trust/restricted.test.ts',
        ],
        launchesOf(REPOSITORY_ROOT),
      ).labels,
      ['explorer-trust', 'explorer-home', 'explorer-rows'],
    );
  });

  it('a containers test change reaches the containers launches only, one suite selecting them all', () => {
    deepStrictEqual(
      labelsFor('tests/acceptance/suite-containers/gate/rows.test.ts'),
      ['containers-one', 'containers-two', 'containers-three'],
    );
  });

  it('a suite run in parts by its files: a test reaches the parts that list it, and every part when none does', () => {
    const parts: Launch[] = [
      {
        label: 'part-a',
        kind: 'plain',
        suite: 'suite-parts',
        files: ['alpha.test.ts'],
      },
      {
        label: 'part-b',
        kind: 'plain',
        suite: 'suite-parts',
        files: ['beta.test.ts'],
      },
    ];
    deepStrictEqual(
      [
        'tests/acceptance/suite-parts/alpha.test.ts',
        'tests/acceptance/suite-parts/nested/beta.test.ts',
        'tests/acceptance/suite-parts/gamma.test.ts',
      ].map(changed => selectLaunches([changed], parts).labels),
      [['part-a'], ['part-b'], ['part-a', 'part-b']],
    );
  });

  it('a launch of the suite that runs all its files is reached by every test of it, beside the part that lists the test', () => {
    const launches: Launch[] = [
      {
        label: 'part-a',
        kind: 'plain',
        suite: 'suite-parts',
        files: ['alpha.test.ts'],
      },
      {label: 'whole', kind: 'plain', suite: 'suite-parts'},
      {label: 'runner-whole', runner: 'runner', suite: 'suite-parts'},
    ];
    deepStrictEqual(
      [
        'tests/acceptance/suite-parts/alpha.test.ts',
        'tests/acceptance/suite-parts/gamma.test.ts',
      ].map(changed => selectLaunches([changed], launches).labels),
      [
        ['part-a', 'whole', 'runner-whole'],
        ['whole', 'runner-whole'],
      ],
    );
  });

  it("the containers suite's two parts in the real table: a test of either part selects that part alone", () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    deepStrictEqual(
      [
        'tests/acceptance/containers/attach-command.test.ts',
        'tests/acceptance/containers/reuse.test.ts',
      ].map(changed => selectLaunches([changed], launches).labels),
      [['containers-a'], ['containers-b']],
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
      ['explorer-one', 'containers-one', 'containers-two', 'containers-three'],
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
      [
        'containers-one',
        'containers-two',
        'containers-three',
        'containers-new',
      ],
    );
  });

  it('names, per selected launch, the changed path that selected it', () => {
    deepStrictEqual(
      selectLaunches(['packages/remote-containers/src/a.ts'], LAUNCHES).reasons,
      [
        'containers-one: packages/remote-containers/src/a.ts',
        'containers-two: packages/remote-containers/src/a.ts',
        'containers-three: packages/remote-containers/src/a.ts',
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
      ['none', 'all', 'containers-one,containers-two,containers-three'],
    );
  });

  it('an empty change reaches no launch', () => {
    strictEqual(labelsFor().length, 0);
  });
});

describe('acceptance-select: the parts of a test-only change (card tooling-159)', () => {
  /** A table with a suite run in two parts by its files, a suite run whole, and a runner launch. */
  const TABLE: Launch[] = [
    {label: 'local', runner: 'runner', suite: 'suite-local'},
    {
      label: 'big-a',
      kind: 'plain',
      suite: 'big',
      files: ['a.test.ts', 'b.test.ts'],
      partOf: 'big',
    },
    {
      label: 'big-b',
      kind: 'plain',
      suite: 'big',
      files: ['c.test.ts'],
      partOf: 'big',
    },
    {label: 'whole', kind: 'plain', suite: 'whole'},
  ];
  /** The parts of `changed` over the table, every file existing. */
  function partsFor(...changed: string[]) {
    return narrowedParts(changed, TABLE, () => true);
  }
  /** A file part of `launches`. */
  function filePart(launches: string) {
    return {name: launches, launches, minutes: FILE_PART_MINUTES};
  }

  it('tooling-159: each changed test file runs alone in the part that lists it, or in its whole-suite launch, then the smoke part', () => {
    deepStrictEqual(
      partsFor(
        'tests/acceptance/big/c.test.ts',
        'tests/acceptance/big/a.test.ts',
        'tests/acceptance/whole/w.test.ts',
      ),
      [
        filePart('big-b:c.test.ts'),
        filePart('big-a:a.test.ts'),
        filePart('whole:w.test.ts'),
        SMOKE_PART,
      ],
    );
  });

  it('tooling-159: documentation and unit tests beside the test files run nothing more, and alone they run nothing', () => {
    deepStrictEqual(
      [
        partsFor(
          'docs/architecture/catalogue/coverage-containers-r2.tsv',
          'packages/remote-ssh/test/unit/hint-recorder.test.ts',
          'tests/acceptance/whole/w.test.ts',
        ),
        partsFor('docs/notes.md'),
      ],
      [[filePart('whole:w.test.ts'), SMOKE_PART], []],
    );
  });

  it('tooling-159: a removed test file runs nowhere, and a change that only removes test files runs the smoke part alone', () => {
    deepStrictEqual(
      [
        narrowedParts(
          [
            'tests/acceptance/big/a.test.ts',
            'tests/acceptance/whole/w.test.ts',
          ],
          TABLE,
          file => file !== 'tests/acceptance/big/a.test.ts',
        ),
        narrowedParts(['tests/acceptance/big/a.test.ts'], TABLE, () => false),
      ],
      [[filePart('whole:w.test.ts'), SMOKE_PART], [SMOKE_PART]],
    );
  });

  it('tooling-159: product code, harness files, a nested test, a runner suite and a test no part lists keep the whole selection', () => {
    deepStrictEqual(
      [
        'packages/remote-containers/src/extension.ts',
        'tests/acceptance/windows/renderer.ts',
        'tests/acceptance/big/nested/d.test.ts',
        'tests/acceptance/suite-local/one.test.ts',
        'tests/acceptance/big/new.test.ts',
        'tests/acceptance/nosuite/x.test.ts',
        'tools/acceptance-launches.ts',
      ].map(file => partsFor('tests/acceptance/whole/w.test.ts', file)),
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ],
    );
  });

  it('tooling-159: past the file-part limit, each launch runs its changed files as one part', () => {
    const files = [...Array(FILE_PARTS + 1).keys()].map(
      index => `tests/acceptance/whole/w${String(index)}.test.ts`,
    );
    deepStrictEqual(partsFor(...files, 'tests/acceptance/big/c.test.ts'), [
      filePart(`whole:${files.map(file => path.basename(file)).join('+')}`),
      filePart('big-b:c.test.ts'),
      SMOKE_PART,
    ]);
  });

  it('tooling-159: the plan of a test-only change is its narrowed parts; with the full label, or for any other change, every table part that makes a reached launch', () => {
    const tableParts = [
      {name: 'ssh 1/1', launches: 'local', minutes: 30},
      {name: 'big 1/2', launches: 'big-a:a.test.ts', minutes: 30},
      {name: 'big 2/2', launches: 'big-a:b.test.ts,big-b,whole', minutes: 40},
    ];
    const testOnly = ['tests/acceptance/whole/w.test.ts'];
    const product = [...testOnly, 'tools/acceptance-launches.ts'];
    deepStrictEqual(
      [
        planOfChange(testOnly, TABLE, tableParts, false, () => true),
        planOfChange(testOnly, TABLE, tableParts, true, () => true),
        planOfChange(product, TABLE, tableParts, false, () => true),
        planOfChange(['docs/a.md'], TABLE, tableParts, true, () => true),
      ],
      [
        {parts: [filePart('whole:w.test.ts'), SMOKE_PART]},
        {parts: [tableParts[2]]},
        {parts: tableParts},
        {parts: []},
      ],
    );
  });

  it('tooling-159: a table part that names no launch stops the plan, naming the part', () => {
    throws(
      () =>
        selectedParts({labels: ['local'], reasons: []}, TABLE, [
          {name: 'gone 1/1', launches: 'gone', minutes: 30},
        ]),
      /the part gone 1\/1: unknown launch label\(s\): gone/,
    );
  });

  it("tooling-159: the smoke part's entries name launches and a file of the repository's table", () => {
    const launches = launchesOf(REPOSITORY_ROOT);
    const chosen = chosenLaunches(launches, SMOKE_PART.launches.split(','));
    deepStrictEqual(
      typeof chosen === 'string'
        ? chosen
        : chosen.map(launch => [
            launch.label,
            launch.kind === 'plain' ? launch.files : undefined,
          ]),
      [
        ['local', undefined],
        ['remote', undefined],
        ['containers-shutdown', ['reopen-locally-lines.test.ts']],
      ],
    );
  });
});
