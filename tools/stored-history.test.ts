import {deepStrictEqual} from 'node:assert';
import {storedPathsOf} from '../tests/acceptance/windows/stored-history.ts';

/** A window's file holding `events`. */
function fileOf(...events: unknown[]): string {
  return JSON.stringify({events});
}

/** An event of `path` under `host`. */
function event(host: string, path: string, kind: string, time: number) {
  return {host, entry: {path, kind: 'folder'}, kind, time};
}

describe('the stored folder history of a host (#2757, #3095)', () => {
  it('#3095: the paths of a host under a scope over every window’s file, most recent first, a removed one left out', () => {
    const files = [
      fileOf(
        event('b', '/h/c102-c1', 'opened', 1),
        event('a', '/h/c102-c9', 'opened', 2),
        event('b', '/h/other', 'opened', 3),
      ),
      fileOf(
        event('b', '/h/c102-c2', 'opened', 4),
        event('b', '/h/c102-c3', 'opened', 5),
      ),
      fileOf(event('b', '/h/c102-c3', 'removed', 6), {entry: {}}),
    ];
    deepStrictEqual(
      [
        storedPathsOf(files, 'b', '/h/c102-c'),
        storedPathsOf(files, 'c', '/h/c102-c'),
        storedPathsOf(['{}'], 'b', '/h/c102-c'),
        storedPathsOf([], 'b', '/h/c102-c'),
      ],
      [['/h/c102-c2', '/h/c102-c1'], [], [], []],
    );
  });
});
