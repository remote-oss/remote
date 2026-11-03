import {deepStrictEqual} from 'node:assert';
import type {CommandBus} from 'lib-companion';
import {
  CALL_RECORD_VARIABLE,
  callRecorderOf,
  recordedBus,
} from '../../src/companion/call-record.ts';

describe('the record of the calls the explorer makes to the companion (card explorer-13)', () => {
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
        callRecorderOf({}, ports()),
        callRecorderOf({[CALL_RECORD_VARIABLE]: ''}, ports()),
        callRecorderOf({[CALL_RECORD_VARIABLE]: undefined}, ports()),
      ],
      [undefined, undefined, undefined],
    );
  });

  it('appends one JSON line with the time and the command, and nothing of an argument, to the named file', () => {
    const seen = ports();
    const record = callRecorderOf(
      {[CALL_RECORD_VARIABLE]: '/run/calls.jsonl'},
      seen,
    );
    record?.('remote-internal.getActiveSshRemote');
    record?.('remote-internal.getSshFoldersHistory');
    deepStrictEqual(seen.lines, [
      [
        '/run/calls.jsonl',
        '{"time":1700000000000,"commandId":"remote-internal.getActiveSshRemote"}\n',
      ],
      [
        '/run/calls.jsonl',
        '{"time":1700000000000,"commandId":"remote-internal.getSshFoldersHistory"}\n',
      ],
    ]);
  });

  it('drops a line it cannot write, and records the next', () => {
    const seen = ports();
    let failures = 1;
    const record = callRecorderOf(
      {[CALL_RECORD_VARIABLE]: '/run/calls.jsonl'},
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
    deepStrictEqual(
      [
        record?.('remote-internal.getActiveSshRemote'),
        record?.('remote-internal.getConfiguredHostnames'),
        seen.lines.length,
      ],
      [undefined, undefined, 1],
    );
  });

  it('tells the recorder the command before the bus executes it, passes the answer on, and is the bus itself without a recorder', async () => {
    const events: string[] = [];
    const bus: CommandBus = {
      registerCommand: () => ({dispose: () => undefined}),
      executeCommand: (commandId, argument) => {
        events.push(`execute ${commandId} ${JSON.stringify(argument)}`);
        return Promise.resolve('answer');
      },
    };
    const recorded = recordedBus(bus, commandId => {
      events.push(`record ${commandId}`);
    });
    const answer = await recorded.executeCommand('a.b', {x: 1});
    deepStrictEqual(
      [answer, events, recordedBus(bus, undefined) === bus],
      ['answer', ['record a.b', 'execute a.b {"x":1}'], true],
    );
  });
});
