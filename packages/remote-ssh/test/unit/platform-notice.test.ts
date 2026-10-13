import {deepStrictEqual} from 'node:assert';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import {
  announcePlatform,
  SUPPRESS_PLATFORM_NOTICE_KEY,
} from '../../src/connect/platform-notice.ts';
import type {NoticePort} from '../../src/surfaces/notice.ts';

const MESSAGE =
  'You selected "linux" as the remote platform - this will be stored in the setting "remote.SSH.remotePlatform" and can be changed there if needed.';

const BUTTON = "Don't Show Again";

/** Waits until the pending promise callbacks have scenario. */
function settled(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

interface Setup {
  shown: Array<[string, readonly string[]]>;
  stored: Array<[string, unknown]>;
  sink: MemorySink;
  announce(platform?: string): Promise<void>;
}

function setup(
  options: {
    answer?: Promise<string | undefined>;
    held?: unknown;
    update?: () => Promise<void>;
  } = {},
): Setup {
  const shown: Setup['shown'] = [];
  const stored: Setup['stored'] = [];
  const sink = new MemorySink();
  const notice: NoticePort = {
    showInformation: (message, buttons) => {
      shown.push([message, buttons]);
      return options.answer ?? Promise.resolve(undefined);
    },
    showWarning: () => Promise.resolve(undefined),
    showError: () => Promise.resolve(undefined),
  };
  return {
    shown,
    stored,
    sink,
    announce: async (platform = 'linux') => {
      announcePlatform(
        {
          notice,
          state: {
            get: key =>
              key === SUPPRESS_PLATFORM_NOTICE_KEY ? options.held : undefined,
            update: (key, value) => {
              stored.push([key, value]);
              return options.update?.() ?? Promise.resolve();
            },
          },
          translate: template => template,
          logger: createLogger(sink, {minimumLevel: () => 'info'}),
        },
        platform,
      );
      await settled();
    },
  };
}

describe('the platform notice (F-2206)', () => {
  it('F-2206 5.2: a set write announces the stored platform with one Dont Show Again button', async () => {
    const scenario = setup();
    await scenario.announce();
    deepStrictEqual(scenario.shown, [[MESSAGE, [BUTTON]]]);
  });

  it('F-2206 6.4: Dont Show Again stores the suppression', async () => {
    const scenario = setup({answer: Promise.resolve(BUTTON)});
    await scenario.announce();
    deepStrictEqual(scenario.stored, [[SUPPRESS_PLATFORM_NOTICE_KEY, true]]);
  });

  it('F-2206 6.4: a dismissed notice stores nothing', async () => {
    const scenario = setup({answer: Promise.resolve(undefined)});
    await scenario.announce();
    deepStrictEqual(scenario.stored, []);
  });

  it('F-2206 BR-11: a suppressed notice is not shown', async () => {
    const scenario = setup({held: true});
    await scenario.announce();
    deepStrictEqual(scenario.shown, []);
  });

  it('F-2206 BR-11: only the exact value true suppresses it', async () => {
    const scenario = setup({held: 'true'});
    await scenario.announce();
    deepStrictEqual(scenario.shown.length, 1);
  });

  it('F-2206 5.2: the announcement does not wait for the notice', () => {
    const scenario = setup({answer: new Promise(() => undefined)});
    scenario.announce().catch(() => undefined);
    deepStrictEqual(scenario.shown.length, 1);
  });

  it('F-2206 5.2: a rejected notice is logged at warn and not thrown', async () => {
    const scenario = setup({answer: Promise.reject(new Error('no editor'))});
    await scenario.announce();
    deepStrictEqual(
      scenario.sink.lines.map(line => [line.level, line.message]),
      [['warn', 'the platform notice did not work: no editor']],
    );
  });

  it('F-2206 5.2: a rejected state update is logged at warn and not thrown', async () => {
    const scenario = setup({
      answer: Promise.resolve(BUTTON),
      update: () => Promise.reject(new Error('no state')),
    });
    await scenario.announce();
    deepStrictEqual(
      scenario.sink.lines.map(line => line.message),
      ['the platform notice did not work: no state'],
    );
  });
});
