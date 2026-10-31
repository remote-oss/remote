import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {manifestStoreOf} from '../../src/features/manifest-store.ts';

describe('the kept control manifest (card containers-94)', () => {
  it('#1307: nothing is kept in a folder that does not exist, and a kept copy comes back with the time it was kept at', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'manifest-store-'));
    try {
      const store = manifestStoreOf(path.join(root, 'storage'));
      const before = store.kept();
      store.keep('{"disallowedFeatures":[]}', 1_700_000_000_000);
      deepStrictEqual(
        [before, store.kept()],
        [
          undefined,
          {text: '{"disallowedFeatures":[]}', keptAt: 1_700_000_000_000},
        ],
      );
    } finally {
      rmSync(root, {recursive: true, force: true});
    }
  });
});
