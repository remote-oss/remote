/**
 * @fileoverview The host named by a kill or uninstall command (card connect-10): the part of the target after
 * the last at sign and before a numeric port, the own-host check, and the two notices by their string ids.
 */

import {deepStrictEqual} from 'node:assert';
import {
  hostPartOf,
  isOwnHost,
  killedNotice,
  killFailedNotice,
} from '../../src/maintenance/target.ts';

describe('hostPartOf (the host of a typed target)', () => {
  it('F-2411.BR-6: a bare host stays as it is', () => {
    deepStrictEqual(hostPartOf('myhost'), 'myhost');
  });

  it('F-2411.BR-6: the user before the at sign is dropped', () => {
    deepStrictEqual(hostPartOf('lab@myhost'), 'myhost');
  });

  it('F-2411.BR-6: the user and a numeric port leave the address', () => {
    deepStrictEqual(hostPartOf('lab@203.0.113.6:2222'), '203.0.113.6');
  });

  it('F-2411.BR-6: a numeric port without a user is removed', () => {
    deepStrictEqual(hostPartOf('203.0.113.6:2222'), '203.0.113.6');
  });

  it('F-2411.BR-6: the text after the last at sign is the host', () => {
    deepStrictEqual(hostPartOf('a@b@host'), 'host');
  });

  it('F-2411.BR-6: a colon followed by letters is not a port', () => {
    deepStrictEqual(hostPartOf('host:abc'), 'host:abc');
  });
});

describe('isOwnHost (the target against the window host)', () => {
  it('F-2411.BR-7: the same host is the own host', () => {
    deepStrictEqual(isOwnHost({host: 'devbox'}, {host: 'devbox'}), true);
  });

  it('F-2411.BR-7: another spelling or different host is not', () => {
    deepStrictEqual(
      [
        isOwnHost({host: 'DEVBOX'}, {host: 'devbox'}),
        isOwnHost({host: '10.0.0.5'}, {host: 'devbox'}),
      ],
      [false, false],
    );
  });

  it('F-2411 6.7: a user or a port makes another host string', () => {
    deepStrictEqual(
      [
        isOwnHost({host: 'devbox', user: 'lab'}, {host: 'devbox'}),
        isOwnHost({host: 'devbox', port: 22}, {host: 'devbox'}),
        isOwnHost({host: 'devbox', user: 'lab'}, {host: 'devbox', user: 'lab'}),
      ],
      [false, false, true],
    );
  });

  it('F-2411.BR-7: no window host is never the own host', () => {
    deepStrictEqual(isOwnHost({host: 'devbox'}, undefined), false);
  });
});

describe('the notices of the kill command', () => {
  it('F-2411.AC-5: killed is the killed id with the host', () => {
    deepStrictEqual(killedNotice('myhost'), {id: 'S085', values: ['myhost']});
  });

  it('F-2411.AC-13: the failed kill is the failure id with the host', () => {
    deepStrictEqual(killFailedNotice('myhost'), {
      id: 'S076',
      values: ['myhost'],
    });
  });

  it('F-2411.AC-11: the host of the target names the notice', () => {
    deepStrictEqual(killedNotice(hostPartOf('lab@myhost:2222')), {
      id: 'S085',
      values: ['myhost'],
    });
  });
});
