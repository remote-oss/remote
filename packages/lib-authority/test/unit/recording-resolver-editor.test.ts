import {deepStrictEqual} from 'node:assert';
import {recordingResolverEditor} from '../../src/testing/recording-resolver-editor.ts';

const CONNECTION = {
  host: '127.0.0.1',
  port: 4000,
  connectionToken: 't',
  extensionHostEnv: {},
  environmentTunnels: [],
};

describe('the recording resolver host editor', () => {
  it('records a registration and keeps the resolver for the test', async () => {
    const events: string[] = [];
    const fake = recordingResolverEditor(events);
    const handle = fake.editor.registerRemoteAuthorityResolver('ssh-remote', {
      resolve: () => Promise.resolve(CONNECTION),
    });
    const resolved = await fake.registered()?.resolve('ssh-remote+box', {
      resolveAttempt: 1,
    });
    handle.dispose();
    deepStrictEqual(
      [events, resolved?.port],
      [['register ssh-remote', 'unregister ssh-remote'], 4000],
    );
  });

  it('has no resolver before one is registered', () => {
    deepStrictEqual(recordingResolverEditor([]).registered(), undefined);
  });

  it('records the progress and its stages, and cancels the running one', async () => {
    const events: string[] = [];
    const fake = recordingResolverEditor(events);
    await fake.editor.progress.withProgress(
      {
        title: 'Setting up',
        cancellable: true,
        onCancel: () => {
          events.push('cancelled');
        },
        onDetails: () => undefined,
      },
      update => {
        update('stage', false);
        fake.cancelProgress();
        return Promise.resolve();
      },
    );
    deepStrictEqual(events, [
      'progress Setting up',
      'phase stage',
      'cancelled',
    ]);
  });

  /** The events of an uncancellable progress titled `Setting up` whose task reports its stages through `report`. */
  async function stagesRecordedFor(
    report: (
      update: (title: string, details: boolean, increment?: number) => void,
    ) => void,
  ): Promise<string[]> {
    const events: string[] = [];
    await recordingResolverEditor(events).editor.progress.withProgress(
      {
        title: 'Setting up',
        cancellable: false,
        onCancel: () => undefined,
        onDetails: () => undefined,
      },
      update => {
        report(update);
        return Promise.resolve();
      },
    );
    return events;
  }

  it('containers-55: records the increment of a stage that carries one', async () => {
    deepStrictEqual(
      await stagesRecordedFor(update => {
        update('stage', false, 40);
        update('stage', true, 0);
        update('stage', false);
      }),
      [
        'progress Setting up',
        'phase stage +40',
        'phase stage (details) +0',
        'phase stage',
      ],
    );
  });

  it('contracts §3.2: records a stage that carries the details link', async () => {
    deepStrictEqual(
      await stagesRecordedFor(update => {
        update('stage', true);
      }),
      ['progress Setting up', 'phase stage (details)'],
    );
  });

  it('cancels nothing when no progress runs', () => {
    const events: string[] = [];
    recordingResolverEditor(events).cancelProgress();
    deepStrictEqual(events, []);
  });

  it('records the errors and the window actions', async () => {
    const events: string[] = [];
    const {editor} = recordingResolverEditor(events, {
      windowId: 'w',
      workspace: 'file:///f',
    });
    const errors = [
      editor.notAvailable('gone', true).message,
      editor.temporarilyNotAvailable('later').message,
    ];
    await editor.reloadWindow();
    await editor.closeRemote();
    deepStrictEqual(
      [events, errors, editor.windowId(), editor.windowWorkspace()],
      [
        [
          'notAvailable gone true',
          'temporarilyNotAvailable later',
          'reload',
          'closeRemote',
        ],
        ['gone', 'later'],
        'w',
        'file:///f',
      ],
    );
  });

  it('defaults to window-1 without a workspace', () => {
    const {editor} = recordingResolverEditor([]);
    deepStrictEqual(
      [editor.windowId(), editor.windowWorkspace()],
      ['window-1', undefined],
    );
  });

  it('contracts §3.2: records a timer, runs a live one once when fired, and not a cancelled one', () => {
    const events: string[] = [];
    const fake = recordingResolverEditor(events);
    const calls: string[] = [];
    fake.editor.startTimer(1500, () => {
      calls.push('live');
    });
    const cancel = fake.editor.startTimer(200, () => {
      calls.push('cancelled');
    });
    cancel();
    fake.fireTimers();
    fake.fireTimers();
    deepStrictEqual([events, calls], [['timer 1500', 'timer 200'], ['live']]);
  });

  it('contracts §3.2: knows whether a progress is still running', async () => {
    const fake = recordingResolverEditor([]);
    const states: boolean[] = [fake.progressSettled()];
    const finishes: Array<() => void> = [];
    const running = fake.editor.progress.withProgress(
      {
        title: 'Setting up',
        cancellable: false,
        onCancel: () => undefined,
        onDetails: () => undefined,
      },
      () =>
        new Promise<void>(resolve => {
          finishes.push(resolve);
        }),
    );
    states.push(fake.progressSettled());
    finishes.forEach(finish => {
      finish();
    });
    await running;
    states.push(fake.progressSettled());
    deepStrictEqual(states, [true, false, true]);
  });
});
