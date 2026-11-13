import {deepStrictEqual} from 'node:assert';
import {readSelection} from '../tests/acceptance/window-agent/src/terminal-selection.ts';

describe('the selection the window agent reads from a terminal (card #2506)', () => {
  it('#2506: a selection is its text, an empty one is the empty text, and an undefined one is empty too', () => {
    deepStrictEqual(
      [
        readSelection({selection: 'ssh password:'}),
        readSelection({selection: ''}),
        readSelection({selection: undefined}),
      ],
      [
        {kind: 'text', text: 'ssh password:'},
        {kind: 'text', text: ''},
        {kind: 'text', text: ''},
      ],
    );
  });

  it('#2506: no terminal, a terminal without the property, and one whose read throws are unreadable, not empty', () => {
    const refusing = {
      get selection(): string {
        throw new Error('the proposal terminalSelection is not enabled');
      },
    };
    deepStrictEqual(
      [readSelection(undefined), readSelection({}), readSelection(refusing)],
      [{kind: 'unreadable'}, {kind: 'unreadable'}, {kind: 'unreadable'}],
    );
  });
});
