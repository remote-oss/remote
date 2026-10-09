import {deepStrictEqual} from 'node:assert';
import {
  activeHostTarget,
  argumentChoice,
  isActiveHostAvailable,
  windowTargetOf,
} from '../../src/connect/window-target.ts';

describe('windowTargetOf (card remote-ssh-02)', () => {
  it('F-2301.BR-1: the open command opens a new window', () => {
    deepStrictEqual(windowTargetOf('opensshremotes.openEmptyWindow'), 'new');
  });

  it('F-2302.BR-1: the current-window command opens in the current window', () => {
    deepStrictEqual(
      windowTargetOf('opensshremotes.openEmptyWindowInCurrentWindow'),
      'current',
    );
  });

  it('F-2303.BR-1: the on-active-host command opens a new window', () => {
    deepStrictEqual(
      windowTargetOf('opensshremotes.openEmptyWindowOnCurrentHost'),
      'new',
    );
  });

  it('F-2302.AC-28: the connect after an add opens a new window', () => {
    deepStrictEqual(windowTargetOf('hostAddedConnect'), 'new');
  });
});

describe('argumentChoice (card remote-ssh-02)', () => {
  it('F-2301.AC-20: no argument means the picker', () => {
    deepStrictEqual(argumentChoice(undefined), {picker: true});
  });

  it('F-2301.AC-20: a plain string argument means the picker', () => {
    deepStrictEqual(argumentChoice('alias'), {picker: true});
  });

  it('F-2301.AC-20: an object without a host means the picker', () => {
    deepStrictEqual(argumentChoice({}), {picker: true});
  });

  it('F-2301.AC-20: a host argument is the host, unchanged', () => {
    deepStrictEqual(argumentChoice({host: 'alpha'}), {host: 'alpha'});
  });

  it('F-2301.AC-34: a host argument is never split or changed', () => {
    deepStrictEqual(
      {
        upper: argumentChoice({host: 'UPPER-Alias'}),
        ported: argumentChoice({host: 'lab@x.invalid:2222'}),
      },
      {
        upper: {host: 'UPPER-Alias'},
        ported: {host: 'lab@x.invalid:2222'},
      },
    );
  });

  it('F-2301.AC-34: an empty host argument is the empty host', () => {
    deepStrictEqual(argumentChoice({host: ''}), {host: ''});
  });

  it('F-2301.AC-34: the other properties of an argument are not read', () => {
    deepStrictEqual(argumentChoice({host: 'unknown.invalid', extra: 1}), {
      host: 'unknown.invalid',
    });
  });

  it('F-2302.AC-27: a host with a user and a port is not split', () => {
    deepStrictEqual(argumentChoice({host: 'lab@h:22'}), {host: 'lab@h:22'});
  });
});

describe('activeHostTarget (card remote-ssh-02)', () => {
  it('F-2303.AC-19: a port of 22 is dropped with the user kept', () => {
    deepStrictEqual(activeHostTarget({host: 'h', user: 'u', port: 22}), {
      host: 'h',
      user: 'u',
    });
  });

  it('F-2303.AC-10: a port other than 22 is kept', () => {
    deepStrictEqual(activeHostTarget({host: 'h', user: 'u', port: 2222}), {
      host: 'h',
      user: 'u',
      port: 2222,
    });
  });

  it('F-2303.AC-5: an alias is the same target', () => {
    deepStrictEqual(activeHostTarget({host: 'alias'}), {host: 'alias'});
  });

  it('F-2303.AC-12: the case of a host is kept', () => {
    deepStrictEqual(activeHostTarget({host: 'UPPER-F2303'}), {
      host: 'UPPER-F2303',
    });
  });

  it('F-2303.BR-2: a user-less port of 22 is dropped', () => {
    deepStrictEqual(activeHostTarget({host: 'h', port: 22}), {host: 'h'});
  });
});

describe('isActiveHostAvailable (card remote-ssh-02)', () => {
  it('F-2303.AC-1: the connected SSH remote is available', () => {
    deepStrictEqual(isActiveHostAvailable('ssh-remote', 'connected'), true);
  });

  it('F-2303.AC-2: no remote name and no state is not available', () => {
    deepStrictEqual(isActiveHostAvailable(undefined, undefined), false);
  });

  it('F-2303.AC-2: an empty name and an empty state are not available', () => {
    deepStrictEqual(isActiveHostAvailable('', ''), false);
  });

  it('F-2303.AC-2: a disconnected SSH remote is not available', () => {
    deepStrictEqual(isActiveHostAvailable('ssh-remote', 'disconnected'), false);
  });

  it('F-2303.AC-2: an SSH remote without a state is not available', () => {
    deepStrictEqual(isActiveHostAvailable('ssh-remote', undefined), false);
  });

  it('F-2303.AC-2: a connected remote of another kind is not available', () => {
    deepStrictEqual(isActiveHostAvailable('wsl', 'connected'), false);
  });

  it('F-2303.AC-2: a remote name that continues the SSH one is not available', () => {
    deepStrictEqual(isActiveHostAvailable('ssh-remote2', 'connected'), false);
  });

  it('F-2303.AC-2: a remote name that starts with the SSH one is not available', () => {
    deepStrictEqual(isActiveHostAvailable('xssh-remote', 'connected'), false);
  });
});
