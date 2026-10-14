import {deepStrictEqual} from 'node:assert';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {withNoise} from 'lib-host/testing/noise';
import {firstSetupMarker, setupMarkerOf} from '../../src/index.ts';

const RECORDED = readFileSync(
  path.join(
    import.meta.dirname,
    '..',
    'fixtures',
    'ssh-verbose-dynamic-forward.txt',
  ),
  'utf8',
).split('\n');

describe('the setup report of ssh -v (F-2105, F-2308 BR-5)', () => {
  it('marks the line that says the login succeeded as authenticated', () => {
    deepStrictEqual(
      setupMarkerOf(
        'Authenticated to 192.0.2.10 ([192.0.2.10]:22) using "publickey".',
      ),
      'authenticated',
    );
  });

  it('marks it for a password login and for a host with a user name too', () => {
    deepStrictEqual(
      setupMarkerOf(
        'Authenticated to example.invalid ([192.0.2.10]:2222) using "password".',
      ),
      'authenticated',
    );
  });

  it('marks no debug line, not even one that says authentication', () => {
    deepStrictEqual(
      [
        setupMarkerOf('debug1: Authentications that can continue: publickey'),
        setupMarkerOf('debug1: Authenticated to 192.0.2.10 using "publickey".'),
        setupMarkerOf('Authenticated to nobody'),
        setupMarkerOf(''),
      ],
      [undefined, undefined, undefined, undefined],
    );
  });

  it('finds the first marker in the lines of a recorded run, which is the line before forwarding is set up', () => {
    const position = RECORDED.findIndex(
      line => setupMarkerOf(line) !== undefined,
    );
    deepStrictEqual(
      [firstSetupMarker(RECORDED), RECORDED[position + 1]],
      [
        'authenticated',
        'debug1: Local connections to LOCALHOST:51530 forwarded to remote address socks:0',
      ],
    );
  });

  it('finds no marker in the lines of a run that did not log in', () => {
    deepStrictEqual(
      firstSetupMarker([
        'debug1: Authentications that can continue: publickey',
        'user@host: Permission denied (publickey).',
      ]),
      undefined,
    );
  });

  it('#299: the line that says the key exchange ended is the handshake', () => {
    deepStrictEqual(
      setupMarkerOf('debug1: SSH2_MSG_NEWKEYS received'),
      'handshake',
    );
  });

  it('#299: the handshake line is the same with a trailing carriage return', () => {
    deepStrictEqual(
      setupMarkerOf('debug1: SSH2_MSG_NEWKEYS received\r'),
      'handshake',
    );
  });

  it('#299: the key exchange that is only sent is not the handshake', () => {
    deepStrictEqual(setupMarkerOf('debug1: SSH2_MSG_NEWKEYS sent'), undefined);
  });

  it('F-2308 BR-5: the authentication line is still the marker it was', () => {
    deepStrictEqual(
      setupMarkerOf('Authenticated to dev ([10.0.0.1]:22) using "publickey".'),
      'authenticated',
    );
  });

  it('ADR-0010: the setup report: noise around and inside its stream changes nothing', () => {
    deepStrictEqual(
      withNoise([
        'banner: Authenticated to x using "y"',
        '  debug1: SSH2_MSG_NEWKEYS received',
      ])
        .map(line => setupMarkerOf(line))
        .filter(marker => marker !== undefined),
      [],
    );
  });
});
