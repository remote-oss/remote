import {deepStrictEqual, strictEqual, throws} from 'node:assert';
import {pageAmong, pageTitleByName, pageTitleFor} from './renderer.ts';

describe('pageTitleByName', () => {
  it('containers-19: a folder window finds its page by its name, with or without the remote part of the title', () => {
    deepStrictEqual(
      [
        pageTitleByName('gate-docker', ['[gate-docker]', '[]']),
        pageTitleByName('reuse-same', [
          '[reuse-same [Dev Container: Reuse]]',
          '[reuse-same-2]',
        ]),
      ],
      ['[gate-docker]', '[reuse-same [Dev Container: Reuse]]'],
    );
  });

  it('containers-19: the local window is the empty brackets', () => {
    strictEqual(pageTitleByName('local', ['[]SSH: harness', '[]']), '[]');
  });

  it('containers-19: no title, or two, that fit the name give none', () => {
    deepStrictEqual(
      [
        pageTitleByName('empty-1', ['[]', '[x1]']),
        pageTitleByName('local', ['[]', '[]']),
      ],
      [undefined, undefined],
    );
  });
});

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

  it('coverage-25a: a percent-encoded folder name matches its decoded title', () => {
    strictEqual(
      pageTitleFor(
        {
          folders: ['file:///home/harness/my%20folder'],
          remoteName: null,
        },
        ['[my folder]', '[other]'],
      ),
      '[my folder]',
    );
  });

  it('coverage-25a: a folder name with a stray percent is kept as it is', () => {
    strictEqual(
      pageTitleFor({folders: ['file:///home/harness/100%'], remoteName: null}, [
        '[100%]',
        '[other]',
      ]),
      '[100%]',
    );
  });

  it('coverage-25a: no title that fits gives none', () => {
    deepStrictEqual(
      pageTitleFor({folders: [], remoteName: null}, ['[smoke]']),
      undefined,
    );
  });

  it('containers-40 harness: a workspace window finds its page by the workspace name, not by its folder', () => {
    deepStrictEqual(
      [
        pageTitleFor(
          {
            folders: ['file:///run/ws/app'],
            remoteName: null,
            workspaceFile: 'file:///run/ws/team.code-workspace',
          },
          ['[app]', '[team (Workspace)]'],
        ),
        pageTitleFor(
          {
            folders: ['file:///run/ws/app'],
            remoteName: 'dev-container',
            workspaceFile: 'file:///run/ws/team.code-workspace',
          },
          ['[team (Workspace) [Dev Container: Team]]', '[team-2 (Workspace)]'],
        ),
      ],
      ['[team (Workspace)]', '[team (Workspace) [Dev Container: Team]]'],
    );
  });

  it('containers-40 harness: an unsaved workspace is Untitled (Workspace), and a decoded file name is matched', () => {
    deepStrictEqual(
      [
        pageTitleFor(
          {
            folders: ['file:///run/a'],
            remoteName: null,
            workspaceFile: 'untitled:Untitled-1',
          },
          ['[a]', '[Untitled (Workspace)]'],
        ),
        pageTitleFor(
          {
            folders: ['file:///run/a'],
            remoteName: null,
            workspaceFile: 'file:///run/my%20team.code-workspace',
          },
          ['[my team (Workspace)]'],
        ),
      ],
      ['[Untitled (Workspace)]', '[my team (Workspace)]'],
    );
  });

  it('containers-40 harness: a folder window with a null workspace file matches by its folder as before', () => {
    strictEqual(
      pageTitleFor(
        {folders: ['/x/k1'], remoteName: null, workspaceFile: null},
        ['[k1]', '[k1 (Workspace)]'],
      ),
      '[k1]',
    );
  });
});

describe('pageAmong', () => {
  function pageOf(pageId: string, title = '[]') {
    return {id: pageId, type: 'page', title};
  }
  function alwaysOpen(): boolean {
    return true;
  }

  it('tooling-64: a window finds its remembered page among pages that have its title', () => {
    deepStrictEqual(
      pageAmong(
        [pageOf('p1'), pageOf('p2')],
        'local',
        new Map([['local', 'p2']]),
        alwaysOpen,
      ),
      pageOf('p2'),
    );
  });

  it('tooling-64: of two pages with one title, a window with no page of its own gets the one another open window did not remember', () => {
    deepStrictEqual(
      pageAmong(
        [pageOf('p1'), pageOf('p2')],
        'empty-1',
        new Map([['local', 'p1']]),
        alwaysOpen,
      ),
      pageOf('p2'),
    );
  });

  it('tooling-64: of three, the pages of two other open windows are left out', () => {
    deepStrictEqual(
      pageAmong(
        [pageOf('p1'), pageOf('p2'), pageOf('p3')],
        'empty-2',
        new Map([
          ['local', 'p1'],
          ['empty-1', 'p2'],
        ]),
        alwaysOpen,
      ),
      pageOf('p3'),
    );
  });

  it('tooling-64: the page of a window that is closed no longer rules a page out, so two stay ambiguous', () => {
    deepStrictEqual(
      pageAmong(
        [pageOf('p1'), pageOf('p2')],
        'empty-1',
        new Map([['local', 'p1']]),
        () => false,
      ),
      undefined,
    );
  });

  it('tooling-64: two pages that nothing was remembered for stay ambiguous', () => {
    deepStrictEqual(
      pageAmong([pageOf('p1'), pageOf('p2')], 'local', new Map(), alwaysOpen),
      undefined,
    );
  });

  it('tooling-64: the one page that fits is the window’s, even when another window remembered it', () => {
    deepStrictEqual(
      pageAmong(
        [pageOf('p1')],
        'empty-1',
        new Map([['local', 'p1']]),
        alwaysOpen,
      ),
      pageOf('p1'),
    );
  });

  it('tooling-64: no page that fits gives none', () => {
    deepStrictEqual(pageAmong([], 'local', new Map(), alwaysOpen), undefined);
  });
});
