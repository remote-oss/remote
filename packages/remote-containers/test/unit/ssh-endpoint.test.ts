import {deepStrictEqual} from 'node:assert';
import {dashHostOf, sshHostOf} from '../../src/engine/ssh-endpoint.ts';

describe('the host of an ssh endpoint (card containers-173, brief-remote-docker-hosts §3)', () => {
  it('F-0205 7.E4: the host part follows the scheme and the last @, and ends at the first colon or slash', () => {
    deepStrictEqual(
      [
        'ssh://box',
        'ssh://user@box',
        'ssh://user@box:22',
        'ssh://box/path',
        'ssh://user@-badhost:22',
        'ssh://a@b@box:2222/x',
        'ssh://user@[::1]:22',
        'ssh://[fe80::1]',
        'ssh://user@[::1',
        'ssh://',
        'ssh://-oProxyCommand=x/p@q',
        'SSH://user@box:22',
        'Ssh://-bad/x@y',
      ].map(sshHostOf),
      [
        'box',
        'box',
        'box',
        'box',
        '-badhost',
        'box',
        '[::1]',
        '[fe80::1]',
        '[::1',
        '',
        '-oProxyCommand=x',
        'box',
        '-bad',
      ],
    );
  });

  it('F-0205 7.E4: an endpoint that is not ssh has no host part', () => {
    deepStrictEqual(
      ['unix:///var/run/docker.sock', 'tcp://box:2376', 'sshx://box', ''].map(
        sshHostOf,
      ),
      [undefined, undefined, undefined, undefined],
    );
  });

  it('F-0205 AC-12: only an ssh host that starts with a dash is a dash host', () => {
    deepStrictEqual(
      [
        'ssh://-badhost',
        'ssh://user@-badhost',
        'ssh://user@-badhost:22/x',
        'ssh://user@good-host',
        'ssh://user@[-x]',
        'tcp://-badhost',
        'ssh://-oProxyCommand=x/p@q',
        'SSH://-badhost',
        undefined,
      ].map(dashHostOf),
      [
        '-badhost',
        '-badhost',
        '-badhost',
        undefined,
        undefined,
        undefined,
        '-oProxyCommand=x',
        '-badhost',
        undefined,
      ],
    );
  });
});
