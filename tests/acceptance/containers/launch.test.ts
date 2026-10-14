import {doesNotReject} from 'node:assert';
import {inWindow} from '../windows/harness.ts';

describe('the containers launch (card containers-09)', function () {
  this.timeout(120000);

  it('containers-09: the launch starts and its local window answers the agent', async () => {
    await doesNotReject(inWindow('local', 'acceptance.agent.state'));
  });
});
