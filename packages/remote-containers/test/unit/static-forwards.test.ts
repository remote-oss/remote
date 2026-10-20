import {deepStrictEqual} from 'node:assert';
import {
  appPortOf,
  engineIsLocal,
  staticForwards,
} from '../../src/ports/static-forwards.ts';

describe('the Statically Forwarded rows of appPort (card containers-74)', () => {
  it('F-1101 BR-8, BR-15: a port number is published on 127.0.0.1 and shown at that address', () => {
    deepStrictEqual(staticForwards([8080], true), [
      {
        remoteAddress: {host: '0.0.0.0', port: 8080},
        localAddress: '127.0.0.1:8080',
      },
    ]);
  });

  it('F-1101 BR-20, AC-40: a host:container string is shown at the host port on [::1], for the container port', () => {
    deepStrictEqual(staticForwards(['18742:8742'], true), [
      {
        remoteAddress: {host: '0.0.0.0', port: 8742},
        localAddress: '[::1]:18742',
      },
    ]);
  });

  it('F-1101 BR-15: the entries keep their order, and a single number or string is a list of one', () => {
    deepStrictEqual(
      [
        staticForwards([9, '10:11'], true).map(
          tunnel => tunnel.remoteAddress.port,
        ),
        staticForwards(9, true).length,
        staticForwards('10:11', true).length,
      ],
      [[9, 11], 1, 1],
    );
  });

  it('F-1101 BR-15: an entry that is not a port or a host:container pair of ports is left out', () => {
    deepStrictEqual(
      staticForwards(
        [0, 65536, 1.5, '3000', '0:80', '80:70000', 'a:80', null, {}],
        true,
      ),
      [],
    );
  });

  it('F-1101 BR-22, AC-29: an engine that is not on this machine gives no rows', () => {
    deepStrictEqual(staticForwards([8080, '1:2'], false), []);
  });

  it('F-1101 BR-14: no appPort gives no rows', () => {
    deepStrictEqual(staticForwards(undefined, true), []);
  });

  it('F-1101 BR-14: a Compose configuration has no appPort of its own', () => {
    deepStrictEqual(
      [
        appPortOf({appPort: [1], dockerComposeFile: 'compose.yml'}),
        appPortOf({appPort: [1]}),
      ],
      [undefined, [1]],
    );
  });

  it('F-1101 AC-23: the engine is local with no context and with DOCKER_HOST unset, empty or a unix socket', () => {
    deepStrictEqual(
      [undefined, '', 'unix:///var/run/docker.sock'].map(dockerHost =>
        engineIsLocal({context: undefined, dockerHost}),
      ),
      [true, true, true],
    );
  });

  it('F-1101 AC-23: the engine is not local with a DOCKER_HOST that is not a socket, or with a named context', () => {
    deepStrictEqual(
      [
        engineIsLocal({context: undefined, dockerHost: 'tcp://10.0.0.5:2375'}),
        engineIsLocal({context: undefined, dockerHost: 'ssh://user@box'}),
        engineIsLocal({context: 'desktop-linux', dockerHost: undefined}),
      ],
      [false, false, false],
    );
  });
});
