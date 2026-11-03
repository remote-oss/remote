import {deepStrictEqual} from 'node:assert';
import {
  listedVolumesOf,
  VOLUME_LIST_ARGUMENTS,
  volumeInspectArguments,
} from '../../src/explorer/listed-volumes.ts';

describe('the volumes the engine lists (card containers-168)', () => {
  it('F-0905 6.1: the queries are the quiet listing and the inspect of the names after --', () => {
    deepStrictEqual(
      [VOLUME_LIST_ARGUMENTS, volumeInspectArguments(['a', 'b'])],
      [
        ['volume', 'ls', '-q'],
        ['volume', 'inspect', '--', 'a', 'b'],
      ],
    );
  });

  it('F-0905 6.1: the volumes are the names and the text labels of the JSON array, and nothing for output that is not one of volumes', () => {
    deepStrictEqual(
      [
        listedVolumesOf(
          JSON.stringify([
            {Name: 'a', Labels: {x: '1', y: 2}},
            {Name: 'b', Labels: null},
            {Name: 'c'},
          ]),
        ),
        listedVolumesOf('[{"Labels":{}}]'),
        listedVolumesOf('{}'),
        listedVolumesOf('not json'),
        listedVolumesOf('[]'),
      ],
      [
        [
          {name: 'a', labels: {x: '1'}},
          {name: 'b', labels: {}},
          {name: 'c', labels: {}},
        ],
        undefined,
        undefined,
        undefined,
        [],
      ],
    );
  });
});
