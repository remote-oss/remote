import {deepStrictEqual} from 'node:assert';
import {askpassEnvironment} from '../../src/index.ts';

const REQUEST = {
  launcher: '/run/rh-askpass/rh-askpass-0123456789abcdef',
  endpoint: '/run/ra-0123456789abcdef.sock',
  nonce: 'askpass-nonce',
};

describe('askpass environment', () => {
  it('points ssh at our launcher and forces its use, with the endpoint and the nonce', () => {
    deepStrictEqual(askpassEnvironment({...REQUEST, external: false}), {
      SSH_ASKPASS: '/run/rh-askpass/rh-askpass-0123456789abcdef',
      SSH_ASKPASS_REQUIRE: 'force',
      REMOTE_OSS_ASKPASS_ENDPOINT: '/run/ra-0123456789abcdef.sock',
      REMOTE_OSS_ASKPASS_NONCE: 'askpass-nonce',
    });
  });

  it("adds nothing when the user's own askpass applies, neither SSH_ASKPASS_REQUIRE nor DISPLAY", () => {
    deepStrictEqual(askpassEnvironment({...REQUEST, external: true}), {});
  });
});
