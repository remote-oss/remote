import {deepStrictEqual} from 'node:assert';
import {
  SOCKS_HANDSHAKE_MILLISECONDS,
  TUNNEL_WAIT_LIMITS,
} from '../../src/index.ts';

describe('the window tunnel bounds', () => {
  it('F-2104 BR-10: the tunnel waits ten seconds to be ready, tried every tenth of a second', () => {
    deepStrictEqual(TUNNEL_WAIT_LIMITS, {
      readyMilliseconds: 10000,
      retryMilliseconds: 100,
      heldBytesMaximum: 16777216,
    });
  });

  it('ruled on #253 Q7: the relay may take ten seconds to open a connection', () => {
    deepStrictEqual(SOCKS_HANDSHAKE_MILLISECONDS, 10000);
  });
});
