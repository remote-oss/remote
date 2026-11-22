import {deepStrictEqual} from 'node:assert';
import {commandEventLines} from '../tests/acceptance/windows/agent-events.ts';

const COMMANDS = [
  {id: 'a1', command: 'workbench.action.debug.start'},
  {id: 'b2', command: 'workbench.debug.action.toggleRepl'},
];

describe('the lines of a window agent’s events about its commands (card #2646)', () => {
  it('#2646: each progress event since the start, in order, with its seconds, the command’s name and a failure’s message; other events and earlier ones are left out', () => {
    deepStrictEqual(
      commandEventLines(
        [
          {event: 'accepted', time: 500, id: 'old'},
          {event: 'accepted', time: 1000, id: 'a1'},
          {event: 'state', time: 1200},
          {event: 'failed', time: 2500, id: 'a1', message: 'no launch.json'},
          {event: 'done', time: 4000, id: 'b2'},
        ],
        COMMANDS,
        1000,
        12,
      ),
      [
        '[+0.0 s] accepted workbench.action.debug.start',
        '[+1.5 s] failed workbench.action.debug.start: no launch.json',
        '[+3.0 s] done workbench.debug.action.toggleRepl',
      ],
    );
  });

  it('#2646: a command the agent was not sent by this row is named as a command, and no events give no lines', () => {
    deepStrictEqual(
      [
        commandEventLines(
          [{event: 'accepted', time: 1000, id: 'unknown'}],
          COMMANDS,
          1000,
          12,
        ),
        commandEventLines([], COMMANDS, 1000, 12),
      ],
      [['[+0.0 s] accepted a command'], []],
    );
  });

  it('#2646: no more than the limit are given, the first ones', () => {
    deepStrictEqual(
      commandEventLines(
        [
          {event: 'accepted', time: 1000, id: 'a1'},
          {event: 'done', time: 2000, id: 'a1'},
          {event: 'accepted', time: 3000, id: 'b2'},
        ],
        COMMANDS,
        1000,
        2,
      ),
      [
        '[+0.0 s] accepted workbench.action.debug.start',
        '[+1.0 s] done workbench.action.debug.start',
      ],
    );
  });
});
