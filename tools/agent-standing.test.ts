import {deepStrictEqual} from 'node:assert';
import {
  holdingText,
  unfinishedCommands,
} from '../tests/acceptance/windows/agent-standing.ts';

const COMMANDS = [
  {id: 'a', command: 'remote-containers.openFolder'},
  {id: 'b', command: 'acceptance.agent.openWindow'},
];

describe('the commands a window’s agent has not finished (card #2829)', () => {
  it('#2829: a command taken and never reported done or failed is named with how long ago it was taken', () => {
    deepStrictEqual(
      unfinishedCommands(
        [
          {event: 'activated', time: 0},
          {event: 'accepted', id: 'a', time: 10_000},
          {event: 'accepted', id: 'b', time: 20_000},
          {event: 'done', id: 'b', time: 21_000},
        ],
        COMMANDS,
        70_000,
      ),
      ['remote-containers.openFolder accepted 60 s ago'],
    );
  });

  it('#2829: a command that failed or is done is not held, and a command the row did not send is named as a command', () => {
    deepStrictEqual(
      [
        unfinishedCommands(
          [
            {event: 'accepted', id: 'a', time: 1000},
            {event: 'failed', id: 'a', time: 2000},
          ],
          COMMANDS,
          5000,
        ),
        unfinishedCommands(
          [{event: 'accepted', id: 'other', time: 1000}],
          COMMANDS,
          3000,
        ),
        unfinishedCommands([], COMMANDS, 3000),
      ],
      [[], ['a command accepted 2 s ago'], []],
    );
  });

  it('#2829: what holds the agent and its last events are each read in their own section, and a read that throws is told in its place', () => {
    deepStrictEqual(
      [
        holdingText(
          () => ['remote-containers.openFolder accepted 60 s ago'],
          () => [{event: 'accepted'}],
        ),
        holdingText(
          () => {
            throw new Error('commands file is being written');
          },
          () => [],
        ),
      ],
      [
        'the commands its agent took and has not finished:\n["remote-containers.openFolder accepted 60 s ago"]; its last events:\n[{"event":"accepted"}]',
        'the commands its agent took and has not finished:\n(unreadable: Error: commands file is being written); its last events:\n[]',
      ],
    );
  });
});
