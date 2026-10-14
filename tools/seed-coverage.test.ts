import {deepStrictEqual, throws} from 'node:assert';
import {
  bodyOf,
  byCriterion,
  issueNumbersOf,
  type Program,
  scopeNamed,
  seedFor,
  seedOf,
} from './seed-coverage.ts';
import {
  CONTAINERS_RELEASE_ONE_SCOPE,
  EXPLORER_SLICE_ONE_FEATURES,
  EXPLORER_SLICE_ONE_SCOPE,
  SLICE_ONE_FEATURES,
  SLICE_ONE_SCOPE,
} from './spec-acceptance-criteria.ts';

describe('seed-coverage', () => {
  it('#142: gives every criterion the tag todo and no reason', () => {
    deepStrictEqual(
      seedOf(['F-2601.AC-1']),
      'ac\ttag\treason\nF-2601.AC-1\ttodo\t\n',
    );
  });

  it('#142: sorts by feature and then by number, not by text', () => {
    deepStrictEqual(
      seedOf(['F-2601.AC-12', 'F-2601.AC-3', 'F-2001.AC-5']).split('\n'),
      [
        'ac\ttag\treason',
        'F-2001.AC-5\ttodo\t',
        'F-2601.AC-3\ttodo\t',
        'F-2601.AC-12\ttodo\t',
        '',
      ],
    );
  });

  it('#142: puts a later feature after an earlier one', () => {
    deepStrictEqual(byCriterion('F-2602.AC-1', 'F-2601.AC-9') > 0, true);
  });

  it('#142: puts an earlier feature before a later one', () => {
    deepStrictEqual(byCriterion('F-2001.AC-9', 'F-2601.AC-1') < 0, true);
  });

  it('tooling coverage-25a: issueNumbersOf keeps every row that has an issue, with its repository', () => {
    deepStrictEqual(
      issueNumbersOf(
        'id\tissue\trepo\nF-2001\t11\tremote-ssh\nF-5101\t12\tremote-explorer\n',
      ),
      new Map([
        ['F-2001', {repository: 'remote-oss/remote-ssh', issue: 11}],
        ['F-5101', {repository: 'remote-oss/remote-explorer', issue: 12}],
      ]),
    );
  });

  it('tooling coverage-25a: a row without an issue is not in the map', () => {
    deepStrictEqual(
      [
        ...issueNumbersOf(
          'id\tissue\trepo\nF-2001\t11\tremote-ssh\nF-2002\t\tremote-ssh\n',
        ),
      ],
      [['F-2001', {repository: 'remote-oss/remote-ssh', issue: 11}]],
    );
  });

  /** A program that answers `gh issue view` with the body written for the issue number it was asked about. */
  function issuesAnswering(bodies: Record<string, string>): Program {
    return (...given) => ({
      status: 0,
      stdout: bodies[given[1][2] ?? ''] ?? '',
      stderr: '',
    });
  }

  /** A program that answers nothing and records each command line it is given in `asked`. */
  function recording(asked: string[][]): Program {
    return (name, programArguments) => {
      asked.push([name, ...programArguments]);
      return {status: 0, stdout: '', stderr: ''};
    };
  }

  it('#142: asks gh for the body of the issue in the Remote - SSH repository', () => {
    const asked: string[][] = [];
    bodyOf(7, 'remote-oss/remote-ssh', recording(asked));
    deepStrictEqual(asked, [
      [
        'gh',
        'issue',
        'view',
        '7',
        '-R',
        'remote-oss/remote-ssh',
        '--json',
        'body',
        '--jq',
        '.body',
      ],
    ]);
  });

  it('#142: gives the body gh answered', () => {
    deepStrictEqual(
      bodyOf(7, 'remote-oss/remote-ssh', () => ({
        status: 0,
        stdout: 'the body',
        stderr: '',
      })),
      'the body',
    );
  });

  it('#142: a gh that fails throws with its message', () => {
    throws(
      () =>
        bodyOf(7, 'remote-oss/remote-ssh', () => ({
          status: 1,
          stdout: '',
          stderr: 'no access\n',
        })),
      {message: 'gh issue view 7: no access'},
    );
  });

  it('#142: seeds the criteria of every feature of the slice from its issue', () => {
    const catalogue = [
      'id\tissue\trepo',
      ...SLICE_ONE_FEATURES.map(
        (feature, index) => `${feature}\t${String(index + 100)}\tremote-ssh`,
      ),
    ].join('\n');
    deepStrictEqual(
      seedFor(
        catalogue,
        issuesAnswering({
          '100': '- **F-2001.AC-1** one\n- **F-2001.AC-2** two',
          '101': '- **F-2101.AC-1** one',
        }),
      ),
      'ac\ttag\treason\nF-2001.AC-1\ttodo\t\nF-2001.AC-2\ttodo\t\nF-2101.AC-1\ttodo\t\n',
    );
  });

  it('#142: a feature the catalogue lacks throws', () => {
    throws(() => seedFor('id\tissue\trepo\n', issuesAnswering({})), {
      message: 'F-2001 is not in the catalogue',
    });
  });

  it('containers release 1: orders AC-3, AC-3b, AC-4 by number, then letter', () => {
    deepStrictEqual(
      ['F-0101.AC-4', 'F-0101.AC-3b', 'F-0101.AC-3'].sort(byCriterion),
      ['F-0101.AC-3', 'F-0101.AC-3b', 'F-0101.AC-4'],
    );
  });

  it('tooling coverage-25a: the explorer set seeds each feature from its own repository', () => {
    const features = EXPLORER_SLICE_ONE_FEATURES;
    const catalogue = [
      'id\tissue\trepo',
      ...features.map(
        (feature, index) =>
          `${feature}\t${String(index + 300)}\t${feature === 'F-2503' ? 'remote-ssh' : 'remote-explorer'}`,
      ),
    ].join('\n');
    const repositories: string[] = [];
    /** A program that answers each issue with one criterion of its feature, recording the repository asked in. */
    function answering(): Program {
      return (name, programArguments) => {
        const feature = features[Number(programArguments[2]) - 300] ?? '';
        repositories.push(programArguments[4] ?? '');
        return {
          status: 0,
          stdout: `- **${feature}.AC-1** one`,
          stderr: '',
        };
      };
    }
    const seeded = seedFor(catalogue, answering(), EXPLORER_SLICE_ONE_SCOPE);
    deepStrictEqual(
      [seeded, repositories],
      [
        `ac\ttag\treason\n${features
          .map(feature => `${feature}.AC-1\ttodo\t\n`)
          .join('')}`,
        [
          'remote-oss/remote-ssh',
          ...features.slice(1).map(() => 'remote-oss/remote-explorer'),
        ],
      ],
    );
  });

  it('containers release 1: a letter after the same number sorts after the bare number, both ways round', () => {
    deepStrictEqual(
      [
        byCriterion('F-0101.AC-3b', 'F-0101.AC-3') > 0,
        byCriterion('F-0101.AC-3', 'F-0101.AC-3b') < 0,
      ],
      [true, true],
    );
  });

  it('containers release 1: the same id twice is equal', () => {
    deepStrictEqual(byCriterion('F-0101.AC-3b', 'F-0101.AC-3b'), 0);
  });

  it('tooling coverage-25a: bodyOf asks gh for the issue in the repository given', () => {
    const asked: string[][] = [];
    bodyOf(10, 'remote-oss/remote-explorer', recording(asked));
    deepStrictEqual(asked[0]?.slice(4, 6), [
      '-R',
      'remote-oss/remote-explorer',
    ]);
  });

  it('tooling coverage-25a: a set restricted to one feature seeds only its criteria, from its repository', () => {
    const asked: string[][] = [];
    const catalogue = 'id\tissue\trepo\nF-5101\t12\tremote-explorer\n';
    /** A program that answers the issue with the two criteria, recording the command line. */
    function answering(): Program {
      return (name, programArguments) => {
        asked.push([name, ...programArguments]);
        return {
          status: 0,
          stdout: '- **F-5101.AC-1** one\n- **F-5101.AC-2** two',
          stderr: '',
        };
      };
    }
    deepStrictEqual(
      [
        seedFor(catalogue, answering(), {
          ...EXPLORER_SLICE_ONE_SCOPE,
          features: ['F-5101'],
        }),
        asked[0]?.slice(4, 6),
      ],
      [
        'ac\ttag\treason\nF-5101.AC-1\ttodo\t\nF-5101.AC-2\ttodo\t\n',
        ['-R', 'remote-oss/remote-explorer'],
      ],
    );
  });

  it('containers release 1: seeds the containers file from the containers repository', () => {
    const asked: string[] = [];
    const catalogue = [
      'id\tissue\trepo',
      ...CONTAINERS_RELEASE_ONE_SCOPE.features.map(
        (feature, index) =>
          `${feature}\t${String(index + 200)}\tremote-containers`,
      ),
    ].join('\n');
    const seeded = seedFor(
      catalogue,
      (...given) => {
        asked.push(given[1][4] ?? '');
        return {
          status: 0,
          stdout:
            given[1][2] === '200'
              ? '- **F-0101.AC-3b** b\n- **F-0101.AC-3** a'
              : '',
          stderr: '',
        };
      },
      CONTAINERS_RELEASE_ONE_SCOPE,
    );
    deepStrictEqual(
      [seeded, [...new Set(asked)]],
      [
        'ac\ttag\treason\nF-0101.AC-3\ttodo\t\nF-0101.AC-3b\ttodo\t\n',
        ['remote-oss/remote-containers'],
      ],
    );
  });

  it('containers release 1: no name picks the first slice, containers-r1 the containers file', () => {
    deepStrictEqual(
      [scopeNamed(undefined), scopeNamed('containers-r1')],
      [SLICE_ONE_SCOPE, CONTAINERS_RELEASE_ONE_SCOPE],
    );
  });

  it('containers release 1: an unknown name throws', () => {
    throws(() => scopeNamed('nothing'), {
      message: 'no coverage set named nothing',
    });
  });
});
