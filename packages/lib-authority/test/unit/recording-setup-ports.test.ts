import {deepStrictEqual} from 'node:assert';
import {recordingSetupPorts} from '../../src/testing/recording-setup-ports.ts';

describe('the recording setup ports', () => {
  it('probe the named proposals as granted or missing, and record the calls', async () => {
    const events: string[] = [];
    const ports = recordingSetupPorts(
      {
        extensionId: 'a.b',
        missing: ['resolvers'],
        probed: ['resolvers', 'tunnels'],
      },
      events,
    );
    deepStrictEqual(
      [await ports.probe(), events],
      [
        [
          {proposal: 'resolvers', state: 'missing'},
          {proposal: 'tunnels', state: 'granted'},
        ],
        ['probe'],
      ],
    );
  });

  it('probe only what is missing when nothing else is named, and nothing by default', async () => {
    const some = recordingSetupPorts(
      {extensionId: 'a.b', missing: ['tunnels']},
      [],
    );
    const none = recordingSetupPorts({extensionId: 'a.b'}, []);
    deepStrictEqual(
      [await some.probe(), await none.probe()],
      [[{proposal: 'tunnels', state: 'missing'}], []],
    );
  });

  it('answer the user as "not now" and record the claim, the notice and a failure', async () => {
    const events: string[] = [];
    const ports = recordingSetupPorts({extensionId: 'a.b'}, events);
    const answers = [
      await ports.window.claim('a.b'),
      await ports.showSetup({kind: 'failedAttempt'}),
      await ports.showRestart(),
      await ports.argvEnabled(),
      await ports.argvEdited(),
      await ports.installedFamilyIds(),
      [ports.flags.dismissed(), ports.flags.attemptPending()],
    ];
    await ports.flags.setDismissed(true);
    await ports.flags.setAttemptPending(true);
    await ports.configureRuntimeArguments();
    await ports.quit();
    ports.logFailure('broke');
    deepStrictEqual(
      [answers, events],
      [
        [
          {holder: 'a.b'},
          'notNow',
          'later',
          [],
          false,
          ['a.b'],
          [false, false],
        ],
        ['claim', 'notice', 'failure broke'],
      ],
    );
  });
});
