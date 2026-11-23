import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {approvalsOf, contentHashOf} from '../../src/preconnect/approvals.ts';
import {
  type CopyRead,
  confirmationFilesOf,
} from '../../src/preconnect/confirmation-files.ts';
import {expandedPath, programPath} from '../../src/preconnect/script-path.ts';

/** The environment of a write that is read back at once. */
const INSTANT = {
  delay: () => Promise.resolve(),
  logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
};

/** A memento that keeps what it is given, and the updates it was asked for in order. */
function mementoOf(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  const updates: Array<[string, unknown]> = [];
  return {
    values,
    updates,
    get: (key: string) => values.get(key),
    update: (key: string, value: unknown) => {
      updates.push([key, value]);
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

const SCRIPT_KEY = 'preconnectScriptConfirmed:cy5zaA==';

/** The name of the copy of `s.sh`. */
const COPY_NAME = createHash('sha256').update('s.sh').digest('hex');

/** Copies kept in memory: what they hold by name, and the writes they were asked for. */
function copiesOf(initial: Record<string, CopyRead> = {}) {
  const held = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  return {
    held,
    writes,
    read: (name: string) => held.get(name),
    write: (name: string, hash: string) => {
      writes.push([name, hash]);
      held.set(name, {kind: 'hash', hash});
      return Promise.resolve();
    },
  };
}

/** An environment whose lines the row reads. */
function loggingEnvironment() {
  const sink = new MemorySink();
  return {
    environment: {
      delay: () => Promise.resolve(),
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    lines: () => sink.lines.map(line => line.message),
  };
}

describe('the record of confirmed pre-connection scripts (card connect-87)', () => {
  it('F-2108 AC-11: the key is the prefix and the standard base64 of the path, with its padding', async () => {
    const state = mementoOf();
    const approvals = approvalsOf(state, copiesOf(), INSTANT);
    await approvals.remember('/a b/ü.sh', 'h1');
    await approvals.remember('s.sh', 'h2');
    await approvals.remember('/a/b.sh', 'h3');
    deepStrictEqual(
      [...state.values.entries()],
      [
        [
          `preconnectScriptConfirmed:${Buffer.from('/a b/ü.sh').toString('base64')}`,
          'h1',
        ],
        ['preconnectScriptConfirmed:cy5zaA==', 'h2'],
        ['preconnectScriptConfirmed:L2EvYi5zaA==', 'h3'],
      ],
    );
  });

  it('F-2108 AC-11: the stored hash of a path is given back, and a value that is not a string counts as none', () => {
    const approvals = approvalsOf(
      mementoOf({
        'preconnectScriptConfirmed:cy5zaA==': 'abc',
        'preconnectScriptConfirmed:L2EvYi5zaA==': 7,
      }),
      copiesOf(),
      INSTANT,
    );
    deepStrictEqual(
      [
        approvals.hashFor('s.sh'),
        approvals.hashFor('/a/b.sh'),
        approvals.hashFor('/other.sh'),
      ],
      ['abc', undefined, undefined],
    );
  });

  it('F-2108 AC-11: the hash of contents is the lower-case hex of their SHA-256', () => {
    const bytes = new TextEncoder().encode('echo hi\n');
    deepStrictEqual(
      contentHashOf(bytes),
      createHash('sha256').update('echo hi\n').digest('hex'),
    );
  });
});

describe('the two forms of a pre-connection script path (card connect-87)', () => {
  it('F-2108 AC-17: ~/ is replaced by the home folder and any other path stays', () => {
    deepStrictEqual(
      [
        expandedPath('~/bin/x.sh', '/home/alex'),
        expandedPath('/abs/x.sh', '/home/alex'),
        expandedPath('rel/x.sh', '/home/alex'),
        expandedPath('~x.sh', '/home/alex'),
      ],
      ['/home/alex/bin/x.sh', '/abs/x.sh', 'rel/x.sh', '~x.sh'],
    );
  });

  it('F-2108 BR-3: the program path resolves a relative name against the working directory and keeps an absolute one', () => {
    deepStrictEqual(
      [programPath('rel/x.sh', '/work'), programPath('/abs/x.sh', '/work')],
      ['/work/rel/x.sh', '/abs/x.sh'],
    );
  });

  it('F-2108 BR-8, AC-11 (c2326-confirmation): a confirmation that the state reverts is written once more and read back, so another window sees it', async () => {
    const values = new Map<string, unknown>();
    let reverts = 1;
    const state = {
      get: (key: string) => values.get(key),
      update: (key: string, value: unknown) => {
        if (reverts > 0) {
          reverts -= 1;
        } else {
          values.set(key, value);
        }
        return Promise.resolve();
      },
    };
    await approvalsOf(state, copiesOf(), INSTANT).remember('s.sh', 'h1');
    // The read back goes on in the background after the write returns.
    await new Promise(resolve => setTimeout(resolve, 0));
    deepStrictEqual(
      approvalsOf(state, copiesOf(), INSTANT).hashFor('s.sh'),
      'h1',
    );
  });

  describe('a confirmation the state loses to an older copy (card #2812, #2326)', () => {
    it('F-2108 AC-23: a confirmation written and then lost from the state is given back from the copy, written again, and logged', async () => {
      const state = mementoOf();
      const {environment, lines} = loggingEnvironment();
      const approvals = approvalsOf(state, copiesOf(), environment);
      await approvals.remember('s.sh', 'h1');
      state.values.delete(SCRIPT_KEY);
      const given = approvals.hashFor('s.sh');
      await new Promise(setImmediate);
      deepStrictEqual(
        [given, state.updates, state.values.get(SCRIPT_KEY), lines()],
        [
          'h1',
          [
            [SCRIPT_KEY, 'h1'],
            [SCRIPT_KEY, 'h1'],
          ],
          'h1',
          [
            "the confirmation of s.sh was missing from the global state; written again from the profile's copy",
          ],
        ],
      );
    });

    it('F-2108 AC-23: the copy outlives a reload: a second record over the same copies heals what the state lost', async () => {
      const state = mementoOf();
      const copies = copiesOf();
      await approvalsOf(state, copies, INSTANT).remember('s.sh', 'h1');
      state.values.delete(SCRIPT_KEY);
      const given = approvalsOf(state, copies, INSTANT).hashFor('s.sh');
      await new Promise(setImmediate);
      deepStrictEqual(
        [given, state.values.get(SCRIPT_KEY), state.updates.length],
        ['h1', 'h1', 2],
      );
    });

    it('F-2108 AC-23: a confirmation read from the state is copied once, and given back after the state loses it', async () => {
      const state = mementoOf({[SCRIPT_KEY]: 'h1'});
      const copies = copiesOf();
      const approvals = approvalsOf(state, copies, INSTANT);
      const first = approvals.hashFor('s.sh');
      approvals.hashFor('s.sh');
      state.values.delete(SCRIPT_KEY);
      const second = approvalsOf(state, copies, INSTANT).hashFor('s.sh');
      await new Promise(setImmediate);
      deepStrictEqual(
        [first, second, copies.writes],
        ['h1', 'h1', [[COPY_NAME, 'h1']]],
      );
    });

    it('F-2108 BR-8: a hash the state holds wins over the copy, which becomes the state’s, and nothing is written to the state', async () => {
      const state = mementoOf();
      const copies = copiesOf();
      const approvals = approvalsOf(state, copies, INSTANT);
      await approvals.remember('s.sh', 'h1');
      state.values.set(SCRIPT_KEY, 'h2');
      state.updates.length = 0;
      const wins = approvals.hashFor('s.sh');
      await new Promise(setImmediate);
      deepStrictEqual(
        [wins, state.updates, copies.held.get(COPY_NAME)],
        ['h2', [], {kind: 'hash', hash: 'h2'}],
      );
    });

    it('F-2108 BR-8: a copy that is no hash or is not to be trusted is ignored, logged with its reason, never written to the state, and the script is unconfirmed', () => {
      const state = mementoOf();
      const seen = ['it is not a hash', 'it is not a regular file'].map(
        reason => {
          const {environment, lines} = loggingEnvironment();
          const copies = copiesOf({[COPY_NAME]: {kind: 'ignored', reason}});
          const given = approvalsOf(state, copies, environment).hashFor('s.sh');
          return [given, copies.writes, lines()];
        },
      );
      deepStrictEqual(
        [seen, state.updates],
        [
          [
            [
              undefined,
              [],
              [
                "the profile's copy of the confirmation of s.sh is not a hash; ignored",
              ],
            ],
            [
              undefined,
              [],
              [
                "the profile's copy of the confirmation of s.sh is ignored: it is not a regular file",
              ],
            ],
          ],
          [],
        ],
      );
    });

    it('F-2108 AC-23: a copy that cannot be written is logged once and never fails the confirmation, which the state keeps', async () => {
      const state = mementoOf();
      const {environment, lines} = loggingEnvironment();
      const failing = {
        read: () => undefined,
        write: () => Promise.reject(new Error('the disk is full')),
      };
      await approvalsOf(state, failing, environment).remember('s.sh', 'h1');
      deepStrictEqual(
        [state.values.get(SCRIPT_KEY), lines()],
        [
          'h1',
          [
            "the confirmation of s.sh could not be copied to the profile's storage: the disk is full",
          ],
        ],
      );
    });

    it('F-2108 AC-23: a copy that fails with something that is no Error is logged by its text', async () => {
      const {environment, lines} = loggingEnvironment();
      const failing = {
        read: () => undefined,
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a store that breaks its contract, on purpose
        write: () => Promise.reject('plain text'),
      };
      await approvalsOf(mementoOf(), failing, environment).remember(
        's.sh',
        'h1',
      );
      deepStrictEqual(lines(), [
        "the confirmation of s.sh could not be copied to the profile's storage: plain text",
      ]);
    });

    it('F-2108 AC-23: a script path of 300 characters is copied under a file name of 64, and healed after a reload', async () => {
      const root = mkdtempSync(path.join(tmpdir(), 'confirmations-'));
      const folder = path.join(root, 'preconnect-confirmations');
      const longPath = `/${'a'.repeat(300)}.sh`;
      const longHash = 'f'.repeat(64);
      const state = mementoOf();
      try {
        await approvalsOf(state, confirmationFilesOf(folder), INSTANT).remember(
          longPath,
          longHash,
        );
        state.values.clear();
        const given = approvalsOf(
          state,
          confirmationFilesOf(folder),
          INSTANT,
        ).hashFor(longPath);
        deepStrictEqual(
          [given, readdirSync(folder).map(name => name.length)],
          [longHash, [64]],
        );
      } finally {
        rmSync(root, {recursive: true, force: true});
      }
    });

    it('F-2108 BR-8: a path this window never wrote or read is not invented, and nothing is written', async () => {
      const state = mementoOf();
      const {environment, lines} = loggingEnvironment();
      const copies = copiesOf();
      const given = approvalsOf(state, copies, environment).hashFor('s.sh');
      await new Promise(setImmediate);
      deepStrictEqual(
        [given, state.updates, copies.writes, lines()],
        [undefined, [], [], []],
      );
    });
  });
});
