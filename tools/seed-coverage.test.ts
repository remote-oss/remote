import {deepStrictEqual, throws} from 'node:assert';
import {
  bodyOf,
  byCriterion,
  issueNumbersOf,
  type Program,
  seedFor,
  seedOf,
} from './seed-coverage.ts';
import {SLICE_ONE_FEATURES} from './spec-acceptance-criteria.ts';

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

  it('#142: reads the issue number of each Remote - SSH feature from the catalogue', () => {
    deepStrictEqual(
      issueNumbersOf(
        'id\tissue\trepo\nF-2001\t11\tremote-ssh\nF-0101\t19\tremote-containers\nF-2101\t19\tremote-ssh\n',
      ),
      new Map([
        ['F-2001', 11],
        ['F-2101', 19],
      ]),
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

  it('#142: asks gh for the body of the issue in the Remote - SSH repository', () => {
    const asked: string[][] = [];
    bodyOf(7, (name, programArguments) => {
      asked.push([name, ...programArguments]);
      return {status: 0, stdout: '', stderr: ''};
    });
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
      bodyOf(7, () => ({status: 0, stdout: 'the body', stderr: ''})),
      'the body',
    );
  });

  it('#142: a gh that fails throws with its message', () => {
    throws(
      () => bodyOf(7, () => ({status: 1, stdout: '', stderr: 'no access\n'})),
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
});
