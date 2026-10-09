import {deepStrictEqual} from 'node:assert';
import {
  effectiveUseLocalServer,
  loginsPerConnect,
  selectTunnelPath,
  type TunnelSettings,
  tunnelDestination,
  userForwardingHolder,
} from '../../src/index.ts';

const ENDPOINT = {port: 41234, socketPath: '/tmp/code-x'};

function settings(
  listenOnSocket: boolean,
  useLocalServer: boolean,
  enableDynamicForwarding: boolean,
): TunnelSettings {
  return {listenOnSocket, useLocalServer, enableDynamicForwarding};
}

describe('effectiveUseLocalServer (card forwarding-04)', () => {
  it('F-2410.BR-2: a socket listen is never a local server', () => {
    deepStrictEqual(
      effectiveUseLocalServer(settings(true, true, false)),
      false,
    );
  });

  it('F-2410.BR-2: without a socket listen, the setting is as set', () => {
    deepStrictEqual(
      [
        effectiveUseLocalServer(settings(false, true, false)),
        effectiveUseLocalServer(settings(false, false, true)),
      ],
      [true, false],
    );
  });
});

describe('selectTunnelPath (card forwarding-04)', () => {
  it('F-2410.BR-1: a socket listen is the socket path', () => {
    deepStrictEqual(
      [
        selectTunnelPath(settings(true, true, true)),
        selectTunnelPath(settings(true, false, false)),
      ],
      ['socket', 'socket'],
    );
  });

  it('F-2410.BR-1: without a socket listen the path is never the socket', () => {
    const paths = (
      [
        [true, true],
        [true, false],
        [false, true],
        [false, false],
      ] as const
    ).map(([useLocalServer, enableDynamicForwarding]) =>
      selectTunnelPath(
        settings(false, useLocalServer, enableDynamicForwarding),
      ),
    );
    deepStrictEqual(paths, ['socks', 'socks', 'socks', 'secondSsh']);
  });
});

describe('loginsPerConnect (card forwarding-04)', () => {
  it('F-2104.BR-2: a SOCKS forward is the connection itself, or none when it reuses', () => {
    deepStrictEqual(
      [loginsPerConnect('socks', false), loginsPerConnect('socks', true)],
      [1, 0],
    );
  });

  it('F-2104.BR-2: a second SSH session and a socket each cost two logins, reuse or not', () => {
    deepStrictEqual(
      [
        loginsPerConnect('secondSsh', false),
        loginsPerConnect('secondSsh', true),
        loginsPerConnect('socket', false),
        loginsPerConnect('socket', true),
      ],
      [2, 2, 2, 2],
    );
  });
});

describe('userForwardingHolder (card forwarding-04)', () => {
  it('F-2104.BR-11: a second SSH session holds its own forwards', () => {
    deepStrictEqual(userForwardingHolder('secondSsh', false), 'tunnelSsh');
  });

  it('F-2104.BR-11: a SOCKS forward rides the local server, or the install connection', () => {
    deepStrictEqual(
      [
        userForwardingHolder('socks', true),
        userForwardingHolder('socks', false),
      ],
      ['localConnectionServer', 'installConnection'],
    );
  });

  it('F-2104.BR-11 (ruled 2026-10-10): a socket tunnel rides its own second login, like the second-ssh path', () => {
    deepStrictEqual(
      [
        userForwardingHolder('socket', true),
        userForwardingHolder('socket', false),
      ],
      ['tunnelSsh', 'tunnelSsh'],
    );
  });
});

describe('tunnelDestination (card forwarding-04)', () => {
  it('F-2104.BR-13: a SOCKS forward and a second SSH session reach the host loopback port', () => {
    deepStrictEqual(
      [
        tunnelDestination('socks', ENDPOINT),
        tunnelDestination('secondSsh', ENDPOINT),
      ],
      ['127.0.0.1:41234', '127.0.0.1:41234'],
    );
  });

  it('F-2410.BR-4: a socket path is the destination as written', () => {
    deepStrictEqual(tunnelDestination('socket', ENDPOINT), '/tmp/code-x');
  });
});
