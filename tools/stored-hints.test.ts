import {deepStrictEqual} from 'node:assert';
import {recordsOf} from '../tests/acceptance/windows/stored-hints.ts';

/** A window's file holding `events`. */
function fileOf(...events: unknown[]): string {
  return JSON.stringify({events});
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
          {kind: 'record', time: 1, record: record('2026-11-01T10:00:00Z')},
          {kind: 'record', time: 3, record: record('2026-11-01T12:00:00Z')},
        ),
        fileOf({
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
          {kind: 'record', time: 1, record: record('2026-11-01T10:00:00Z')},
          {
            kind: 'record',
            time: 5,
            record: record('2026-11-01T10:00:00Z', 'ended'),
          },
          {kind: 'record', time: 2, record: record('2026-11-01T12:00:00Z')},
        ),
        fileOf({kind: 'clear', time: 4, clearedAt: '2026-11-01T11:00:00Z'}),
      ]),
      [record('2026-11-01T12:00:00Z')],
    );
  });

  it('a text that is no JSON, or an event that is not ours, adds nothing', () => {
    deepStrictEqual(
      recordsOf([
        '{not json',
        fileOf('text', {kind: 'moved', time: 1}, {entry: {}}),
      ]),
      [],
    );
  });
});
