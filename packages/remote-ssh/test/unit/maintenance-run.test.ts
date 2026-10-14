import {deepStrictEqual, rejects, strictEqual} from 'node:assert';
import {
  maintenanceInputOf,
  runMaintenance,
} from '../../src/maintenance/maintenance-run.ts';
import type {ConnectSteps} from '../../src/pipeline/steps.ts';
import {
  emptyRecording,
  INPUT,
  type Recording,
  steps,
} from './pipeline.fixture.ts';

const NEVER = new AbortController().signal;

/** A step that did not work. */
const FAILED = {
  kind: 'failed' as const,
  failure: {kind: 'invalidSetting' as const},
};

describe('a maintenance run (F-2411, F-2412)', () => {
  let recording: Recording;

  beforeEach(() => {
    recording = emptyRecording();
  });

  function perform(
    action: 'kill' | 'uninstall',
    changes: Partial<ConnectSteps> = {},
  ) {
    return runMaintenance(steps(recording, changes), INPUT, action, NEVER);
  }

  it('F-2411.BR-2: a kill takes the steps of a connect up to the probe, then the kill', async () => {
    await perform('kill');
    deepStrictEqual(recording.calls, [
      'validate',
      'checkInstallFolder',
      'locateClient',
      'decideTerms',
      'openConnection',
      'probe',
      'kill',
    ]);
  });

  it('F-2412.BR-2: an uninstall ends in the uninstall', async () => {
    await perform('uninstall');
    strictEqual(recording.calls.at(-1), 'uninstall');
  });

  it('F-2411.BR-2: a run that worked ran the step', async () => {
    deepStrictEqual((await perform('kill')).result, 'stepRan');
  });

  it('F-2411.BR-2: the login of the run is ended right after, by giving the lease back once', async () => {
    await perform('kill');
    strictEqual(recording.releases, 1);
  });

  it('F-2411.7.E2: a target that does not validate is a failed connection, and nothing else runs', async () => {
    const outcome = await perform('kill', {validate: () => FAILED});
    deepStrictEqual(
      [outcome.result, recording.calls],
      ['connectionFailed', []],
    );
  });

  it("F-2411 §10: a kill does not take the start settings' checks", async () => {
    await perform('kill', {
      checkStartSettings: () => FAILED,
    });
    deepStrictEqual(
      [recording.calls.includes('checkStartSettings'), recording.calls.at(-1)],
      [false, 'kill'],
    );
  });

  it("F-2412 §10: an uninstall does not take the start settings' checks", async () => {
    const outcome = await perform('uninstall', {
      checkStartSettings: () => FAILED,
    });
    strictEqual(outcome.result, 'stepRan');
  });

  it('F-2412 §10: an uninstall does not check the install folder', async () => {
    const outcome = await perform('uninstall', {
      checkInstallFolder: () => FAILED,
    });
    deepStrictEqual(
      [outcome.result, recording.calls.includes('checkInstallFolder')],
      ['stepRan', false],
    );
  });

  it('F-2411 §10: a kill whose install folder fails is a failed connection, and nothing runs after it', async () => {
    const outcome = await perform('kill', {checkInstallFolder: () => FAILED});
    deepStrictEqual(
      [outcome.result, recording.calls],
      ['connectionFailed', ['validate']],
    );
  });

  it('F-2411.7.E2: a client that is not found is a failed connection', async () => {
    const outcome = await perform('kill', {
      locateClient: () => Promise.resolve(FAILED),
    });
    strictEqual(outcome.result, 'connectionFailed');
  });

  it('F-2411.7.E2: a client that is not found stops the run before a login', async () => {
    await perform('kill', {locateClient: () => Promise.resolve(FAILED)});
    deepStrictEqual(recording.calls, ['validate', 'checkInstallFolder']);
  });

  it('F-2411.7.E2: terms that were not decided are a failed connection', async () => {
    const outcome = await perform('kill', {
      decideTerms: () => Promise.resolve(FAILED),
    });
    strictEqual(outcome.result, 'connectionFailed');
  });

  it('F-2206 AC-33: a dismissed platform pick is a cancelled run, and no connection is opened', async () => {
    const outcome = await perform('uninstall', {
      decideTerms: () =>
        Promise.resolve({
          kind: 'failed',
          failure: {kind: 'cancelled', reason: {id: 'S027'}},
        }),
    });
    deepStrictEqual(
      [outcome.result, recording.calls],
      ['cancelled', ['validate', 'locateClient']],
    );
  });

  it('F-2411.7.E2: a login that failed is a failed connection', async () => {
    const outcome = await perform('kill', {
      openConnection: () => Promise.resolve(FAILED),
    });
    strictEqual(outcome.result, 'connectionFailed');
  });

  it('F-2411.7.E2: a login that failed has no lease to give back and runs no step', async () => {
    await perform('kill', {openConnection: () => Promise.resolve(FAILED)});
    deepStrictEqual(
      [recording.releases, recording.calls.includes('kill')],
      [0, false],
    );
  });

  it('F-2411.7.E2: a probe that failed is a failed connection, with the lease given back', async () => {
    const outcome = await perform('kill', {
      probe: () =>
        Promise.resolve({kind: 'failed', failure: {kind: 'noResultBlock'}}),
    });
    deepStrictEqual(
      [outcome.result, recording.releases, recording.calls.includes('kill')],
      ['connectionFailed', 1, false],
    );
  });

  it('F-2411.7.E2: a step that did not finish is a failed connection, with the lease given back', async () => {
    const outcome = await perform('kill', {
      maintain: () => Promise.resolve({kind: 'noResultBlock'}),
    });
    deepStrictEqual(
      [outcome.result, recording.releases],
      ['connectionFailed', 1],
    );
  });

  it('F-2411.7.E2: a step that did not finish says why, for the log', async () => {
    const outcome = await perform('kill', {
      maintain: () => Promise.resolve({kind: 'noResultBlock'}),
    });
    strictEqual(outcome.cause, 'the kill did not run: noResultBlock');
  });

  it('F-2411.BR-2: a step that throws is not swallowed', async () => {
    await rejects(
      perform('kill', {
        maintain: () => Promise.reject(new Error('the channel broke')),
      }),
      /the channel broke/,
    );
  });

  it('F-2411.BR-2: a step that throws still gives the lease back', async () => {
    await perform('kill', {
      maintain: () => Promise.reject(new Error('the channel broke')),
    }).catch(() => undefined);
    strictEqual(recording.releases, 1);
  });
});

describe('the input of a maintenance run (F-2411.6.3)', () => {
  it('F-2411.6.3: a host with no user and no port is the plain host string', () => {
    const input = maintenanceInputOf({host: 'dev'});
    deepStrictEqual(
      [input.target, input.rawHostString],
      [{kind: 'plain', text: 'dev'}, 'dev'],
    );
  });

  it('F-2411.6.3: a host with a user and a port keeps both, and names the host in the raw string', () => {
    const input = maintenanceInputOf({host: 'box', user: 'me', port: 2222});
    deepStrictEqual(input.target, {
      kind: 'host',
      hostName: 'box',
      user: 'me',
      port: 2222,
    });
  });

  it('F-2411.6.3: a host with only a user has no port', () => {
    deepStrictEqual(maintenanceInputOf({host: 'box', user: 'me'}).target, {
      kind: 'host',
      hostName: 'box',
      user: 'me',
    });
  });

  it('F-2411.6.3: a host with only a port has no user', () => {
    deepStrictEqual(maintenanceInputOf({host: 'box', port: 22}).target, {
      kind: 'host',
      hostName: 'box',
      port: 22,
    });
  });

  it('F-2411.BR-2: the run is no window, no reconnection and the first attempt', () => {
    const input = maintenanceInputOf({host: 'dev'});
    deepStrictEqual(
      [input.attempt, input.isReconnection, input.windowWorkspace],
      [1, false, undefined],
    );
  });
});
