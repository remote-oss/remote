import {deepStrictEqual} from 'node:assert';
import {emptyProbe} from '../tests/acceptance/windows/empty-probe.ts';

describe('the probe of a window with no folder (card #3074)', () => {
  it('#3074: the probe is a full URI on the authority of the host, which the agent writes as it is, and the file the host holds', () => {
    deepStrictEqual(emptyProbe('empty-16', '127.0.0.1'), {
      folder: '/home/harness/empty-16-probe',
      file: '/home/harness/empty-16-probe/probe.txt',
      uri: 'vscode-remote://ssh-remote+127.0.0.1/home/harness/empty-16-probe/probe.txt',
    });
  });

  it('#3074: the probe names the window, the authority and the account, and never a path relative to a folder', () => {
    const probe = emptyProbe('empty-3', 'harness', 'harness-bash');
    deepStrictEqual(
      [
        probe.folder,
        probe.uri,
        // The agent writes a name with `://` as a full URI and any other name under the window's first folder.
        probe.uri.includes('://'),
      ],
      [
        '/home/harness-bash/empty-3-probe',
        'vscode-remote://ssh-remote+harness/home/harness-bash/empty-3-probe/probe.txt',
        true,
      ],
    );
  });
});
