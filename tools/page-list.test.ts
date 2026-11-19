import {deepStrictEqual, rejects} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {
  type DebugTarget,
  listedPageCount,
  localPageAmong,
  pagesDescription,
  portIn,
  waitUntilPageLeft,
} from '../tests/acceptance/windows/page-list.ts';

/** A page of the editor with the title and the id. */
function page(pageId: string, title: string): DebugTarget {
  return {id: pageId, type: 'page', title};
}

const THREE_PAGES = [
  page('local-page-0001', '[]'),
  page('labels-page-0002', '[c2623-labels [SSH: harness]]'),
  page('fresh-page-0003', '[]'),
];

/** Every window but the named ones is open. */
function allOpen(): boolean {
  return true;
}

describe('the local window’s page among several titled [] (card #2890)', () => {
  it('#2890: the page the local window remembered is its page, with another empty window’s page beside it and no agent asked', () => {
    deepStrictEqual(
      localPageAmong(
        THREE_PAGES,
        new Map([['local', 'local-page-0001']]),
        allOpen,
      )?.id,
      'local-page-0001',
    );
  });

  it('#2890: without a remembered page, the one that no other open window remembered is its page', () => {
    deepStrictEqual(
      localPageAmong(
        THREE_PAGES,
        new Map([['empty-1', 'fresh-page-0003']]),
        allOpen,
      )?.id,
      'local-page-0001',
    );
  });

  it('#2890: a page of a window that is closed is not taken, so it does not make the local window’s page certain either', () => {
    deepStrictEqual(
      localPageAmong(
        THREE_PAGES,
        new Map([['empty-1', 'fresh-page-0003']]),
        window => window !== 'empty-1',
      ),
      undefined,
    );
  });

  it('#2890, negative: two pages titled [] that nobody remembers stay ambiguous, so the caller waits and fails naming them', () => {
    deepStrictEqual(localPageAmong(THREE_PAGES, new Map(), allOpen), undefined);
  });

  it('#2890, negative: two pages that other open windows remember leave the local window none', () => {
    deepStrictEqual(
      localPageAmong(
        THREE_PAGES,
        new Map([
          ['empty-1', 'local-page-0001'],
          ['empty-2', 'fresh-page-0003'],
        ]),
        allOpen,
      ),
      undefined,
    );
  });

  it('#2890: a title that is not [] is no page of the local window', () => {
    deepStrictEqual(
      localPageAmong(
        [page('labels-page-0002', '[c2623-labels [SSH: harness]]')],
        new Map([['local', 'labels-page-0002']]),
        allOpen,
      ),
      undefined,
    );
  });
});

describe('the pages a failure names (card #2890)', () => {
  it('#2890: each page is told with the start of its id and the windows that remember it, a closed one marked', () => {
    deepStrictEqual(
      pagesDescription(
        THREE_PAGES,
        new Map([
          ['local', 'local-page-0001'],
          ['empty-6', 'fresh-page-0003'],
        ]),
        window => window !== 'empty-6',
      ),
      '[] #local-pa remembered by local; [c2623-labels [SSH: harness]] #labels-p remembered by none; [] #fresh-pa remembered by empty-6 (closed)',
    );
  });
});

describe('the port of the editor’s debugging list (card #2890)', () => {
  /** A folder that holds `contents` as the editor's port file, or none. */
  function withPortFile(
    contents: string | undefined,
    action: (folder: string) => Promise<unknown>,
  ): Promise<unknown> {
    const folder = mkdtempSync(path.join(tmpdir(), 'page-list-'));
    if (contents !== undefined) {
      writeFileSync(path.join(folder, 'DevToolsActivePort'), contents);
    }
    return action(folder).finally(() => {
      rmSync(folder, {recursive: true});
    });
  }

  it('#2890: the first line of the port file is the port, and a missing or garbled file has none', async () => {
    const found: unknown[] = [];
    for (const contents of ['41233\n/devtools/browser/x\n', undefined, 'no']) {
      await withPortFile(contents, folder => {
        found.push(portIn(path.join(folder, 'DevToolsActivePort')));
        return Promise.resolve();
      });
    }
    deepStrictEqual(found, [41233, undefined, undefined]);
  });

  it('#2890: a launch whose port cannot be read has no page count, which ends the wait for a page to leave', async () => {
    deepStrictEqual(
      await withPortFile(undefined, folder => listedPageCount(folder)),
      undefined,
    );
  });
});

describe('the wait for a closed window’s page to leave the list (card #2890)', () => {
  /** A pause that lets the wait's clock run without waiting long. */
  function pause(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 1));
  }

  /** A reading that gives `counts` in turn and then the last again, and how often it was read. */
  function reading(counts: Array<number | undefined>) {
    const state = {reads: 0};
    return {
      state,
      read: () => {
        const index = Math.min(state.reads, counts.length - 1);
        state.reads += 1;
        return Promise.resolve(counts[index]);
      },
    };
  }

  it('#2890: a page that is still listed on the first reading and gone on the third ends the wait after three readings', async () => {
    const {read, state} = reading([3, 3, 2]);
    await waitUntilPageLeft('fresh', 3, read, 5_000, pause);
    deepStrictEqual(state.reads, 3);
  });

  it('#2890: a count already below the one before the close ends the wait on the first reading', async () => {
    const {read, state} = reading([2]);
    await waitUntilPageLeft('fresh', 3, read, 5_000, pause);
    deepStrictEqual(state.reads, 1);
  });

  it('#2890: a list that cannot be read ends the wait, since nothing can be told', async () => {
    const {read, state} = reading([undefined]);
    await waitUntilPageLeft('fresh', 3, read, 5_000, pause);
    deepStrictEqual(state.reads, 1);
  });

  it('#2890, negative: a page that stays listed fails the wait naming the window and the count, and does not pass', async () => {
    const {read} = reading([3]);
    await rejects(
      waitUntilPageLeft('fresh', 3, read, 20, pause),
      /the page of window fresh was still listed 0\.02 s after the window deactivated: the editor lists 3 pages, as it did before the close/u,
    );
  });
});
