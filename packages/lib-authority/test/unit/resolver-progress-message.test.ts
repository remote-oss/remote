import {deepStrictEqual} from 'node:assert';
import {phaseMessage} from '../../src/index.ts';

describe('the message of a connect stage', () => {
  it('F-2304 §3.3: the first stage has the details link in front', () => {
    deepStrictEqual(
      phaseMessage(
        'Initializing VS Code Server',
        true,
        'opensshremotes.showDetails',
      ),
      '([details](command:opensshremotes.showDetails)) Initializing VS Code Server',
    );
  });

  it('F-2304 §3.3: a later stage is its text alone', () => {
    deepStrictEqual(
      phaseMessage(
        'Initializing VS Code Server',
        false,
        'opensshremotes.showDetails',
      ),
      'Initializing VS Code Server',
    );
  });

  it('connect-113, F-2308 AC-7: a link title is written after the command', () => {
    deepStrictEqual(
      phaseMessage(
        'Setting up SSH tunnel',
        true,
        'opensshremotes.showDetails',
        'Show details in terminal',
      ),
      '([details](command:opensshremotes.showDetails "Show details in terminal")) Setting up SSH tunnel',
    );
  });

  it('connect-113: a quote in the title is escaped', () => {
    deepStrictEqual(
      phaseMessage('Stage', true, 'command.id', 'say "hi"'),
      '([details](command:command.id "say \\"hi\\"")) Stage',
    );
  });

  it('connect-113: a title without the link is not written', () => {
    deepStrictEqual(
      phaseMessage('Stage', false, 'command.id', 'Title'),
      'Stage',
    );
  });
});
