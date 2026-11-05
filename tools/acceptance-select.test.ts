/**
 * @fileoverview acceptance-select: the launches of the VSCodium run a change can reach.
 */

import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {type Launch, launchesOf} from './acceptance-launches.ts';
import {
  FILE_PART_MINUTES,
  FILE_PARTS,
  launchesInput,
  narrowedParts,
  partsOf,
  planOfChange,
  PULL_REQUEST_LAUNCHES,
  PULL_REQUEST_MINUTES,
  pullRequestPlan,
  selectLaunches,
  SMOKE_PART,
  workflowParts,
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

  describe('the parts of the VSCodium job a merge to main needs (post-merge run)', () => {
    /** Parts of the fixture table, as ci.yml writes its own: labels, and a part made of two. */
    const PARTS = [
      'local,remote',
      'explorer-one',
      'containers-one,containers-two',
      'containers-three',
    ];

    it('a selection of every launch needs every part, each as it is written', () => {
      deepStrictEqual(
        partsOf(
          selectLaunches(['tools/acceptance.ts'], LAUNCHES),
          LAUNCHES,
          PARTS,
        ),
        PARTS,
      );
    });

    it('a part with some of its launches selected gives those labels, and a part with none is left out', () => {
      deepStrictEqual(
        partsOf(
          {labels: ['containers-two', 'containers-three'], reasons: []},
          LAUNCHES,
          PARTS,
        ),
        ['containers-two', 'containers-three'],
      );
    });

    it('a selection of no launch needs no part, and a launch in no part is left out', () => {
      deepStrictEqual(
        [
          partsOf(selectLaunches(['docs/a.md'], LAUNCHES), LAUNCHES, PARTS),
          partsOf(
            {labels: ['trust-one', 'windows'], reasons: []},
            LAUNCHES,
            PARTS,
          ),
        ],
        [[], []],
      );
    });

    it('a part that names no launch is an error naming the part', () => {
      throws(
        () => partsOf({labels: ['local'], reasons: []}, LAUNCHES, ['gone']),
        /ci.yml's part gone: unknown launch label\(s\): gone/,
      );
    });

    it("ci.yml's own parts are read from its VSCodium matrix", () => {
      deepStrictEqual(
        workflowParts(
          readFileSync(
            path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
            'utf8',
          ),
        ),
        [
          '@ssh,!ssh-core,!windows,!cli-path',
          'ssh-core,windows',
          'containers-a',
          'containers-b',
          '@containers,!containers',
          '@explorer,!explorer-folders',
          'explorer-folders',
          '@hosts',
        ],
      );
    });

    it('a workflow whose VSCodium job names no parts is an error', () => {
      throws(() => workflowParts('jobs: {}'), /names no parts/);
    });

    it("the repository's launches: the two containers parts stay two parts, and every launch needs ci.yml's eight as written", () => {
      const launches = launchesOf(REPOSITORY_ROOT);
      const parts = workflowParts(
        readFileSync(
          path.join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'),
          'utf8',
        ),
      );
      deepStrictEqual(
        [
          partsOf(
            {labels: ['containers-a', 'containers-b'], reasons: []},
            launches,
            parts,
          ),
          partsOf(
            selectLaunches(['tools/acceptance.ts'], launches),
            launches,
            parts,
          ),
        ],
        [['containers-a', 'containers-b'], parts],
      );
    });
  });
});

describe('acceptance-select: the plan of a pull request (card tooling-120)', () => {
  /** Parts over the fixture table that leave `windows` out, as the genuine group is left out of the real one. */
  const PARTS = [
    'local,remote',
    'explorer-one,trust-one',
    'containers-one,containers-two,containers-three',
  ];
  /** A selection of `labels`, with no reasons. */
  function selectionOf(...labels: string[]) {
    return {labels, reasons: []};
  }
  /** `count` launches of a table of that many, all in one part. */
  function wideTable(count: number): {launches: Launch[]; parts: string[]} {
    const launches: Launch[] = [...Array(count).keys()].map(index => ({
      label: `wide-${String(index)}`,
      runner: 'runner',
      suite: 'suite-local',
    }));
    return {launches, parts: [launches.map(launch => launch.label).join(',')]};
  }

  it('tooling-120: no selected launch runs nothing, with no notice', () => {
    deepStrictEqual(pullRequestPlan(selectionOf(), LAUNCHES, PARTS, false), {
      parts: [],
    });
  });

  it('tooling-120: a launch in no part, as the genuine ones are, is left out', () => {
    deepStrictEqual(
      pullRequestPlan(selectionOf('windows', 'local'), LAUNCHES, PARTS, false),
      {parts: [{launches: 'local', minutes: PULL_REQUEST_MINUTES}]},
    );
  });

  it('tooling-120: up to the limit, every selected launch runs, with or without the full label, in the same 360 minutes', () => {
    const {launches, parts} = wideTable(PULL_REQUEST_LAUNCHES);
    const selection = selectionOf(...launches.map(launch => launch.label));
    const planned = {
      parts: [
        {
          launches: launches.map(launch => launch.label).join(','),
          minutes: PULL_REQUEST_MINUTES,
        },
      ],
    };
    deepStrictEqual(
      [true, false].map(full =>
        pullRequestPlan(selection, launches, parts, full),
      ),
      [planned, planned],
    );
  });

  it('tooling-120: over the limit without the label, nothing runs and the notice names the launches', () => {
    const {launches, parts} = wideTable(PULL_REQUEST_LAUNCHES + 1);
    const labels = launches.map(launch => launch.label);
    deepStrictEqual(
      pullRequestPlan(selectionOf(...labels), launches, parts, false),
      {
        parts: [],
        notice: `this change selects ${String(labels.length)} launches, more than the ${String(PULL_REQUEST_LAUNCHES)} a pull request runs by itself: ${labels.join(', ')}. Run them at this head with a dispatch, or with the acceptance-full label.`,
      },
    );
  });

  it('tooling-120: over the limit with the full label, the whole selection runs in 360 minutes', () => {
    const {launches, parts} = wideTable(PULL_REQUEST_LAUNCHES + 1);
    const labels = launches.map(launch => launch.label);
    deepStrictEqual(
      pullRequestPlan(selectionOf(...labels), launches, parts, true),
      {parts: [{launches: labels.join(','), minutes: 360}]},
    );
  });

  it('tooling-120: a part the table cannot resolve stops the plan', () => {
    throws(
      () =>
        pullRequestPlan(
          selectionOf('local'),
          LAUNCHES,
          ['no-such-launch'],
          false,
        ),
      /ci\.yml's part no-such-launch/,
    );
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
    return {launches, minutes: FILE_PART_MINUTES};
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

  it('tooling-159: a removed test file runs nowhere', () => {
    deepStrictEqual(
      narrowedParts(
        ['tests/acceptance/big/a.test.ts', 'tests/acceptance/whole/w.test.ts'],
        TABLE,
        file => file !== 'tests/acceptance/big/a.test.ts',
      ),
      [filePart('whole:w.test.ts'), SMOKE_PART],
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

  it('tooling-159: the plan of a test-only change is its narrowed parts, and the full label or any other change gives the whole selection', () => {
    const parts = ['local', 'big-a,big-b,whole'];
    const testOnly = ['tests/acceptance/whole/w.test.ts'];
    const product = [...testOnly, 'tools/acceptance-launches.ts'];
    const whole = {
      parts: [
        {launches: 'local,big-a,big-b,whole', minutes: PULL_REQUEST_MINUTES},
      ],
    };
    deepStrictEqual(
      [
        planOfChange(testOnly, TABLE, parts, false, () => true),
        planOfChange(testOnly, TABLE, parts, true, () => true),
        planOfChange(product, TABLE, parts, false, () => true),
      ],
      [
        {parts: [filePart('whole:w.test.ts'), SMOKE_PART]},
        {parts: [{launches: 'whole', minutes: PULL_REQUEST_MINUTES}]},
        whole,
      ],
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
