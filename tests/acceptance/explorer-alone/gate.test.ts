import {deepStrictEqual} from 'node:assert';
import {inWindow} from '../windows/harness.ts';
import {titleAction, viewRows} from '../windows/renderer.ts';

/** The view's name (F-5101 3.3). */
const VIEW = 'Remotes (Tunnels/SSH)';
const REFRESH = 'Refresh';

describe('the gate rows of explorer slice 1, remote-ssh absent (card coverage-25b, part of #645)', function () {
  this.timeout(120_000);

  it('F-5101 7.E1 (the absent-companion state), F-5902 AC-2: with remote-ssh absent the SSH group shows nothing, and nothing fails', async () => {
    await inWindow('local', 'remoteTargets.focus');
    deepStrictEqual(await viewRows('local', VIEW), []);
    await titleAction('local', VIEW, REFRESH);
    deepStrictEqual(await viewRows('local', VIEW), []);
  });
});
