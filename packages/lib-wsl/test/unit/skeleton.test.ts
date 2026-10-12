import * as assert from 'node:assert';

describe('lib-wsl', () => {
  it('loads and exports nothing yet', async () => {
    const library = await import('../../src/index.ts');
    assert.deepStrictEqual(Object.keys(library), []);
  });
});
