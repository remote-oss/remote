import {deepStrictEqual} from 'node:assert';
import {devContainerTargetOf} from '../../src/authority/payload.ts';
import {
  type DevContainerVolume,
  UNIQUE_VOLUME,
  volumePayloadOf,
  volumeTargetOf,
} from '../../src/volumes/volume-payload.ts';

/** The JSON text a payload holds. */
function textOf(payload: string): string {
  return Buffer.from(payload, 'hex').toString('utf8');
}

/** The hex of a JSON value, as a payload. */
function hexOf(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('hex');
}

const CLONE: DevContainerVolume = {
  kind: 'volume',
  repositoryPath: 'https://github.com/o/r/tree/main',
  volumeName: UNIQUE_VOLUME,
  folder: 'r',
  cloneInfo: {urlToClone: 'https://github.com/o/r', ref: 'main'},
  inspectVolume: false,
};

describe('the volume payload (card containers-151)', () => {
  it('F-0701 BR-12: the members are the clone request’s, in a fixed order, and a unique volume is __UNIQUE__', () => {
    deepStrictEqual(
      textOf(volumePayloadOf(CLONE)),
      '{"repositoryPath":"https://github.com/o/r/tree/main","volumeName":"__UNIQUE__","folder":"r","cloneInfo":{"urlToClone":"https://github.com/o/r","ref":"main"},"inspectVolume":false}',
    );
  });

  it('F-0205 BR-19: a pinned engine joins as settings, and the payload reads back to the same target', () => {
    const pinned: DevContainerVolume = {...CLONE, context: 'ctx1'};
    deepStrictEqual(
      [
        textOf(volumePayloadOf(pinned)).endsWith(
          ',"settings":{"context":"ctx1"}}',
        ),
        volumeTargetOf(volumePayloadOf(pinned)),
        volumeTargetOf(volumePayloadOf(CLONE)),
      ],
      [true, pinned, CLONE],
    );
  });

  it('an explored volume carries no clone request', () => {
    const explored: DevContainerVolume = {
      kind: 'volume',
      repositoryPath: '',
      volumeName: 'data',
      folder: '',
      inspectVolume: true,
    };
    deepStrictEqual(volumeTargetOf(volumePayloadOf(explored)), explored);
  });

  it('a payload of another shape or a member of the wrong type is no volume target', () => {
    deepStrictEqual(
      [
        'zz',
        hexOf('x').slice(0, 3),
        Buffer.from('{', 'utf8').toString('hex'),
        hexOf({hostPath: '/w', localDocker: false}),
        hexOf({...CLONE, volumeName: ''}),
        hexOf({...CLONE, folder: 1}),
        hexOf({...CLONE, inspectVolume: 'no'}),
        hexOf({...CLONE, cloneInfo: {urlToClone: ''}}),
        hexOf({...CLONE, cloneInfo: {urlToClone: 'u', ref: 2}}),
        hexOf({...CLONE, settings: {context: ''}}),
        hexOf({...CLONE, settings: 'x'}),
      ].map(volumeTargetOf),
      Array.from({length: 11}, () => undefined),
    );
  });

  it('the folder payload’s reader still refuses a volume payload by its shape', () => {
    deepStrictEqual(devContainerTargetOf(volumePayloadOf(CLONE)), {
      malformed: 'shape',
    });
  });
});
