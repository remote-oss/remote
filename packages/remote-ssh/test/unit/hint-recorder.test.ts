import type {DiagnosticStringId} from 'lib-ssh';
import {deepStrictEqual} from 'node:assert';
import type {FailureHint} from 'lib-ssh';
import {hintRecorderOf} from '../../src/diagnostics/hint-recorder.ts';
import type {HintStore} from '../../src/diagnostics/hint-store.ts';

const ENVIRONMENT = [
  {kind: 'environment' as const, message: 'one', details: 'first'},
  {kind: 'environment' as const, message: 'two'},
];

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
      environmentHints: () => ENVIRONMENT,
      logText: () => 'the log\nlines',
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
        statusNumber: 5,
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
        environmentHints: () => [],
        logText: () => '',
      },
    );
    recorder.record(HINT);
    recorder.record(HINT);
    await settled();
    deepStrictEqual([stored.value?.records.length, attempts.length], [1, 2]);
  });

  it('F-2405 AC-20: the details of a hint, a text or a string of the table, are kept as text', async () => {
    const {recorder, stored} = recording([
      '2026-11-02T00:00:00Z',
      '2026-11-02T00:01:00Z',
    ]);
    recorder.record({...HINT, details: {text: '194'}});
    recorder.begin();
    recorder.record({...HINT, details: {id: 'S116'}});
    await settled();
    deepStrictEqual(
      stored.value?.records.map(record => {
        const error = record.hints.find(hint => hint.kind === 'error');
        return error?.kind === 'error' ? error.details : undefined;
      }),
      [
        '194',
        'Restart the SSH server on the remote machine to apply any changes to the configuration',
      ],
    );
  });

  /** An id that no table holds, typed as the ids are. */
  const UNKNOWN = 'S999' as unknown as DiagnosticStringId;

  it('connect-121: a message, a mitigation and details each come from the failure table or ours, and an id in neither table is kept as the id, with no throw', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.record({
      ...HINT,
      message: {id: 'S094', values: []},
      mitigations: [
        {id: 'S116', values: []},
        {id: UNKNOWN, values: []},
      ],
      details: {id: UNKNOWN},
    });
    await settled();
    const [hint] = stored.value?.records[0]?.hints ?? [];
    deepStrictEqual(
      hint?.kind === 'error'
        ? [hint.message, hint.mitigations, hint.details]
        : undefined,
      [
        'Network is unreachable',
        [
          'Restart the SSH server on the remote machine to apply any changes to the configuration',
          'S999',
        ],
        'S999',
      ],
    );
  });

  it('F-2604 AC-14: the details of the man-in-the-middle hint, S107 of the failure table, are kept as its text', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.record({
      ...HINT,
      status: 'MitmPortForwardingDisabled',
      details: {id: 'S107'},
    });
    await settled();
    deepStrictEqual(
      stored.value?.records.map(record =>
        record.hints[0]?.kind === 'error' ? record.hints[0].details : undefined,
      ),
      ['Port forwarding is disabled'],
    );
  });

  it('F-2605.AC-16: every resolve starts a record with the environment hints, success or failure', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.begin();
    await settled();
    deepStrictEqual(stored.value?.records, [
      {started: '2026-11-02T00:00:00.000Z', hints: ENVIRONMENT},
    ]);
  });

  it('F-2605.AC-17: the error hints follow the environment hints with their numbers, and the log hint comes when the step ends', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.begin();
    recorder.record(HINT);
    recorder.record({...HINT, status: 'Unnumbered', message: 'Error: x'});
    recorder.end();
    await settled();
    deepStrictEqual(
      stored.value?.records[0]?.hints.map(hint =>
        hint.kind === 'error'
          ? [hint.kind, hint.status, hint.statusNumber]
          : [hint.kind, hint.kind === 'log' ? hint.text : hint.message],
      ),
      [
        ['environment', 'one'],
        ['environment', 'two'],
        ['error', 'AllowTcpForwardingDisabled', 5],
        ['error', 'Unnumbered', undefined],
        ['log', 'the log\nlines'],
      ],
    );
  });

  it('F-2605.7.E2: an error recognised after the step ended follows the log hint', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.begin();
    recorder.end();
    recorder.record(HINT);
    await settled();
    deepStrictEqual(
      stored.value?.records[0]?.hints.map(hint => hint.kind),
      ['environment', 'environment', 'log', 'error'],
    );
  });

  it('F-2605.AC-17: the log hint is added once per record, and not for a resolve that never began', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.end();
    recorder.begin();
    recorder.end();
    recorder.end();
    await settled();
    deepStrictEqual(
      stored.value?.records[0]?.hints.filter(hint => hint.kind === 'log')
        .length,
      1,
    );
  });

  it('F-2605.AC-16: each resolve is a record of its own, and the oldest of three is dropped', async () => {
    const {recorder, stored} = recording([
      '2026-11-02T00:00:00Z',
      '2026-11-02T00:00:01Z',
      '2026-11-02T00:00:02Z',
      '2026-11-02T00:00:03Z',
    ]);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      recorder.begin();
      recorder.end();
    }
    await settled();
    deepStrictEqual(
      stored.value?.records.map(record => record.started),
      ['2026-11-02T00:00:02.000Z', '2026-11-02T00:00:03.000Z'],
    );
  });

  it('F-2605.AC-17: an error met from two places in one connect is kept once', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.begin();
    recorder.record(HINT);
    await settled();
    recorder.record(HINT);
    recorder.record({...HINT, message: {id: 'S116', values: []}});
    await settled();
    deepStrictEqual(
      stored.value?.records[0]?.hints.filter(hint => hint.kind === 'error')
        .length,
      2,
    );
  });

  it('F-2605.AC-22: a record that was cleared does not come back with the hints that follow it', async () => {
    const {recorder, stored} = recording(['2026-11-02T00:00:00Z']);
    recorder.begin();
    await settled();
    delete stored.value;
    recorder.record(HINT);
    recorder.end();
    await settled();
    deepStrictEqual(Object.keys(stored), []);
  });

  it('F-2605.AC-22: a resolve that begins after a clear starts a record again', async () => {
    const {recorder, stored} = recording([
      '2026-11-02T00:00:00Z',
      '2026-11-02T00:00:01Z',
      '2026-11-02T00:00:02Z',
    ]);
    function current(): HintStore | undefined {
      return stored.value;
    }
    recorder.begin();
    await settled();
    delete stored.value;
    recorder.begin();
    recorder.end();
    await settled();
    deepStrictEqual(
      current()?.records.map(record => record.started),
      ['2026-11-02T00:00:02.000Z'],
    );
  });
});
