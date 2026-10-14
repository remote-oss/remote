import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {pageTitleFor} from './renderer.ts';

describe('pageTitleFor', () => {
  it('coverage-25a: a folder window finds its page by the folder name in brackets', () => {
    strictEqual(
      pageTitleFor({folders: ['/x/k1'], remoteName: 'ssh-remote'}, [
        '[k1 [SSH: harness]]SSH: harness',
        '[k10]',
      ]),
      '[k1 [SSH: harness]]SSH: harness',
    );
  });

  it('coverage-25a: a folder-less local window finds its page at the empty brackets', () => {
    strictEqual(
      pageTitleFor({folders: [], remoteName: null}, ['[]', '[]SSH: harness']),
      '[]',
    );
  });

  it('coverage-25a: a folder-less remote window finds its page at the brackets with the remote name', () => {
    strictEqual(
      pageTitleFor({folders: [], remoteName: 'ssh-remote'}, [
        '[]',
        '[]SSH: harness',
      ]),
      '[]SSH: harness',
    );
  });

  it('coverage-25a: two titles that both fit fail, naming both', () => {
    throws(
      () =>
        pageTitleFor({folders: [], remoteName: 'ssh-remote'}, [
          '[]SSH: a',
          '[]SSH: b',
        ]),
      {message: 'two pages match the window\'s state: ["[]SSH: a","[]SSH: b"]'},
    );
  });

  it('coverage-25a: no title that fits gives none', () => {
    deepStrictEqual(
      pageTitleFor({folders: [], remoteName: null}, ['[smoke]']),
      undefined,
    );
  });
});
