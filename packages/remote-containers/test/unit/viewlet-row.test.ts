import {deepStrictEqual} from 'node:assert';
import {
  viewletContainerOf,
  viewletVolumeOf,
} from '../../src/explorer/viewlet-row.ts';

describe('the row a view of another extension hands a row command (card containers-199)', () => {
  it('F-0603 BR-5 (a): an element with the id of a container, or the name of a volume, is a row', () => {
    deepStrictEqual(
      [
        viewletContainerOf({containerId: 'a1b2c3d4e5f6'}),
        viewletContainerOf({containerId: 'web_1.x-y', other: 5}),
        viewletVolumeOf({volumeName: 'data-1'}),
      ],
      ['a1b2c3d4e5f6', 'web_1.x-y', 'data-1'],
    );
  });

  it('F-0603 BR-5 (b): no argument, a text, a handle, an element without the member or with a value Docker would not take is no row', () => {
    deepStrictEqual(
      [
        undefined,
        null,
        'a1b2c3',
        {},
        {containerId: 7},
        {containerId: ''},
        {containerId: '-v'},
        {containerId: 'a,b'},
        {containerId: '${localEnv:HOME}'},
        {containerId: 'a b'},
      ].map(viewletContainerOf),
      Array.from({length: 10}, () => undefined),
    );
  });

  it('F-0603 BR-5 (b): a volume row is read by its own member, and a container’s element is no volume', () => {
    deepStrictEqual(
      [
        viewletVolumeOf({containerId: 'abc'}),
        viewletVolumeOf({volumeName: 'a,b'}),
        viewletContainerOf({volumeName: 'data'}),
      ],
      [undefined, undefined, undefined],
    );
  });
});
