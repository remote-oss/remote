import {deepStrictEqual} from 'node:assert';
import {
  type LogFolderPorts,
  logFilesOf,
} from '../../src/logging/log-discovery.ts';

const ROOT = '/logs';
const OURS = '/logs/20261104T120000/window1/exthost/oss.remote-containers';
const FIRST = 'remoteContainers-2026-11-04T12-00-00.000Z.log';
const SECOND = 'shutdownMonitor-2026-11-04T12-00-00.000Z.log';
const OLDER = 'remoteContainers-2026-11-03T08-30-00.500Z.log';

/** A disk of `tree`: folder path to the names in it, and file path to size. */
function diskOf(
  tree: Readonly<Record<string, readonly string[]>>,
  sizes: Readonly<Record<string, number>>,
): LogFolderPorts {
  return {
    names: folder => Promise.resolve([...(tree[folder] ?? [])]),
    sizeOf: file => Promise.resolve(sizes[file]),
  };
}

describe('the log files of the profile (card containers-186, F-0104 BR-5)', () => {
  it('F-0104 BR-5, AC-13: files of this window, of its sessions’ other windows and of other sessions are all found, sized as they are, and nothing else is', async () => {
    const found = await logFilesOf(
      OURS,
      diskOf(
        {
          [ROOT]: ['20261104T120000', '20261103T083000', 'main.log'],
          '/logs/20261104T120000': ['window1', 'window2', 'exthost', 'notes'],
          '/logs/20261103T083000': ['window1'],
          [OURS]: [FIRST, SECOND, 'other.log', `${FIRST}.bak`],
          '/logs/20261104T120000/window2/exthost/oss.remote-containers': [
            'remoteContainers-2026-11-04T12-05-00.000Z.log',
          ],
          '/logs/20261103T083000/window1/exthost/oss.remote-containers': [
            OLDER,
          ],
        },
        {
          [`${OURS}/${FIRST}`]: 120,
          [`${OURS}/${SECOND}`]: 40,
          '/logs/20261104T120000/window2/exthost/oss.remote-containers/remoteContainers-2026-11-04T12-05-00.000Z.log': 7,
          [`/logs/20261103T083000/window1/exthost/oss.remote-containers/${OLDER}`]: 3000,
        },
      ),
    );
    deepStrictEqual(
      found.map(each => [each.kind, each.start, each.size]),
      [
        ['remoteContainers', '2026-11-04T12-00-00.000Z', 120],
        ['shutdownMonitor', '2026-11-04T12-00-00.000Z', 40],
        ['remoteContainers', '2026-11-04T12-05-00.000Z', 7],
        ['remoteContainers', '2026-11-03T08-30-00.500Z', 3000],
      ],
    );
  });

  it('F-0104 BR-5: a file that cannot be sized and a folder that cannot be read are left out', async () => {
    deepStrictEqual(
      await logFilesOf(
        OURS,
        diskOf(
          {
            [ROOT]: ['20261104T120000'],
            '/logs/20261104T120000': ['window1'],
            [OURS]: [FIRST],
          },
          {},
        ),
      ),
      [],
    );
  });
});
