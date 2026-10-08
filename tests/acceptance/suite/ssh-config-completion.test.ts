import {deepStrictEqual} from 'node:assert';
import {trials} from './ssh-config-editor.ts';

const TRIALS = 10;

describe('SSH config completion in the editor under test', function () {
  this.timeout(300_000);

  it('F-4201: Ctrl+Space, a 2.5 s wait and Enter insert the focused keyword', async () => {
    deepStrictEqual(
      await trials(TRIALS, {invoke: true}, 2500),
      Array.from({length: TRIALS}, () => 'AddKeysToAgent'),
    );
  });

  it('F-4201: typed Protoc, a 2.5 s wait and Enter insert Protocol', async () => {
    deepStrictEqual(
      await trials(TRIALS, {typed: 'Protoc'}, 2500),
      Array.from({length: TRIALS}, () => 'Protocol'),
    );
  });

  it('F-4202: typed Conf, a 2.5 s wait and Enter insert the Configure tunnel template', async () => {
    deepStrictEqual(
      await trials(TRIALS, {typed: 'Conf'}, 2500),
      Array.from({length: TRIALS}, () => 'Host alias'),
    );
  });
});
