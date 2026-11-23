import {deepStrictEqual} from 'node:assert';
import {trials} from './ssh-config-editor.ts';

const TRIALS = 3;

describe('SSH config completion in the editor under test', function () {
  this.timeout(300_000);

  it('Ctrl+Space, a 2.5 s wait and Enter insert the focused keyword (F-4201)', async () => {
    deepStrictEqual(
      await trials(TRIALS, {invoke: true}, 2500),
      Array.from({length: TRIALS}, () => 'AddKeysToAgent'),
    );
  });

  it('typed Protoc, a 2.5 s wait and Enter insert Protocol (F-4201)', async () => {
    deepStrictEqual(
      await trials(TRIALS, {typed: 'Protoc'}, 2500),
      Array.from({length: TRIALS}, () => 'Protocol'),
    );
  });

  it('typed Conf, a 2.5 s wait and Enter insert the Configure tunnel template (F-4202)', async () => {
    deepStrictEqual(
      await trials(TRIALS, {typed: 'Conf'}, 2500),
      Array.from({length: TRIALS}, () => 'Host alias'),
    );
  });
});
