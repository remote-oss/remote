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
});
