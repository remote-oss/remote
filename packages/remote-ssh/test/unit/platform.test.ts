import {deepStrictEqual} from 'node:assert';
import {
  decidePlatform,
  platformEntry,
  type PlatformSettings,
  platformWrite,
  remoteCommandInEffect,
} from '../../src/pipeline/platform.ts';

function settings(changes: Partial<PlatformSettings> = {}): PlatformSettings {
  return {
    useLocalServer: true,
    remotePlatform: {},
    windowsRemotes: [],
    ...changes,
  };
}

describe('the entries of the remote platform setting', () => {
  it('an exact key gives its platform', () => {
    deepStrictEqual(platformEntry({devbox: 'linux'}, 'devbox'), 'linux');
  });

  it('is case-sensitive in the key and in the value', () => {
    deepStrictEqual(
      [
        platformEntry({DevBox: 'linux'}, 'devbox'),
        platformEntry({devbox: 'Linux'}, 'devbox'),
      ],
      [undefined, undefined],
    );
  });

  it('a star stands for any run of characters, anywhere, and a question mark is itself', () => {
    deepStrictEqual(
      [
        platformEntry({'*': 'linux'}, 'anything'),
        platformEntry({'lab-*': 'macOS'}, 'lab-one'),
        platformEntry({'*.invalid': 'windows'}, 'host.invalid'),
        platformEntry({'a?c': 'linux'}, 'abc'),
        platformEntry({'a?c': 'linux'}, 'a?c'),
      ],
      ['linux', 'macOS', 'windows', undefined, 'linux'],
    );
  });

  it('an exact key wins over every pattern, whatever the order', () => {
    deepStrictEqual(
      platformEntry({'*': 'windows', devbox: 'linux'}, 'devbox'),
      'linux',
    );
  });

  it('among patterns the first that matches wins', () => {
    deepStrictEqual(
      platformEntry({'lab-*': 'macOS', '*': 'linux'}, 'lab-one'),
      'macOS',
    );
  });

  it('an entry with another value counts as none, and the next match is used', () => {
    deepStrictEqual(
      platformEntry({devbox: 'solaris', '*': 'linux'}, 'devbox'),
      'linux',
    );
  });

  it('a setting that is no map gives nothing', () => {
    deepStrictEqual(
      [
        platformEntry('linux', 'devbox'),
        platformEntry(['devbox'], 'devbox'),
        platformEntry(null, 'devbox'),
      ],
      [undefined, undefined, undefined],
    );
  });
});

describe('how the platform is found out', () => {
  it('a host listed as Windows is Windows in both modes, even over a linux entry', () => {
    deepStrictEqual(
      [
        decidePlatform(
          settings({
            windowsRemotes: ['devbox'],
            remotePlatform: {devbox: 'linux'},
          }),
          'devbox',
        ),
        decidePlatform(
          settings({useLocalServer: false, windowsRemotes: ['devbox']}),
          'devbox',
        ),
      ],
      [
        {kind: 'decided', platform: 'windows'},
        {kind: 'decided', platform: 'windows'},
      ],
    );
  });

  it('the windows list is exact names, not patterns', () => {
    deepStrictEqual(
      decidePlatform(settings({windowsRemotes: ['win-*']}), 'win-one'),
      {kind: 'probe'},
    );
  });

  it('a windows entry decides in both modes', () => {
    deepStrictEqual(
      [
        decidePlatform(
          settings({remotePlatform: {devbox: 'windows'}}),
          'devbox',
        ),
        decidePlatform(
          settings({
            useLocalServer: false,
            remotePlatform: {devbox: 'windows'},
          }),
          'devbox',
        ),
      ],
      [
        {kind: 'decided', platform: 'windows'},
        {kind: 'decided', platform: 'windows'},
      ],
    );
  });

  it('a linux or macOS entry decides only without the shared connection; with it, the probe decides', () => {
    deepStrictEqual(
      [
        decidePlatform(settings({remotePlatform: {devbox: 'macOS'}}), 'devbox'),
        decidePlatform(
          settings({useLocalServer: false, remotePlatform: {devbox: 'macOS'}}),
          'devbox',
        ),
      ],
      [{kind: 'probe'}, {kind: 'decided', platform: 'macOS'}],
    );
  });

  it('with no entry the probe finds out, or, without the shared connection, the user is asked', () => {
    deepStrictEqual(
      [
        decidePlatform(settings(), 'devbox'),
        decidePlatform(settings({useLocalServer: false}), 'devbox'),
      ],
      [{kind: 'probe'}, {kind: 'ask'}],
    );
  });
});

describe('the remote command', () => {
  it('is in effect when it is enabled, the shared connection is on and no entry names the host', () => {
    deepStrictEqual(remoteCommandInEffect(true, settings(), 'devbox'), true);
  });

  it('is not in effect when it is not enabled', () => {
    deepStrictEqual(remoteCommandInEffect(false, settings(), 'devbox'), false);
  });

  it('is not in effect without the shared connection', () => {
    deepStrictEqual(
      remoteCommandInEffect(true, settings({useLocalServer: false}), 'devbox'),
      false,
    );
  });

  it('is not in effect for a host an entry names, a pattern included', () => {
    deepStrictEqual(
      [
        remoteCommandInEffect(
          true,
          settings({remotePlatform: {devbox: 'linux'}}),
          'devbox',
        ),
        remoteCommandInEffect(
          true,
          settings({remotePlatform: {'dev*': 'macOS'}}),
          'devbox',
        ),
      ],
      [false, false],
    );
  });

  it('is still in effect for a host whose entry has an invalid value', () => {
    deepStrictEqual(
      remoteCommandInEffect(
        true,
        settings({remotePlatform: {devbox: 'Linux'}}),
        'devbox',
      ),
      true,
    );
  });
});

describe('what is written to the remote platform setting', () => {
  const SHARED_OFF = {useLocalServer: false};

  it('a missing key is set to the reported platform', () => {
    deepStrictEqual(platformWrite(settings(SHARED_OFF), 'devbox', 'linux'), {
      kind: 'set',
      platform: 'linux',
    });
  });

  it('a key with another value is set to the reported platform', () => {
    deepStrictEqual(
      platformWrite(
        settings({...SHARED_OFF, remotePlatform: {devbox: 'macOS'}}),
        'devbox',
        'linux',
      ),
      {kind: 'set', platform: 'linux'},
    );
  });

  it('a key that already holds the reported platform is left alone', () => {
    deepStrictEqual(
      platformWrite(
        settings({...SHARED_OFF, remotePlatform: {devbox: 'linux'}}),
        'devbox',
        'linux',
      ),
      {kind: 'none'},
    );
  });

  it('a pattern is never changed: a host it matches still gets its own exact key', () => {
    deepStrictEqual(
      platformWrite(
        settings({...SHARED_OFF, remotePlatform: {'dev*': 'linux'}}),
        'devbox',
        'linux',
      ),
      {kind: 'set', platform: 'linux'},
    );
  });

  it('nothing is written with the shared connection on', () => {
    deepStrictEqual(platformWrite(settings(), 'devbox', 'linux'), {
      kind: 'none',
    });
  });

  it('a setting that is no map is treated as having no key', () => {
    deepStrictEqual(
      platformWrite(
        settings({...SHARED_OFF, remotePlatform: 'linux'}),
        'devbox',
        'linux',
      ),
      {kind: 'set', platform: 'linux'},
    );
  });
});

describe('the platform rows of F-2206', () => {
  it('F-2206 AC-18: an exact key wins over a wildcard, in either order', () => {
    deepStrictEqual(
      [
        platformEntry({'*': 'windows', devbox: 'linux'}, 'devbox'),
        platformEntry({devbox: 'linux', '*': 'windows'}, 'devbox'),
      ],
      ['linux', 'linux'],
    );
  });

  it('F-2206 AC-19: of two matching wildcards the first wins, so the swapped order connects', () => {
    deepStrictEqual(
      [
        decidePlatform(
          settings({remotePlatform: {'lab-*': 'windows', 'lab-one*': 'linux'}}),
          'lab-one-x',
        ),
        decidePlatform(
          settings({remotePlatform: {'lab-one*': 'linux', 'lab-*': 'windows'}}),
          'lab-one-x',
        ),
      ],
      [{kind: 'decided', platform: 'windows'}, {kind: 'probe'}],
    );
  });

  it('F-2206 AC-20: an upper-case key, an address key and a key with ? never match; a *<suffix> key does', () => {
    deepStrictEqual(
      ['DEVBOX', '192.0.2.10', 'devb?x', '*box'].map(key =>
        decidePlatform(
          settings({remotePlatform: {[key]: 'windows'}}),
          'devbox',
        ),
      ),
      [
        {kind: 'probe'},
        {kind: 'probe'},
        {kind: 'probe'},
        {kind: 'decided', platform: 'windows'},
      ],
    );
  });

  it('F-2206 AC-22: a wildcard in remote.SSH.windowsRemotes has no effect in default mode', () => {
    deepStrictEqual(
      decidePlatform(settings({windowsRemotes: ['lab-*']}), 'lab-one'),
      {kind: 'probe'},
    );
  });
});
