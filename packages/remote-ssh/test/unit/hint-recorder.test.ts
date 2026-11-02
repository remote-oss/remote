import {deepStrictEqual} from 'node:assert';
import type {FailureHint} from 'lib-ssh';
import {hintRecorderOf} from '../../src/diagnostics/hint-recorder.ts';
import type {HintStore} from '../../src/diagnostics/hint-store.ts';

const HINT: FailureHint = {
  status: 'AllowTcpForwardingDisabled',
  message: {id: 'S150', values: []},
  mitigations: [
    {id: 'S005', values: ['AllowTcpForwarding yes', '/etc/ssh/sshd_config']},
    {id: 'S116', values: []},
  ],
  resources: ['hangingOrFailingConnections'],
};

/** A recorder over an in-memory state, with the clock at `times` in turn. */
function recording(times: string[]) {
  const stored: {value?: HintStore} = {};
  const keys: string[] = [];
  let tick = 0;
  const recorder = hintRecorderOf(
    {
      get: () => stored.value,
      update: (key, value) => {
        keys.push(key);
        stored.value = value;
        return Promise.resolve();
      },
    },
    {
      translate: template => template,
      documentation: () => 'https://docs.example/ssh',
      now: () => new Date(times[tick++] ?? times.at(-1) ?? 0),
    },
  );
  return {recorder, stored, keys};
}

/** Lets the writes the recorder chained finish. */
function settled(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0);
  });
}

describe('the hint recorder (card connect-119)', () => {
  it('F-2604 AC-3: the entry holds the message, the two mitigations in order and the documentation address', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.record(HINT);
    await settled();
    deepStrictEqual(stored.value?.records[0]?.hints, [
      {
        kind: 'error',
        status: 'AllowTcpForwardingDisabled',
        message:
          "The remote server's SSH configuration may have TCP forwarding disabled",
        mitigations: [
          "Add the setting 'AllowTcpForwarding yes' to the server's '/etc/ssh/sshd_config' (or similar) configuration file",
          'Restart the SSH server on the remote machine to apply any changes to the configuration',
        ],
        resources: ['https://docs.example/ssh'],
      },
    ]);
  });

  it('F-2604 AC-22: the hints are written under the key the clear command deletes', async () => {
    const {recorder, keys} = recording(['2026-11-02T00:00:00Z']);
    recorder.record(HINT);
    await settled();
    deepStrictEqual(keys, ['remote.ssh.hints']);
  });

  it('F-2604 AC-22: two hints of one connect share one record', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.record(HINT);
    recorder.record({...HINT, status: 'Other', message: 'Error: Other'});
    await settled();
    deepStrictEqual(
      [stored.value?.records.length, stored.value?.records[0]?.hints.length],
      [1, 2],
    );
  });

  it('F-2604 AC-21: a hint after begin goes to a new record', async () => {
    const {recorder, stored} = recording([
      '2026-11-02T00:00:00Z',
      '2026-11-02T00:01:00Z',
    ]);
    recorder.record(HINT);
    recorder.begin();
    recorder.record(HINT);
    await settled();
    deepStrictEqual(
      stored.value?.records.map(record => record.started),
      ['2026-11-02T00:00:00.000Z', '2026-11-02T00:01:00.000Z'],
    );
  });

  it('F-2604 AC-21: a message that is a text is kept as it is', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.record({...HINT, message: 'Error: Other', mitigations: []});
    await settled();
    deepStrictEqual(
      [
        stored.value?.records[0]?.hints[0]?.kind === 'error' &&
          stored.value.records[0].hints[0].message,
      ],
      ['Error: Other'],
    );
  });

  it('F-2604 AC-22: a write the state refuses does not stop the hint recorded after it', async () => {
    const stored: {value?: HintStore} = {};
    const attempts: string[] = [];
    let refusals = 1;
    const recorder = hintRecorderOf(
      {
        get: () => stored.value,
        update: (key, value) => {
          attempts.push(key);
          if (refusals > 0) {
            refusals -= 1;
            return Promise.reject(new Error('refused'));
          }
          stored.value = value;
          return Promise.resolve();
        },
      },
      {
        translate: template => template,
        documentation: () => 'https://docs.example/ssh',
        now: () => new Date('2026-11-02T00:00:00Z'),
      },
    );
    recorder.record(HINT);
    recorder.record(HINT);
    await settled();
    deepStrictEqual([stored.value?.records.length, attempts.length], [1, 2]);
  });
});
