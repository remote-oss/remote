import {deepStrictEqual} from 'node:assert';
import {recordsOf} from '../tests/acceptance/windows/stored-hints.ts';

/** The file of window `session` holding `events`. */
function fileOf(session: string, ...events: unknown[]) {
  return {session, text: JSON.stringify({events})};
}

/** A record of the resolve that started at `started`, with one log hint of `text`. */
function record(started: string, text = 'log') {
  return {started, hints: [{kind: 'log', text}]};
}

describe('the stored connection hints (#2326, #3099)', () => {
  it('the two newest records over every window’s file show, oldest first', () => {
    deepStrictEqual(
      recordsOf([
        fileOf(
          'w1',
          {kind: 'record', time: 1, record: record('2026-11-01T10:00:00Z')},
          {kind: 'record', time: 3, record: record('2026-11-01T12:00:00Z')},
        ),
        fileOf('w2', {
          kind: 'record',
          time: 2,
          record: record('2026-11-01T11:00:00Z'),
        }),
      ]),
      [record('2026-11-01T11:00:00Z'), record('2026-11-01T12:00:00Z')],
    );
  });

  it('the newest event of a record decides, and a clear hides the records that started before it', () => {
    deepStrictEqual(
      recordsOf([
        fileOf(
          'w3',
          {kind: 'record', time: 1, record: record('2026-11-01T10:00:00Z')},
          {
            kind: 'record',
            time: 5,
            record: record('2026-11-01T10:00:00Z', 'ended'),
          },
          {kind: 'record', time: 2, record: record('2026-11-01T12:00:00Z')},
        ),
        fileOf('w4', {
          kind: 'clear',
          time: 4,
          clearedAt: '2026-11-01T11:00:00Z',
        }),
      ]),
      [record('2026-11-01T12:00:00Z')],
    );
  });

  it('a text that is no JSON, or an event that is not ours, adds nothing', () => {
    deepStrictEqual(
      recordsOf([
        {session: 'w0', text: '{not json'},
        fileOf('w5', 'text', {kind: 'moved', time: 1}, {entry: {}}),
      ]),
      [],
    );
  });

  it('of two events of one record at one time the one of the greater session decides', () => {
    const same = {kind: 'record', time: 7};
    deepStrictEqual(
      recordsOf([
        fileOf('b', {...same, record: record('2026-11-01T10:00:00Z', 'b')}),
        fileOf('a', {...same, record: record('2026-11-01T10:00:00Z', 'a')}),
      ]),
      [record('2026-11-01T10:00:00Z', 'b')],
    );
  });
});
