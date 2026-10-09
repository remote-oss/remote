import {deepStrictEqual} from 'node:assert';
import {forwardingBlock} from '../../src/index.ts';

describe('forwardingBlock (the option that forbids a forwarding path)', () => {
  it('F-2104.BR-11/7.E4: the socks path of a set option is blocked by the option', () => {
    deepStrictEqual(forwardingBlock({clearAllForwardings: true}, 'socks'), {
      blocked: true,
      reason: 'clearAllForwardings',
    });
  });

  it("forwardingBlock({clearAllForwardings: true}, 'secondSsh') is never blocked", () => {
    deepStrictEqual(forwardingBlock({clearAllForwardings: true}, 'secondSsh'), {
      blocked: false,
    });
  });

  it("forwardingBlock({clearAllForwardings: true}, 'socket') is never blocked", () => {
    deepStrictEqual(forwardingBlock({clearAllForwardings: true}, 'socket'), {
      blocked: false,
    });
  });

  it("forwardingBlock({clearAllForwardings: false}, 'socks') is not blocked", () => {
    deepStrictEqual(forwardingBlock({clearAllForwardings: false}, 'socks'), {
      blocked: false,
    });
  });
});
