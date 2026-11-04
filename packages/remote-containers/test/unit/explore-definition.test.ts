import {deepStrictEqual} from 'node:assert';
import {
  ensureExploreDefinition,
  EXPLORE_VOLUME_VARIABLE,
  exploreDefinitionText,
  exploreIdLabels,
  exploredVolumeNameValid,
} from '../../src/volumes/explore-definition.ts';

describe('the definition Explore a Volume opens a volume in (card containers-155)', () => {
  it('F-0705 BR-4, BR-8: the definition is Alpine as root with the volume at /volume read from the variable of the run, naming no volume and no Docker socket', () => {
    deepStrictEqual(
      [
        JSON.parse(exploreDefinitionText()) as Record<string, unknown>,
        exploreDefinitionText().includes('docker.sock'),
      ],
      [
        {
          name: 'Inspect Volume',
          image: 'alpine:3.20',
          remoteUser: 'root',
          workspaceMount: `source=\${localEnv:${EXPLORE_VOLUME_VARIABLE}},target=/volume,type=volume`,
          workspaceFolder: '/volume',
        },
        false,
      ],
    );
  });

  it('F-0705 BR-5: the labels of the reuse key are the volume and the definition’s configuration', () => {
    deepStrictEqual(exploreIdLabels('data', '/t/devcontainer.json'), [
      'vsch.local.volume=data',
      'devcontainer.config_file=/t/devcontainer.json',
    ]);
  });

  it('F-0705 BR-4: the definition is written once, in the folder of its version, and an edit of it stays', async () => {
    const files = new Map<string, string>();
    const ports = {
      storageFolder: '/storage/u',
      join: (...parts: string[]) => parts.join('/'),
      exists: (file: string) => Promise.resolve(files.has(file)),
      write: (file: string, text: string) => {
        files.set(file, text);
        return Promise.resolve();
      },
    };
    const first = await ensureExploreDefinition(ports);
    files.set(first.configFile, '{"edited": true}');
    const second = await ensureExploreDefinition(ports);
    deepStrictEqual(
      [first.folder, first.configFile, second.configFile, [...files.values()]],
      [
        '/storage/u/inspect-volume/1',
        '/storage/u/inspect-volume/1/.devcontainer/devcontainer.json',
        '/storage/u/inspect-volume/1/.devcontainer/devcontainer.json',
        ['{"edited": true}'],
      ],
    );
  });

  it('F-0705 BR-2: a volume name with a character Docker refuses, or one that starts with a symbol, is not a name', () => {
    deepStrictEqual(
      ['data', 'v1_a.b-c', 'a,b', '-x', 'a b', '${x}', ''].map(
        exploredVolumeNameValid,
      ),
      [true, true, false, false, false, false, false],
    );
  });
});
