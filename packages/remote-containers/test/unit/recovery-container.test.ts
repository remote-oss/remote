import {deepStrictEqual} from 'node:assert';
import path from 'node:path';
import {
  recoveryConfigFileOf,
  recoveryConfigurationOf,
  recoveryDecisionOf,
  recoveryIdLabels,
  recoveryTargetOf,
} from '../../src/volumes/recovery-container.ts';
import {
  type DevContainerVolume,
  UNIQUE_VOLUME,
  volumePayloadOf,
  volumeTargetOf,
} from '../../src/volumes/volume-payload.ts';
import {cloneSourceOf} from '../../src/volumes/clone-source.ts';
import {uniqueVolumeName} from '../../src/volumes/volume-name.ts';

const CLONE: DevContainerVolume = {
  kind: 'volume',
  repositoryPath: 'https://github.com/o/r',
  volumeName: UNIQUE_VOLUME,
  folder: 'r',
  cloneInfo: {urlToClone: 'https://github.com/o/r', ref: 'main'},
  inspectVolume: false,
  context: 'remote',
};

/** A container as discovery reports it. */
function container(
  identifier: string,
  status: string,
  labels: Record<string, string>,
  created = '2026-11-01T00:00:00Z',
): {
  id: string;
  created: string;
  status: string;
  labels: Record<string, string>;
} {
  return {id: identifier, created, status, labels};
}

describe('the recovery container of a volume (card containers-160, brief-recovery-container §2)', () => {
  it('F-0501 AC-24: the target is the volume named for real, with no clone, to be inspected and marked as the recovery container, on the same engine', () => {
    const name = uniqueVolumeName(
      cloneSourceOf('https://github.com/o/r', 'typed') as never,
    );
    deepStrictEqual(recoveryTargetOf(CLONE, 'typed'), {
      kind: 'volume',
      repositoryPath: 'https://github.com/o/r',
      volumeName: name,
      folder: 'r',
      inspectVolume: true,
      recovery: true,
      context: 'remote',
    });
  });

  it('F-0501 AC-24: a window that already names its volume keeps the name, and a source the clone refuses gives none', () => {
    deepStrictEqual(
      [
        recoveryTargetOf({...CLONE, volumeName: 'named'}, 'typed')?.volumeName,
        recoveryTargetOf({...CLONE, repositoryPath: ' '}, 'typed'),
      ],
      ['named', undefined],
    );
  });

  it('F-0410 BR-7: the synthetic file of a volume lies in the extension’s storage, in a folder of its own below the extension’s version, one for each volume', () => {
    deepStrictEqual(
      [
        recoveryConfigFileOf('/storage', '0.1.0', 'vol-a'),
        recoveryConfigFileOf('/storage', '0.1.0', 'vol-b'),
      ],
      [
        path.join(
          '/storage',
          'recovery-volume',
          '0.1.0',
          'vol-a',
          '.devcontainer.json',
        ),
        path.join(
          '/storage',
          'recovery-volume',
          '0.1.0',
          'vol-b',
          '.devcontainer.json',
        ),
      ],
    );
  });

  it('F-0410 BR-7: the synthetic configuration mounts the volume at /workspaces, works in its folder as root, overrides the command and names no Feature', () => {
    deepStrictEqual(
      JSON.parse(
        recoveryConfigurationOf('remote-oss-bootstrap:1', 'vol-a', 'r'),
      ),
      {
        image: 'remote-oss-bootstrap:1',
        workspaceMount: 'type=volume,source=vol-a,target=/workspaces',
        workspaceFolder: '/workspaces/r',
        remoteUser: 'root',
        overrideCommand: true,
      },
    );
  });

  it('F-0410 BR-7: the labels name the volume and the synthetic file', () => {
    deepStrictEqual(recoveryIdLabels('vol-a', '/tmp/f/.devcontainer.json'), [
      'vsch.local.volume=vol-a',
      'devcontainer.config_file=/tmp/f/.devcontainer.json',
    ]);
  });

  it('F-0410 AC-16b, AC-28, AC-29: a container with both labels is started again whatever its image or state, one with another file or volume is left alone and a new one is made', () => {
    function labels(volume: string, file: string): Record<string, string> {
      return {
        'vsch.local.volume': volume,
        'devcontainer.config_file': file,
      };
    }
    deepStrictEqual(
      [
        recoveryDecisionOf('v', '/a', [
          container('x', 'exited', labels('v', '/a')),
        ]),
        recoveryDecisionOf('v', '/a', [
          container('x', 'running', labels('v', '/a')),
        ]),
        recoveryDecisionOf('v', '/a', [
          container('x', 'exited', labels('v', '/other')),
        ]),
        recoveryDecisionOf('v', '/a', [
          container('x', 'exited', labels('w', '/a')),
        ]),
        recoveryDecisionOf('v', '/a', []),
        recoveryDecisionOf('v', '/a', [
          container('old', 'exited', labels('v', '/a'), '2026-10-01T00:00:00Z'),
          container('new', 'exited', labels('v', '/a'), '2026-11-01T00:00:00Z'),
        ]),
      ].map(decision =>
        decision.kind === 'use'
          ? [decision.kind, decision.containerId]
          : [decision.kind],
      ),
      [
        ['use', 'x'],
        ['use', 'x'],
        ['create'],
        ['create'],
        ['create'],
        ['use', 'new'],
      ],
    );
  });

  it('F-0410 BR-10: the payload keeps the recovery member through a reload, and a payload without it, or with another value, is the plain volume', () => {
    const recovery = recoveryTargetOf(CLONE, 'typed');
    if (recovery === undefined) {
      throw new Error('the clone has a recovery target');
    }
    const read = volumeTargetOf(volumePayloadOf(recovery));
    const plain = volumeTargetOf(volumePayloadOf({...CLONE, volumeName: 'v'}));
    const malformed = volumeTargetOf(
      Buffer.from(
        JSON.stringify({
          repositoryPath: 'x',
          volumeName: 'v',
          folder: 'r',
          inspectVolume: true,
          recovery: 'yes',
        }),
        'utf8',
      ).toString('hex'),
    );
    deepStrictEqual(
      [read?.recovery, read?.inspectVolume, plain?.recovery, malformed],
      [true, true, undefined, undefined],
    );
  });
});
