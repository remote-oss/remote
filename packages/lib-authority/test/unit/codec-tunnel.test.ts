import {deepStrictEqual, strictEqual} from 'node:assert';
import {decodeAuthority, tunnelCodec} from '../../src/index.ts';

describe('tunnel codec (card authority-01 table)', () => {
  it("decodeAuthority('tunnel+mytunnel') -> tunnelName mytunnel, and with a distro -> mytunnel/Ubuntu", () => {
    deepStrictEqual(
      [
        decodeAuthority('tunnel+mytunnel'),
        decodeAuthority('tunnel+mytunnel/Ubuntu'),
      ],
      [
        {
          family: 'tunnel',
          target: {tunnelName: 'mytunnel'},
          rawHostString: 'mytunnel',
        },
        {
          family: 'tunnel',
          target: {tunnelName: 'mytunnel', distro: 'Ubuntu'},
          rawHostString: 'mytunnel/Ubuntu',
        },
      ],
    );
  });

  it("decodeAuthority('tunnel+') -> malformed empty", () => {
    deepStrictEqual(decodeAuthority('tunnel+'), {
      malformed: {family: 'tunnel', payload: '', reason: 'empty'},
    });
  });

  it('encode of a tunnel target -> the name, or the name and the distro', () => {
    deepStrictEqual(
      [
        tunnelCodec.encode({tunnelName: 'mytunnel'}),
        tunnelCodec.encode({tunnelName: 'mytunnel', distro: 'Ubuntu'}),
      ],
      ['mytunnel', 'mytunnel/Ubuntu'],
    );
  });

  it('label of a tunnel target -> the tunnel name', () => {
    strictEqual(
      tunnelCodec.label({tunnelName: 'mytunnel', distro: 'Ubuntu'}),
      'mytunnel',
    );
  });
});
