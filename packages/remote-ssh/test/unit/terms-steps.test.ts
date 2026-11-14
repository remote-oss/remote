import {deepStrictEqual} from 'node:assert';
import {FakeClock} from 'lib-helper/testing/fake-clock';
import {createLogger} from 'lib-log';
import {MemorySink} from 'lib-log/testing/memory-sink';
import type {RemotePlatform} from '../../src/pipeline/platform.ts';
import {
  createTermsSteps,
  type TermsSettings,
} from '../../src/pipeline/terms-steps.ts';
import type {ConnectInput} from '../../src/pipeline/steps.ts';

const INPUT: ConnectInput = {
  target: {kind: 'plain', text: 'alex@devbox:2222'},
  rawHostString: 'alex@devbox:2222',
  attempt: 1,
  isReconnection: false,
  windowId: 'window-1',
  windowWorkspace: undefined,
};

const SIGNAL = new AbortController().signal;

const SETTINGS: TermsSettings = {
  useLocalServer: true,
  useLocalServerSetting: true,
  remotePlatform: {},
  windowsRemotes: [],
  enableRemoteCommand: false,
};

interface Calls {
  asked: string[];
  /** The variant each question was asked with. */
  variants: string[];
  written: Array<[string, RemotePlatform]>;
  announced: RemotePlatform[];
  /** The order of the announcements and the writes. */
  order: string[];
}

/** How one try of the write ends in a fixture: it works, the editor refuses it, or it never settles. */
type WriteBehaviour = 'works' | 'refused' | 'hangs';

function stepsFor(
  changes: Partial<TermsSettings>,
  answer?: RemotePlatform,
  writes: readonly WriteBehaviour[] = [],
): {
  calls: Calls;
  steps: ReturnType<typeof createTermsSteps>;
  clock: FakeClock;
  lines: () => string[];
  /** Changes the settings the steps read from now on, as an edit made while a try of the write is pending. */
  settle: (later: Partial<TermsSettings>) => void;
} {
  const calls: Calls = {
    asked: [],
    variants: [],
    written: [],
    announced: [],
    order: [],
  };
  const clock = new FakeClock();
  const sink = new MemorySink();
  const behaviours = [...writes];
  let later: Partial<TermsSettings> = {};
  return {
    calls,
    clock,
    lines: () => sink.lines.map(line => line.message),
    settle: change => {
      later = change;
    },
    steps: createTermsSteps({
      settings: () => ({...SETTINGS, ...changes, ...later}),
      pickPlatform: (alias, variant) => {
        calls.asked.push(alias);
        calls.variants.push(variant);
        return Promise.resolve(answer);
      },
      announcePlatform: platform => {
        calls.announced.push(platform);
        calls.order.push('announce');
      },
      writePlatform: (alias, platform) => {
        calls.written.push([alias, platform]);
        calls.order.push('write');
        const behaviour = behaviours.shift() ?? 'works';
        if (behaviour === 'refused') {
          return Promise.reject(new Error('the editor refused'));
        }
        return behaviour === 'hangs'
          ? new Promise<void>(() => undefined)
          : Promise.resolve();
      },
      logger: createLogger(sink, {minimumLevel: () => 'trace'}),
      scheduler: clock.scheduler(),
    }),
  };
}

/** Lets the promises that are due run. */
async function settledPromises(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    await Promise.resolve();
  }
}

describe('the terms of a connection', () => {
  it('leave the platform to the probe when the shared connection is on and no entry says', async () => {
    const {steps} = stepsFor({});
    deepStrictEqual(await steps.decideTerms(INPUT, SIGNAL), {
      kind: 'done',
      value: {platform: 'unknown', remoteCommandInEffect: false},
    });
  });

  it('take the platform an entry for the host gives, by the alias without the user or port', async () => {
    const {steps} = stepsFor({remotePlatform: {devbox: 'windows'}});
    deepStrictEqual(await steps.decideTerms(INPUT, SIGNAL), {
      kind: 'done',
      value: {platform: 'windows', remoteCommandInEffect: false},
    });
  });

  it('put the remote command in effect when it is enabled and no entry names a platform', async () => {
    const {steps} = stepsFor({enableRemoteCommand: true});
    deepStrictEqual(await steps.decideTerms(INPUT, SIGNAL), {
      kind: 'done',
      value: {platform: 'unknown', remoteCommandInEffect: true},
    });
  });

  it('ask the user for the platform when the shared connection is off and no entry says', async () => {
    const {steps, calls} = stepsFor({useLocalServer: false}, 'macOS');
    deepStrictEqual(
      [await steps.decideTerms(INPUT, SIGNAL), calls.asked],
      [
        {
          kind: 'done',
          value: {platform: 'macOS', remoteCommandInEffect: false},
        },
        ['devbox'],
      ],
    );
  });

  it('F-2304 6.5: a dismissed platform pick fails as cancelled with "Connecting was canceled"', async () => {
    const {steps} = stepsFor({useLocalServer: false});
    deepStrictEqual(await steps.decideTerms(INPUT, SIGNAL), {
      kind: 'failed',
      failure: {kind: 'cancelled', reason: {id: 'S027'}},
    });
  });
});

describe('remembering the platform', () => {
  it('writes the exact key with the platform the host reported when the shared connection is off', async () => {
    const {steps, calls} = stepsFor({useLocalServer: false});
    await steps.rememberPlatform(INPUT, 'darwin');
    deepStrictEqual(calls.written, [['devbox', 'macOS']]);
  });

  it('writes nothing when the setting already holds the reported platform', async () => {
    const {steps, calls} = stepsFor({
      useLocalServer: false,
      remotePlatform: {devbox: 'linux'},
    });
    await steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(calls.written, []);
  });

  it('writes nothing while the shared connection is on', async () => {
    const {steps, calls} = stepsFor({});
    await steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(calls.written, []);
  });

  it('F-2206 5.2: a set write announces the stored platform, before the write', async () => {
    const {steps, calls} = stepsFor({useLocalServer: false});
    await steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(
      [calls.announced, calls.order],
      [['linux'], ['announce', 'write']],
    );
  });

  it('F-2206 BR-8: the announcement names the reported platform, not the one picked', async () => {
    const {steps, calls} = stepsFor({useLocalServer: false}, 'macOS');
    await steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(calls.announced, ['linux']);
  });

  it('F-2206 BR-9: no write, no announcement', async () => {
    const {steps, calls} = stepsFor({
      useLocalServer: false,
      remotePlatform: {devbox: 'linux'},
    });
    await steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(calls.announced, []);
  });

  it('#2573: the log tells each decision: written, kept because the entry holds it, kept because the local connection server is on', async () => {
    const written = stepsFor({useLocalServer: false});
    const held = stepsFor({
      useLocalServer: false,
      remotePlatform: {devbox: 'linux'},
    });
    const local = stepsFor({});
    await written.steps.rememberPlatform(INPUT, 'darwin');
    await held.steps.rememberPlatform(INPUT, 'linux');
    await local.steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(
      [written.lines(), held.lines(), local.lines()],
      [
        [
          'the remotePlatform entry of devbox was none; the host reports macOS; writing it',
        ],
        [
          'the remotePlatform entry of devbox was linux; the host reports linux; keeping it: the entry already holds it',
        ],
        [
          'the remotePlatform entry of devbox was none; the host reports linux; keeping it: the local connection server is on',
        ],
      ],
    );
  });

  it('#2573: an entry that holds no platform is told as none', async () => {
    const {steps, lines} = stepsFor({
      useLocalServer: false,
      remotePlatform: {devbox: 'not a platform'},
    });
    await steps.rememberPlatform(INPUT, 'linux');
    deepStrictEqual(lines(), [
      'the remotePlatform entry of devbox was none; the host reports linux; writing it',
    ]);
  });

  it('#2573: a write the editor refuses is tried once more after a second, and told on its second attempt', async () => {
    const {steps, calls, clock, lines} = stepsFor(
      {useLocalServer: false},
      undefined,
      ['refused', 'works'],
    );
    const pending = steps.rememberPlatform(INPUT, 'linux');
    await settledPromises();
    clock.advance(1000);
    await pending;
    deepStrictEqual(
      [calls.written.length, lines().slice(1)],
      [
        2,
        [
          "the platform setting's write was refused: Error: the editor refused",
          'the platform setting was written on the second attempt',
        ],
      ],
    );
  });

  it('#2573: a write that does not settle in ten seconds is told, and tried once more', async () => {
    const {steps, calls, clock, lines} = stepsFor(
      {useLocalServer: false},
      undefined,
      ['hangs', 'works'],
    );
    const pending = steps.rememberPlatform(INPUT, 'linux');
    await settledPromises();
    clock.advance(9999);
    await settledPromises();
    const beforeBound = calls.written.length;
    clock.advance(1);
    await settledPromises();
    clock.advance(1000);
    await pending;
    deepStrictEqual(
      [beforeBound, calls.written.length, lines().slice(1)],
      [
        1,
        2,
        [
          "the platform setting's write did not finish within 10 s",
          'the platform setting was written on the second attempt',
        ],
      ],
    );
  });

  it('#2573: a retry that fails too fails the step with its message, and there is no third try', async () => {
    const {steps, calls, clock} = stepsFor({useLocalServer: false}, undefined, [
      'refused',
      'refused',
      'works',
    ]);
    const outcome = steps.rememberPlatform(INPUT, 'linux').then(
      () => 'resolved',
      (caught: unknown) => String(caught),
    );
    await settledPromises();
    clock.advance(1000);
    const failed = await outcome;
    clock.advance(60_000);
    await settledPromises();
    deepStrictEqual(
      [failed, calls.written.length],
      [
        "Error: the platform setting's write was refused: Error: the editor refused",
        2,
      ],
    );
  });

  it('#2573: a retry that does not settle fails the step with the bound, after one try more', async () => {
    const {steps, calls, clock} = stepsFor({useLocalServer: false}, undefined, [
      'refused',
      'hangs',
    ]);
    const outcome = steps.rememberPlatform(INPUT, 'linux').then(
      () => 'resolved',
      (caught: unknown) => String(caught),
    );
    await settledPromises();
    clock.advance(1000);
    await settledPromises();
    clock.advance(10_000);
    const failed = await outcome;
    deepStrictEqual(
      [failed, calls.written.length],
      ["Error: the platform setting's write did not finish within 10 s", 2],
    );
  });

  it('#2573: when the settings read afresh hold the platform by the time of the retry, it is kept and not written again', async () => {
    const {steps, calls, clock, lines, settle} = stepsFor(
      {useLocalServer: false},
      undefined,
      ['refused'],
    );
    const pending = steps.rememberPlatform(INPUT, 'linux');
    await settledPromises();
    settle({remotePlatform: {devbox: 'linux'}});
    clock.advance(1000);
    await pending;
    deepStrictEqual(
      [calls.written.length, lines().at(-1)],
      [
        1,
        'the remotePlatform entry of devbox now holds the reported platform; keeping it',
      ],
    );
  });

  it('F-2603 AC-19: the question of the platform before any setting says is asked with the ordinary variant', async () => {
    const {calls, steps} = stepsFor(
      {useLocalServer: false, useLocalServerSetting: false},
      'linux',
    );
    await steps.decideTerms(INPUT, SIGNAL);
    deepStrictEqual([calls.asked, calls.variants], [['devbox'], ['ask']]);
  });

  it('F-2603 AC-19: the question after a broken pipe is asked with its own variant for the alias, and writes nothing, for a chosen platform and for none', async () => {
    const chosen = stepsFor({}, 'windows');
    const none = stepsFor({});
    deepStrictEqual(
      [
        await chosen.steps.pickAfterBrokenPipe(INPUT, SIGNAL),
        await none.steps.pickAfterBrokenPipe(INPUT, SIGNAL),
        chosen.calls.asked,
        chosen.calls.variants,
        chosen.calls.written,
        chosen.calls.announced,
        none.calls.written,
      ],
      ['windows', undefined, ['devbox'], ['brokenPipe'], [], [], []],
    );
  });
});
