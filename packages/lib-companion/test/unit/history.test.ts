/**
 * @fileoverview The removal of an entry's copies from the open history of one host (task-companion-03).
 */

import {deepStrictEqual} from 'node:assert';
import {
  removeFolderCopies,
  type RemovalOutcome,
  type HostHistory,
} from '../../src/index.ts';

/** The host of the card's table: the alias with three entries, two of them the same path. */
const ALIAS: HostHistory = {
  hostKey: 'Alias',
  entries: [
    {path: '/b', kind: 'folder'},
    {path: '/a', kind: 'folder'},
    {path: '/b', kind: 'folder'},
  ],
};

/** The host that must keep its entry. */
const OTHER: HostHistory = {
  hostKey: 'other',
  entries: [{path: '/b', kind: 'folder'}],
};

/** The value with every level frozen, for the row with a frozen input. */
function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const name of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[name]);
    }
  }
  return Object.freeze(value);
}

describe('removeFolderCopies (task-companion-03)', () => {
  it('F-5104.BR-13: the copies of the path on the host are removed', () => {
    deepStrictEqual(removeFolderCopies([ALIAS, OTHER], 'Alias', '/b'), {
      hosts: [
        {hostKey: 'Alias', entries: [{path: '/a', kind: 'folder'}]},
        OTHER,
      ],
      changed: true,
    });
  });

  it('F-5104.BR-3: the other host keeps its entries and the order is kept', () => {
    const outcome: RemovalOutcome = removeFolderCopies(
      [ALIAS, OTHER],
      'Alias',
      '/b',
    );
    const [aliasHost, otherHost] = outcome.hosts;
    deepStrictEqual(
      {otherHost, aliasEntries: aliasHost?.entries},
      {
        otherHost: OTHER,
        aliasEntries: [{path: '/a', kind: 'folder'}],
      },
    );
  });

  it('F-5104.BR-13 (provisional): both kinds of the same path are removed', () => {
    deepStrictEqual(
      removeFolderCopies(
        [
          {
            hostKey: 'h',
            entries: [
              {path: '/x', kind: 'folder'},
              {path: '/x', kind: 'workspace'},
            ],
          },
        ],
        'h',
        '/x',
      ),
      {
        hosts: [{hostKey: 'h', entries: []}],
        changed: true,
      },
    );
  });

  it('F-5104.BR-13: a path on no entry of the host changes nothing', () => {
    deepStrictEqual(removeFolderCopies([ALIAS], 'Alias', '/zzz'), {
      hosts: [ALIAS],
      changed: false,
    });
  });

  it('F-5104.BR-13: a host key on no host changes nothing', () => {
    deepStrictEqual(removeFolderCopies([ALIAS, OTHER], 'missing', '/b'), {
      hosts: [ALIAS, OTHER],
      changed: false,
    });
  });

  it('F-5104.BR-13: no hosts change nothing', () => {
    deepStrictEqual(removeFolderCopies([], 'Alias', '/b'), {
      hosts: [],
      changed: false,
    });
  });

  it('F-5104.BR-13: the host key in another case removes nothing', () => {
    deepStrictEqual(removeFolderCopies([ALIAS], 'alias', '/b'), {
      hosts: [ALIAS],
      changed: false,
    });
  });

  it('F-5104.BR-13: the path in another case removes nothing', () => {
    deepStrictEqual(removeFolderCopies([ALIAS], 'Alias', '/B'), {
      hosts: [ALIAS],
      changed: false,
    });
  });

  it('F-5104.BR-13: a path with a trailing separator removes nothing', () => {
    deepStrictEqual(removeFolderCopies([ALIAS], 'Alias', '/b/'), {
      hosts: [ALIAS],
      changed: false,
    });
  });

  it('F-5104.6.6: the host whose last entry is removed stays, empty', () => {
    deepStrictEqual(
      removeFolderCopies(
        [{hostKey: 'h', entries: [{path: '/only', kind: 'folder'}]}],
        'h',
        '/only',
      ),
      {
        hosts: [{hostKey: 'h', entries: []}],
        changed: true,
      },
    );
  });

  it('F-5104.BR-13: a second call on the result changes nothing', () => {
    const first = removeFolderCopies([ALIAS, OTHER], 'Alias', '/b');
    const second = removeFolderCopies(first.hosts, 'Alias', '/b');
    deepStrictEqual(
      {changed: second.changed, hosts: second.hosts},
      {changed: false, hosts: first.hosts},
    );
  });

  it('F-5104.BR-13: a frozen input is not modified', () => {
    const input = deepFreeze<HostHistory[]>([
      {
        hostKey: 'Alias',
        entries: [
          {path: '/b', kind: 'folder'},
          {path: '/a', kind: 'folder'},
          {path: '/b', kind: 'folder'},
        ],
      },
      {hostKey: 'other', entries: [{path: '/b', kind: 'folder'}]},
    ]);
    const snapshot = JSON.parse(JSON.stringify(input)) as HostHistory[];
    const outcome = removeFolderCopies(input, 'Alias', '/b');
    deepStrictEqual(
      {input, changed: outcome.changed},
      {input: snapshot, changed: true},
    );
  });
});
