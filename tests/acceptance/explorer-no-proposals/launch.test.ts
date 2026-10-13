import {doesNotReject} from 'node:assert';
import {inWindow} from '../windows/harness.ts';

describe('the explorer launch without proposals (card tooling-30)', function () {
  this.timeout(120000);

  it('tooling-30: the launch without proposals starts and its local window answers the agent', async () => {
    await doesNotReject(inWindow('local', 'acceptance.agent.state'));
  });
});
