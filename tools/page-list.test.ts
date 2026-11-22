import {deepStrictEqual} from 'node:assert';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {createServer, type ServerResponse} from 'node:http';
import type {AddressInfo} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {NoAnswerError} from '../tests/acceptance/windows/page-protocol.ts';
import {
  type DebugTarget,
  type CloseAttempt,
  closeUntilGone,
  lingeringPageNote,
  listedPages,
  listedTargets,
  localPageAmong,
  pagesDescription,
  pagesOfNoOpenWindow,
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

describe('the bound of what a failure names of the pages (card #2890)', () => {
  const MANY = Array.from({length: 20}, (unused, index) =>
    page(`page-id-${String(index).padStart(4, '0')}`, `[${'t'.repeat(200)}]`),
  );

  it('#2890: twenty pages with long titles read as twelve, each title cut at 80 characters, with an `and 8 more` tail, and the line stays under its bound', () => {
    const description = pagesDescription(MANY, new Map(), allOpen);
    deepStrictEqual(
      [
        description.split('; ').length,
        description.endsWith('; and 8 more'),
        description.length < 12 * 140 + 20,
      ],
      [13, true, true],
    );
  });

  it('#2890: a page that many windows remember is told with four of them, their names cut at 40 characters, and the count of the rest', () => {
    const owners = new Map(
      Array.from({length: 7}, (unused, index): [string, string] => [
        `window-${String(index)}-${'n'.repeat(60)}`,
        'page-id-0000',
      ]),
    );
    const description = pagesDescription(
      [MANY[0] ?? page('x', '[]')],
      owners,
      allOpen,
    );
    deepStrictEqual(
      [description.includes(' and 3 more'), description.length < 12 * 140 + 20],
      [true, true],
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

  it('#2890: a launch whose port cannot be read has no page list, which ends the wait for a page to leave', async () => {
    deepStrictEqual(
      await withPortFile(undefined, folder => listedPages(folder)),
      undefined,
    );
  });
});

describe('the wait for a closed window’s page to leave the list (card #2890)', () => {
  /** A pause that lets the wait's clock run without waiting long. */
  function pause(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 1));
  }

  /** A reading that gives the lists of page ids in `pages` in turn and then the last again, and how often it was read. */
  function reading(pages: Array<string[] | undefined>) {
    const state = {reads: 0};
    return {
      state,
      read: () => {
        const index = Math.min(state.reads, pages.length - 1);
        state.reads += 1;
        return Promise.resolve(pages[index]?.map(pageId => page(pageId, '[]')));
      },
    };
  }

  it('#2890: the window’s own page, still listed on the first two readings and gone on the third, ends the wait after three readings', async () => {
    const {read, state} = reading([
      ['own', 'other'],
      ['own', 'other'],
      ['other'],
    ]);
    const waited = await waitUntilPageLeft('fresh', 'own', read, 5_000, pause);
    deepStrictEqual([waited, state.reads], [{state: 'left'}, 3]);
  });

  it('#2890: a window that opens meanwhile, with the count above what it was, does not end the wait while the window’s own page is listed', async () => {
    const {read, state} = reading([
      ['own', 'other'],
      ['own', 'other', 'opened'],
      ['own', 'other', 'opened'],
      ['other', 'opened'],
    ]);
    const waited = await waitUntilPageLeft('fresh', 'own', read, 5_000, pause);
    deepStrictEqual([waited, state.reads], [{state: 'left'}, 4]);
  });

  it('#2890: a window that closes meanwhile, with the count below what it was, does not end the wait early while the window’s own page is listed', async () => {
    const {read, state} = reading([
      ['own', 'other', 'closing'],
      ['own', 'other'],
      ['own'],
      [],
    ]);
    const waited = await waitUntilPageLeft('fresh', 'own', read, 5_000, pause);
    deepStrictEqual([waited, state.reads], [{state: 'left'}, 4]);
  });

  it('#2890: a page that is not listed on the first reading ends the wait on it', async () => {
    const {read, state} = reading([['other']]);
    const waited = await waitUntilPageLeft('fresh', 'own', read, 5_000, pause);
    deepStrictEqual([waited, state.reads], [{state: 'left'}, 1]);
  });

  it('#2890: a list that cannot be read ends the wait, since nothing can be told', async () => {
    const {read, state} = reading([undefined]);
    const waited = await waitUntilPageLeft('fresh', 'own', read, 5_000, pause);
    deepStrictEqual([waited, state.reads], [{state: 'left'}, 1]);
  });

  it('#2890: a page that stays listed, whatever else comes and goes, ends the wait with a note naming the window, the page and the list, and does not throw', async () => {
    const {read} = reading([['own-page-0001', 'other'], ['own-page-0001']]);
    deepStrictEqual(
      await waitUntilPageLeft('fresh', 'own-page-0001', read, 20, pause),
      {
        state: 'stayed',
        note: 'the page of window fresh (#own-page) was still listed 0.02 s after the window deactivated: the editor lists 1 pages',
        listed: [page('own-page-0001', '[]')],
      },
    );
  });

  it('#2890: the note of a lingering page names the window, the start of the page id, the seconds and how many pages the editor lists', () => {
    deepStrictEqual(
      lingeringPageNote('c50-generic', '15D82FFDAB', 2, 30_000),
      'the page of window c50-generic (#15D82FFD) was still listed 30 s after the window deactivated: the editor lists 2 pages',
    );
  });
});

describe('the debugging port’s list (card #2908)', () => {
  /** A list server on a port of its own that answers each request as `answer` says; `stop` closes it. */
  async function listServer(
    answer: (response: ServerResponse) => void,
  ): Promise<{port: number; stop(): Promise<void>}> {
    const server = createServer((request, response) => {
      answer(response);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return {
      port: (server.address() as AddressInfo).port,
      stop: () =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => {
            resolve();
          });
        }),
    };
  }

  it('#2908: the targets of every type come back as the port listed them', async () => {
    const targets = [page('p1', 'one'), {id: 'f1', type: 'iframe', title: 'x'}];
    const server = await listServer(response => {
      response.end(JSON.stringify(targets));
    });
    try {
      deepStrictEqual(await listedTargets(server.port), targets);
    } finally {
      await server.stop();
    }
  });

  it('#2908: a port that accepts and does not answer fails within the bound with a failure that names the port and the list', async () => {
    const server = await listServer(() => undefined);
    try {
      const outcome = await listedTargets(server.port, 150).then(
        () => 'answered',
        (caught: unknown) => [
          String(caught).replace(String(server.port), 'PORT'),
          caught instanceof NoAnswerError,
        ],
      );
      deepStrictEqual(outcome, [
        'Error: the debugging port PORT: no answer within 0.2 s to its list of targets',
        true,
      ]);
    } finally {
      await server.stop();
    }
  });

  it('#2908: a port that answers the head and stalls the body fails within the bound too', async () => {
    const server = await listServer(response => {
      response.writeHead(200, {'content-type': 'application/json'});
      response.write('[');
    });
    try {
      deepStrictEqual(
        await listedTargets(server.port, 150).then(
          () => false,
          (caught: unknown) => caught instanceof NoAnswerError,
        ),
        true,
      );
    } finally {
      await server.stop();
    }
  });

  it('#2908: a port that refuses the connection fails with the refusal, which is no timeout', async () => {
    const server = await listServer(() => undefined);
    const {port} = server;
    await server.stop();
    deepStrictEqual(
      await listedTargets(port, 5000).then(
        () => 'answered',
        (caught: unknown) => caught instanceof NoAnswerError,
      ),
      false,
    );
  });
});

describe('the close that is sent again while the page stays and the window is open (card #2909)', () => {
  const LEFT: CloseAttempt = {state: 'left'};

  /** An attempt that gives `results` in turn, counting how often it ran. */
  function attemptsGiving(results: readonly CloseAttempt[]) {
    const counted = {runs: 0};
    return {
      counted,
      attempt: () => {
        const result = results[Math.min(counted.runs, results.length - 1)];
        counted.runs += 1;
        return Promise.resolve(result ?? LEFT);
      },
    };
  }

  function stayed(note: string): CloseAttempt {
    return {state: 'stayed', note, listed: []};
  }

  it('#2909: a close whose page leaves is made once', async () => {
    const {attempt, counted} = attemptsGiving([LEFT]);
    deepStrictEqual(
      [await closeUntilGone(attempt, () => true, 2), counted.runs],
      [{last: LEFT, tried: 1, notes: []}, 1],
    );
  });

  it('#2909: a page that stays while the window is open again is closed once more, and the second close that works ends it, with the first one’s note kept', async () => {
    const {attempt, counted} = attemptsGiving([stayed('first'), LEFT]);
    deepStrictEqual(
      [await closeUntilGone(attempt, () => true, 2), counted.runs],
      [{last: LEFT, tried: 2, notes: ['first']}, 2],
    );
  });

  it('#2909: a page that stays while the window is not open has nothing to send a close to, so the close ends with its note', async () => {
    const {attempt, counted} = attemptsGiving([stayed('first'), LEFT]);
    deepStrictEqual(
      [await closeUntilGone(attempt, () => false, 2), counted.runs],
      [{last: stayed('first'), tried: 1, notes: ['first']}, 1],
    );
  });

  it('#2909, negative: a page that stays after every close is told for each, and the closes stop at the bound instead of going on', async () => {
    const {attempt, counted} = attemptsGiving([
      stayed('first'),
      stayed('second'),
    ]);
    deepStrictEqual(
      [await closeUntilGone(attempt, () => true, 2), counted.runs],
      [{last: stayed('second'), tried: 2, notes: ['first', 'second']}, 2],
    );
  });

  it('#2936: the pages of no open window are those that no open window remembers: a closed window’s page and a page nobody remembers are left over, a page of an open window or of local is not', () => {
    function open(window: string): boolean {
      return window !== 'closed';
    }
    deepStrictEqual(
      pagesOfNoOpenWindow(
        [
          page('open-page-0001', '[c1]'),
          page('closed-page-0002', '[c2]'),
          page('local-page-0003', '[]'),
          page('nobody-page-0004', '[c4]'),
        ],
        new Map([
          ['w1', 'open-page-0001'],
          ['closed', 'closed-page-0002'],
          ['local', 'local-page-0003'],
        ]),
        open,
      ).map(each => each.id),
      ['closed-page-0002', 'nobody-page-0004'],
    );
  });

  it('#2936: the one `[]` page nobody remembers is the local window’s, as the suites that never remember it have it, and two such pages are both told', () => {
    function open(): boolean {
      return true;
    }
    const withLocal = pagesOfNoOpenWindow(
      [page('local-page-0001', '[]'), page('window-page-0002', '[c1]')],
      new Map([['w1', 'window-page-0002']]),
      open,
    ).map(each => each.id);
    const ambiguous = pagesOfNoOpenWindow(
      [page('first-page-0001', '[]'), page('second-page-0002', '[]')],
      new Map(),
      open,
    ).map(each => each.id);
    deepStrictEqual(
      [withLocal, ambiguous],
      [[], ['first-page-0001', 'second-page-0002']],
    );
  });
});
