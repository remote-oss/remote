import {deepStrictEqual} from 'node:assert';
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
  remotePlatform: {},
  windowsRemotes: [],
  enableRemoteCommand: false,
};

interface Calls {
  asked: string[];
  written: Array<[string, RemotePlatform]>;
}

function stepsFor(
  changes: Partial<TermsSettings>,
  answer?: RemotePlatform,
): {calls: Calls; steps: ReturnType<typeof createTermsSteps>} {
  const calls: Calls = {asked: [], written: []};
  return {
    calls,
    steps: createTermsSteps({
      settings: () => ({...SETTINGS, ...changes}),
      pickPlatform: alias => {
        calls.asked.push(alias);
        return Promise.resolve(answer);
      },
      writePlatform: (alias, platform) => {
        calls.written.push([alias, platform]);
        return Promise.resolve();
      },
    }),
  };
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
});
