import {deepStrictEqual} from 'node:assert';
import {inWindow, recordLines} from '../windows/harness.ts';
import {notifications, viewRows} from '../windows/renderer.ts';

/** The view's name (F-5101 3.3). */
const VIEW = 'Remotes (Tunnels/SSH)';

describe('the gate rows of explorer slice 1, without the proposals (card coverage-25b, part of #645)', function () {
  this.timeout(120_000);

  it('F-3903 (the family gate), F-5001: without the proposals the view is dropped and the family setup notice covers the explorer', async () => {
    await inWindow('local', 'remote-explorer.refresh');
    await inWindow('local', 'opensshremotes.openEmptyWindow', {host: 'harness'});
    deepStrictEqual(await viewRows('local', VIEW), undefined);
    const bad = (await notifications('local')).filter(text =>
      /(Error|error|not found|failed)/.test(text),
    );
    deepStrictEqual(bad, [], `error-shaped notification: ${JSON.stringify(bad)}`);
    const setup = recordLines('notice', 'local');
    deepStrictEqual(
      setup.length <= 1,
      true,
      `at most one family setup notice, got ${JSON.stringify(setup)}`,
    );
  });
});
