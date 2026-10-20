import {deepStrictEqual} from 'node:assert';
import {
  metadataArguments,
  recordedMetadataOf,
} from '../../src/shutdown/recorded-metadata.ts';

describe('the metadata label of a container (card containers-69)', () => {
  it('F-0417 BR-2: the inspect prints the one label of the container and nothing else', () => {
    deepStrictEqual(metadataArguments('c0ffee'), [
      'inspect',
      '--type',
      'container',
      '--format',
      '{{index .Config.Labels "devcontainer.metadata"}}',
      'c0ffee',
    ]);
  });

  it('F-0417 BR-2: the entries are the list the label holds, in order', () => {
    deepStrictEqual(
      recordedMetadataOf('[{"id":"base"},{"shutdownAction":"none"}]\n'),
      [{id: 'base'}, {shutdownAction: 'none'}],
    );
  });

  it('F-0417 AC-69: no label, a label that is not JSON and one that is not a list are no recorded entries', () => {
    deepStrictEqual(
      ['', ' \n', 'not json', '{"shutdownAction":"none"}', '"none"'].map(text =>
        recordedMetadataOf(text),
      ),
      [undefined, undefined, undefined, undefined, undefined],
    );
  });
});
