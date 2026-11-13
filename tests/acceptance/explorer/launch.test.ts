import {doesNotReject} from 'node:assert';
import {inWindow} from '../windows/harness.ts';
import {reloadedWindow} from './reloaded-window.ts';

describe('the explorer launch (card tooling-30)', function () {
  this.timeout(120000);

  it('tooling-30: the explorer launch starts and its window answers the agent', async () => {
    await doesNotReject(async () =>
      inWindow(await reloadedWindow(), 'acceptance.agent.state'),
    );
  });
});
