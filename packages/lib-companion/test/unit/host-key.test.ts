/**
 * @fileoverview The host key of an SSH window's authority, and the exact match of a key against the configured
 * aliases (task-companion-03).
 */

import {deepStrictEqual, strictEqual} from 'node:assert';
import {hostKeyOfAuthority, isConfiguredAlias} from '../../src/index.ts';

/** The encoded form of a typed user@host authority, as the window carries it. */
const HEX_KEY =
  '7b22686f73744e616d65223a22616c706861222c2275736572223a226c6162227d';

describe('hostKeyOfAuthority (task-companion-03)', () => {
  it('F-3906.RR-2: the key is everything after the prefix, case kept', () => {
    deepStrictEqual(
      [
        hostKeyOfAuthority('ssh-remote+build-box'),
        hostKeyOfAuthority('ssh-remote+Build-Box'),
      ],
      ['build-box', 'Build-Box'],
    );
  });

  it('F-3906.RR-2: the encoded form of a typed user@host is kept unchanged', () => {
    strictEqual(hostKeyOfAuthority(`ssh-remote+${HEX_KEY}`), HEX_KEY);
  });

  it('F-3906.RR-2: a later plus is kept', () => {
    strictEqual(hostKeyOfAuthority('ssh-remote+a+b'), 'a+b');
  });

  it('F-3906.RR-2: a wsl authority has no host key', () => {
    strictEqual(hostKeyOfAuthority('wsl+Ubuntu'), undefined);
  });

  it('F-3906.RR-2: a container authority has no host key', () => {
    strictEqual(hostKeyOfAuthority('dev-container+abc'), undefined);
  });

  it('F-3906.RR-2: a tunnel authority has no host key', () => {
    strictEqual(hostKeyOfAuthority('tunnel+x'), undefined);
  });

  it('F-3906.RR-2: the empty authority has no host key', () => {
    strictEqual(hostKeyOfAuthority(''), undefined);
  });

  it('F-3906.RR-2: an authority without the plus has no host key', () => {
    strictEqual(hostKeyOfAuthority('ssh-remote'), undefined);
  });

  it('F-3906.RR-2: the prefix in another case has no host key', () => {
    strictEqual(hostKeyOfAuthority('SSH-REMOTE+x'), undefined);
  });

  it('F-3906.RR-2: an authority with a leading blank has no host key', () => {
    strictEqual(hostKeyOfAuthority(' ssh-remote+x'), undefined);
  });
});

describe('isConfiguredAlias (task-companion-03)', () => {
  it('F-5103.BR-6: an exactly typed alias is configured', () => {
    strictEqual(isConfiguredAlias('lab-box', ['lab-box', 'other']), true);
  });

  it('F-5103.BR-6: the alias in another case is not configured', () => {
    strictEqual(isConfiguredAlias('Lab-Box', ['lab-box']), false);
  });

  it('F-5103.BR-6: no aliases are not a configured alias', () => {
    strictEqual(isConfiguredAlias('lab-box', []), false);
  });

  it('F-3906.RR-2: the encoded form of a typed user@host matches no alias', () => {
    strictEqual(isConfiguredAlias(HEX_KEY, ['alpha', 'lab']), false);
  });
});
