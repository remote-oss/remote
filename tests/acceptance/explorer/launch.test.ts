import {doesNotReject} from 'node:assert';
import {inWindow} from '../windows/harness.ts';

describe('the explorer launch (card tooling-30)', function () {
  this.timeout(120000);

  it('tooling-30: the explorer launch starts and its window answers the agent', async () => {
    // The gate rows run before this one and reload `local` onto `empty-2`.
    await doesNotReject(inWindow('empty-2', 'acceptance.agent.state'));
  });
});
