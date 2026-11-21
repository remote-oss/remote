import {deepStrictEqual} from 'node:assert';
import {storedPathsOf} from '../tests/acceptance/windows/stored-history.ts';

const STORED = JSON.stringify({
  'folder.history.v1': {
    hosts: [
      {
        hostKey: 'a',
        entries: [{path: '/h/c102-c9', kind: 'folder'}],
      },
      {
        hostKey: 'b',
        entries: [
          {path: '/h/c102-c2', kind: 'folder'},
          {path: '/h/other', kind: 'folder'},
          {path: '/h/c102-c1', kind: 'folder'},
        ],
      },
    ],
  },
});

describe('the stored folder history of a host (#2757)', () => {
  it('#2757: the stored paths of a host under a scope, most recent first, and none for a host or a value the history lacks', () => {
    deepStrictEqual(
      [
        storedPathsOf(STORED, 'b', '/h/c102-c'),
        storedPathsOf(STORED, 'c', '/h/c102-c'),
        storedPathsOf('{}', 'b', '/h/c102-c'),
      ],
      [['/h/c102-c2', '/h/c102-c1'], [], []],
    );
  });
});
