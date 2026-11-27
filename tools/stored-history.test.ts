import {deepStrictEqual} from 'node:assert';
import {
  storedPathsOf,
  type StoredFile,
} from '../tests/acceptance/windows/stored-history.ts';

const EARLIER = '11111111-1111-4111-8111-111111111111';
const LATER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

/** A file named `name` holding `events`. */
function fileOf(name: string, ...events: unknown[]): StoredFile {
  return {name, text: JSON.stringify({events})};
}

/** An event of `path` under `host`. */
function event(host: string, path: string, kind: string, time: number) {
  return {host, entry: {path, kind: 'folder'}, kind, time};
}

describe('the stored folder history of a host (#2757, #3095, #3139)', () => {
  it('#3095: the paths of a host under a scope over every window’s file, most recent first, a removed one left out', () => {
    const files = [
      fileOf(
        `${EARLIER}.json`,
        event('b', '/h/c102-c1', 'opened', 1),
        event('a', '/h/c102-c9', 'opened', 2),
        event('b', '/h/other', 'opened', 3),
      ),
      fileOf(
        'aaaaaaaa-0000-4000-8000-000000000000.json',
        event('b', '/h/c102-c2', 'opened', 4),
        event('b', '/h/c102-c3', 'opened', 5),
      ),
      fileOf(`${LATER}.json`, event('b', '/h/c102-c3', 'removed', 6), {
        entry: {},
      }),
    ];
    deepStrictEqual(
      [
        storedPathsOf(files, 'b', '/h/c102-c'),
        storedPathsOf(files, 'c', '/h/c102-c'),
        storedPathsOf([{name: `${EARLIER}.json`, text: '{}'}], 'b', '/h/c'),
        storedPathsOf([], 'b', '/h/c102-c'),
      ],
      [['/h/c102-c2', '/h/c102-c1'], [], [], []],
    );
  });

  it('#3139: two events of one path at one time are decided by the later session, whichever file is read first', () => {
    const opened = fileOf(`${EARLIER}.json`, event('b', '/h/x', 'opened', 7));
    const removed = fileOf(`${LATER}.json`, event('b', '/h/x', 'removed', 7));
    const reopened = fileOf(`${LATER}.json`, event('b', '/h/x', 'opened', 7));
    const dropped = fileOf(`${EARLIER}.json`, event('b', '/h/x', 'removed', 7));
    deepStrictEqual(
      [
        storedPathsOf([opened, removed], 'b', '/h/'),
        storedPathsOf([removed, opened], 'b', '/h/'),
        storedPathsOf([reopened, dropped], 'b', '/h/'),
        storedPathsOf([dropped, reopened], 'b', '/h/'),
      ],
      [[], [], ['/h/x'], ['/h/x']],
    );
  });

  it('#3139: two paths opened at one time are listed with the later session first', () => {
    const files = [
      fileOf(`${EARLIER}.json`, event('b', '/h/a', 'opened', 9)),
      fileOf(`${LATER}.json`, event('b', '/h/z', 'opened', 9)),
    ];
    deepStrictEqual(storedPathsOf(files, 'b', '/h/'), ['/h/z', '/h/a']);
  });

  it('#3139: a claim is read as its session’s file, so its events decide as that session’s', () => {
    const files = [
      fileOf(`${LATER}.json`, event('b', '/h/x', 'opened', 5)),
      fileOf(`${EARLIER}.claim-0a1b2c3d4e5f`, event('b', '/h/x', 'removed', 8)),
      fileOf(`${EARLIER}.claim-0a1b2c3d4e5f`, event('b', '/h/y', 'opened', 2)),
    ];
    deepStrictEqual(storedPathsOf(files, 'b', '/h/'), ['/h/y']);
  });

  it('#3139: a write not yet renamed, and a name that is none of a session’s, are not read', () => {
    const files = [
      fileOf(
        `${LATER}.json.tmp-0a1b2c3d4e5f`,
        event('b', '/h/temp', 'opened', 9),
      ),
      fileOf('notes.json', event('b', '/h/other', 'opened', 9)),
      fileOf(`${EARLIER}.json`, event('b', '/h/kept', 'opened', 1)),
    ];
    deepStrictEqual(storedPathsOf(files, 'b', '/h/'), ['/h/kept']);
  });
});
