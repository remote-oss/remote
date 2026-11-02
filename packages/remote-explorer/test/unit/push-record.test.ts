import {deepStrictEqual} from 'node:assert';
import {
  COMPANION_RECORD_VARIABLE,
  recorderOf,
} from '../../src/companion/push-record.ts';

describe('the record of the pushes the inbox receives (card tooling-107)', () => {
  function ports(): {
    lines: Array<[string, string]>;
    append: (file: string, line: string) => void;
    now: () => number;
  } {
    const lines: Array<[string, string]> = [];
    return {
      lines,
      append: (file, line) => {
        lines.push([file, line]);
      },
      now: () => 1700000000000,
    };
  }

  it('records nothing when the environment names no file, or an empty one', () => {
    deepStrictEqual(
      [
        recorderOf({}, ports()),
        recorderOf({[COMPANION_RECORD_VARIABLE]: ''}, ports()),
        recorderOf({[COMPANION_RECORD_VARIABLE]: undefined}, ports()),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('appends one JSON line with the time, the command and the envelope to the named file', () => {
    const seen = ports();
    const record = recorderOf(
      {[COMPANION_RECORD_VARIABLE]: '/run/companion.jsonl'},
      seen,
    );
    record?.('remote-internal.setActiveFolders', {outcome: 'none'});
    record?.('remote-internal.sshHostsChanged', {});
    deepStrictEqual(seen.lines, [
      [
        '/run/companion.jsonl',
        '{"time":1700000000000,"commandId":"remote-internal.setActiveFolders","envelope":{"outcome":"none"}}\n',
      ],
      [
        '/run/companion.jsonl',
        '{"time":1700000000000,"commandId":"remote-internal.sshHostsChanged","envelope":{}}\n',
      ],
    ]);
  });

  it('drops a line it cannot write, whatever the reason, and records the next', () => {
    const seen = ports();
    let failures = 1;
    const record = recorderOf(
      {[COMPANION_RECORD_VARIABLE]: '/run/companion.jsonl'},
      {
        ...seen,
        append: (file, line) => {
          if (failures > 0) {
            failures -= 1;
            throw new Error('ENOSPC');
          }
          seen.append(file, line);
        },
      },
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    deepStrictEqual(
      [
        record?.('remote-internal.setActiveFolders', {}),
        record?.('remote-internal.setActiveFolders', circular),
        record?.('remote-internal.sshHostsChanged', {}),
        seen.lines.length,
      ],
      [undefined, undefined, undefined, 1],
    );
  });
});
