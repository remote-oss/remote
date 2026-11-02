import {deepStrictEqual} from 'node:assert';
import {clientPlatformOf} from '../../src/index.ts';

describe('the client platform of a Node platform', () => {
  it('F-2101: macOS is the client platform of darwin', () => {
    deepStrictEqual(clientPlatformOf('darwin'), 'macOS');
  });

  it('F-2101: Windows is the client platform of win32', () => {
    deepStrictEqual(clientPlatformOf('win32'), 'windows');
  });

  it('F-2101: any other platform, an unknown one included, is Linux', () => {
    deepStrictEqual(
      ['linux', 'freebsd', 'plan9'].map(platform => clientPlatformOf(platform)),
      ['linux', 'linux', 'linux'],
    );
  });
});
