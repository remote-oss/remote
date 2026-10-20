import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {rebuildContainer} from '../../src/open/rebuild.ts';
import {REBUILD_INTENTS_KEY} from '../../src/open/rebuild-intent.ts';

/** The window, the store and the log a row steers. */
interface Setup {
  remoteName: string | undefined;
  authority: string | undefined;
  updates: unknown[];
  reloads: number;
  failure: unknown;
  holdReload: Promise<void>;
  /** How many times the window told the shutdown helper that it leaves its container. */
  left: number;
}

function setup(): Setup {
  return {
    remoteName: 'dev-container',
    authority: 'dev-container+payload',
    updates: [],
    reloads: 0,
    failure: undefined,
    holdReload: Promise.resolve(),
    left: 0,
  };
}

/** Runs the command `calls` times in a row, without waiting between them, and gives the log lines. */
async function reopened(
  state: Setup,
  options = {buildNoCache: false},
  calls = 1,
): Promise<string[]> {
  const sink = new MemorySink();
  const handler = rebuildContainer(
    {
      window: {
        remoteName: () => state.remoteName,
        remoteAuthority: () => state.authority,
        reload: async () => {
          state.reloads += 1;
          await state.holdReload;
        },
      },
      intents: {
        get: () => undefined,
        update: (key, value) => {
          if (state.failure !== undefined) {
            // The row on a rejection that is not an error needs exactly that.
            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
            return Promise.reject(state.failure);
          }
          state.updates.push([key, value]);
          return Promise.resolve();
        },
      },
      now: () => 1000,
      shutdown: {
        leave: () => {
          state.left += 1;
          return Promise.resolve();
        },
      },
      logger: createLogger(sink, {minimumLevel: () => 'info'}),
    },
    options,
  );
  await Promise.all(Array.from({length: calls}, () => handler()));
  return sink.lines.map(line => `${line.level}: ${line.message}`);
}

describe('Rebuild Container', () => {
  it('F-0405 AC-4: it stores the intent for the payload and reloads, with nothing shown', async () => {
    const state = setup();
    const lines = await reopened(state);
    deepStrictEqual(
      [state.updates, state.reloads, lines],
      [
        [
          [
            REBUILD_INTENTS_KEY,
            {
              payload: {
                storedAt: 1000,
                value: {removeExistingContainer: true, buildNoCache: false},
              },
            },
          ],
        ],
        1,
        ['info: rebuilding the dev container (no cache: false)'],
      ],
    );
  });

  it('F-0405 5.1: the no-cache variant stores buildNoCache', async () => {
    const state = setup();
    await reopened(state, {buildNoCache: true});
    deepStrictEqual(
      JSON.stringify(state.updates),
      JSON.stringify([
        [
          REBUILD_INTENTS_KEY,
          {
            payload: {
              storedAt: 1000,
              value: {removeExistingContainer: true, buildNoCache: true},
            },
          },
        ],
      ]),
    );
  });

  it('F-0417 BR-9: Rebuild Container tells the shutdown helper that the window leaves, once, and then reloads; with no reload it tells nothing', async () => {
    const rebuilt = setup();
    await reopened(rebuilt);
    const stuck = setup();
    stuck.failure = new Error('disk full');
    await reopened(stuck);
    deepStrictEqual(
      [
        [rebuilt.left, rebuilt.reloads],
        [stuck.left, stuck.reloads],
      ],
      [
        [1, 1],
        [0, 0],
      ],
    );
  });

  it('F-0405 AC-29: in a local window it does nothing (BR-20)', async () => {
    const state = setup();
    state.remoteName = undefined;
    state.authority = undefined;
    const lines = await reopened(state);
    deepStrictEqual(
      [state.updates, state.reloads, lines],
      [[], 0, ['info: Rebuild Container does nothing in this window']],
    );
  });

  it('F-0405 BR-20: in another remote window it does nothing', async () => {
    const state = setup();
    state.remoteName = 'ssh-remote';
    state.authority = 'ssh-remote+host';
    const lines = await reopened(state);
    deepStrictEqual(
      [state.updates, state.reloads, lines],
      [[], 0, ['info: Rebuild Container does nothing in this window']],
    );
  });

  it("F-0405 BR-17: an intent that can't be stored means no reload", async () => {
    const state = setup();
    state.failure = new Error('disk full');
    const lines = await reopened(state);
    deepStrictEqual(
      [state.reloads, lines],
      [0, ['warn: the rebuild intent could not be stored: disk full']],
    );
  });

  it('F-0405 BR-17: a rejection that is not an error is logged by its text', async () => {
    const state = setup();
    state.failure = 'quota';
    const lines = await reopened(state);
    deepStrictEqual(lines, [
      'warn: the rebuild intent could not be stored: quota',
    ]);
  });

  it("F-0405 BR-19: the window's own payload is the key", async () => {
    const state = setup();
    state.authority = 'dev-container+7b7d';
    await reopened(state);
    deepStrictEqual(Object.keys((state.updates[0] as [string, object])[1]), [
      '7b7d',
    ]);
  });

  it('contracts: a second call while one runs returns at once', async () => {
    const state = setup();
    const release: Array<() => void> = [];
    state.holdReload = new Promise<void>(resolve => {
      release.push(resolve);
    });
    const pending = reopened(state, {buildNoCache: false}, 2);
    await Promise.resolve();
    release.forEach(each => {
      each();
    });
    const lines = await pending;
    deepStrictEqual(
      [
        state.updates.length,
        lines.includes('info: Rebuild Container is already running'),
      ],
      [1, true],
    );
  });
});
