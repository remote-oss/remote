import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {approvalsOf, contentHashOf} from '../../src/preconnect/approvals.ts';
import {expandedPath, programPath} from '../../src/preconnect/script-path.ts';

/** The environment of a write that is read back at once. */
const INSTANT = {
  delay: () => Promise.resolve(),
  logger: createLogger(new MemorySink(), {minimumLevel: () => 'info'}),
};

/** A memento that keeps what it is given. */
function mementoOf(initial: Record<string, unknown> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    get: (key: string) => values.get(key),
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
  };
}

describe('the record of confirmed pre-connection scripts (card connect-87)', () => {
  it('F-2108 AC-11: the key is the prefix and the standard base64 of the path, with its padding', async () => {
    const state = mementoOf();
    const approvals = approvalsOf(state, INSTANT);
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
    await approvalsOf(state, INSTANT).remember('s.sh', 'h1');
    deepStrictEqual(approvalsOf(state, INSTANT).hashFor('s.sh'), 'h1');
  });
});
