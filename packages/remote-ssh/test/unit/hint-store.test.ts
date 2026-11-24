import {deepStrictEqual} from 'node:assert';
import {
  type HintEvents,
  hintEventsOf,
  type SessionRecord,
} from '../../src/diagnostics/hint-store.ts';
import {MemoryFiles} from './event-files.fixture.ts';

/** The folder of the rows' hint files. */
const FOLDER = '/profile/globalStorage/remote-oss.remote-ssh/connection-hints';

function recordAt(
  started: string,
  hints: SessionRecord['hints'] = [{kind: 'log', text: 'log'}],
): SessionRecord {
  return {started, hints};
}

const first = recordAt('2026-10-08T10:00:00Z');
const second = recordAt('2026-10-08T11:00:00Z');
const third = recordAt('2026-10-08T12:00:00Z');
const fourth = recordAt('2026-10-08T13:00:00Z');

/** The hint events of the window `session` over `files`, which hold the value `earlier` under the earlier key. */
function windowOn(
  files: MemoryFiles,
  session: string,
  earlier?: unknown,
): HintEvents {
  return hintEventsOf({
    folder: FOLDER,
    session,
    files,
    earlier: {get: key => (key === 'remote.ssh.hints' ? earlier : undefined)},
    now: () => files.clock,
  });
}

/** Records each of `records` in `events`, firstWindow tick of the clock apart. */
async function recordAll(
  files: MemoryFiles,
  events: HintEvents,
  ...records: SessionRecord[]
): Promise<void> {
  for (const record of records) {
    await events.record(record);
    files.clock += 1;
  }
}

/** Two windows, `aaaa` and `bbbb`, on the same files, each with a store of its own. */
function twoWindows(): {
  files: MemoryFiles;
  firstWindow: HintEvents;
  other: HintEvents;
} {
  const files = new MemoryFiles();
  return {
    files,
    firstWindow: windowOn(files, 'aaaa'),
    other: windowOn(files, 'bbbb'),
  };
}

describe('the hint events of the windows of one folder', () => {
  it('F-2605.AC-16: a window with no file reads no record', () => {
    deepStrictEqual(windowOn(new MemoryFiles(), 'aaaa').read(), {records: []});
  });

  it('F-2605.AC-16, BR-10: the first record is the only one, and records stay oldest first by their start', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa');
    await recordAll(files, events, first);
    const alone = events.read().records;
    await recordAll(files, events, second);
    deepStrictEqual([alone, events.read().records], [[first], [first, second]]);
  });

  it('F-2605.AC-16, BR-10: a third record drops the first and a fourth leaves the two newest, whatever the order they were recorded in', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa');
    await recordAll(files, events, third, first, fourth, second);
    deepStrictEqual(events.read().records, [third, fourth]);
  });

  it('F-2605.AC-17, BR-9: a record keeps all of its hints in order, a long log text whole, and the lists of an error', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa');
    const long = 'line\n'.repeat(5000);
    const full = recordAt('2026-10-08T10:00:00Z', [
      {kind: 'environment', message: 'one', details: 'first'},
      {
        kind: 'error',
        status: 'AllowTcpForwardingDisabled',
        statusNumber: 5,
        message: 'forwarding',
        mitigations: ['add', 'restart'],
        resources: ['https://docs.example/ssh'],
        links: {message: [{start: 0, length: 3}], mitigations: [[], []]},
      },
      {kind: 'log', text: long},
    ]);
    await recordAll(files, events, full);
    deepStrictEqual(windowOn(files, 'bbbb').read().records, [full]);
  });

  it('F-2605.AC-17: a record written again with more hints replaces its earlier state, in the file and in the read', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa');
    const begun = recordAt('2026-10-08T10:00:00Z', [
      {kind: 'environment', message: 'one'},
    ]);
    await recordAll(files, events, begun);
    const ended = recordAt('2026-10-08T10:00:00Z', [
      {kind: 'environment', message: 'one'},
      {kind: 'log', text: 'log'},
    ]);
    await recordAll(files, events, ended);
    deepStrictEqual(windowOn(files, 'bbbb').read().records, [ended]);
  });
});

describe('the hint events written by two windows at once', () => {
  it('#2326, #3099: a resolve recorded by a window that never saw another window’s record keeps both', async () => {
    const {files, firstWindow, other} = twoWindows();
    await recordAll(files, firstWindow, first);
    await recordAll(files, other, second);
    deepStrictEqual(
      [windowOn(files, 'cccc').read().records, files.names(FOLDER).sort()],
      [
        [first, second],
        ['aaaa.json', 'bbbb.json'],
      ],
    );
  });

  it('the control: a store that rewrites one shared value from each window’s own copy loses the record of the window that wrote first', () => {
    const shared: {value: SessionRecord[]} = {value: []};
    const copies = {firstWindow: [...shared.value], other: [...shared.value]};
    shared.value = [...copies.firstWindow, first];
    shared.value = [...copies.other, second];
    deepStrictEqual(shared.value, [second]);
  });

  it('F-2605.AC-16: the two newest of every window’s records show, oldest first, whoever wrote them', async () => {
    const {files, firstWindow, other} = twoWindows();
    await recordAll(files, firstWindow, first, third);
    await recordAll(files, other, second, fourth);
    deepStrictEqual(windowOn(files, 'cccc').read().records, [third, fourth]);
  });

  it('F-2605.AC-22: a clear in one window hides the older records of every window, and a newer record after it shows', async () => {
    const {files, firstWindow, other} = twoWindows();
    await recordAll(files, firstWindow, first);
    await recordAll(files, other, second);
    await firstWindow.clear('2026-10-08T11:30:00Z');
    const cleared = other.read();
    await recordAll(files, other, third);
    deepStrictEqual(
      [cleared, windowOn(files, 'cccc').read()],
      [
        {records: [], clearedAt: '2026-10-08T11:30:00Z'},
        {records: [third], clearedAt: '2026-10-08T11:30:00Z'},
      ],
    );
  });

  it('F-2605.AC-22: a record that began before a clear stays hidden when more hints are written to it', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa');
    await recordAll(files, events, first);
    await events.clear('2026-10-08T10:30:00Z');
    files.clock += 1;
    await events.record(recordAt(first.started, [{kind: 'log', text: 'late'}]));
    deepStrictEqual(events.read(), {
      records: [],
      clearedAt: '2026-10-08T10:30:00Z',
    });
  });

  it('the newest write of one record decides over the older one of another window', async () => {
    const files = new MemoryFiles();
    const older = recordAt(first.started, [{kind: 'log', text: 'older'}]);
    const newer = recordAt(first.started, [{kind: 'log', text: 'newer'}]);
    await recordAll(files, windowOn(files, 'aaaa'), newer);
    files.clock -= 2;
    await recordAll(files, windowOn(files, 'bbbb'), older);
    deepStrictEqual(windowOn(files, 'cccc').read().records, [newer]);
  });
});

describe('what a window’s file keeps', () => {
  it('its two newest records and its newest clear, so that a file stays small', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa');
    await recordAll(files, events, first, second, third, fourth);
    await events.clear('2026-10-08T12:30:00Z');
    await events.clear('2026-10-08T12:45:00Z');
    const written = JSON.parse(files.read(`${FOLDER}/aaaa.json`) ?? '{}') as {
      events: Array<{kind: string; time: number}>;
    };
    deepStrictEqual(written.events.map(each => each.kind).sort(), [
      'clear',
      'record',
      'record',
    ]);
  });
});

describe('the hints an earlier version kept in the global state', () => {
  it('F-2605.AC-16: its records are read as the oldest layer, with a newer record above them', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa', {records: [first, second]});
    const before = events.read().records;
    await recordAll(files, events, third);
    deepStrictEqual(
      [before, events.read().records],
      [
        [first, second],
        [second, third],
      ],
    );
  });

  it('F-2605.AC-22: the time it was cleared hides its older records, and a clear of this version hides more', async () => {
    const files = new MemoryFiles();
    const events = windowOn(files, 'aaaa', {
      records: [first, second],
      clearedAt: '2026-10-08T10:30:00Z',
    });
    const before = events.read();
    await events.clear('2026-10-08T11:30:00Z');
    deepStrictEqual(
      [before, events.read()],
      [
        {records: [second], clearedAt: '2026-10-08T10:30:00Z'},
        {records: [], clearedAt: '2026-10-08T11:30:00Z'},
      ],
    );
  });

  it('a value that is no store, or a record or a hint that does not fit, adds nothing', () => {
    const files = new MemoryFiles();
    deepStrictEqual(
      [
        windowOn(files, 'aaaa', 'text').read().records,
        windowOn(files, 'aaaa', {records: 'x'}).read().records,
        windowOn(files, 'aaaa', {
          records: [
            {started: 3, hints: []},
            {started: first.started, hints: 'x'},
            {started: second.started, hints: [{kind: 'moved'}, 'text']},
          ],
        }).read().records,
      ],
      [[], [], [recordAt(second.started, [])]],
    );
  });
});

describe('the files of other windows that are not hint events', () => {
  it('a file that is no JSON, a record with no start, or a clear with no time adds nothing, and the good events stay', () => {
    const files = new MemoryFiles();
    const good = {kind: 'record', record: first, time: 5};
    const written: ReadonlyArray<readonly [string, string]> = [
      ['aaaa.json', '{not json'],
      [
        'bbbb.json',
        JSON.stringify({
          events: [
            good,
            {kind: 'record', record: {hints: []}, time: 6},
            {kind: 'clear', clearedAt: 7, time: 7},
            {kind: 'unknown', time: 8},
          ],
        }),
      ],
    ];
    for (const [name, text] of written) {
      files.files.set(`${FOLDER}/${name}`, {text, modified: files.clock});
    }
    deepStrictEqual(windowOn(files, 'cccc').read(), {records: [first]});
  });
});
