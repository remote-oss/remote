import {deepStrictEqual, strictEqual} from 'node:assert';
import {decodeAuthority, tunnelCodec} from '../../src/index.ts';

describe('tunnel codec (F-8103 AC-10, AC-15, AC-28; ruling-3344-tunnel-authority)', () => {
  it("decodeAuthority('tunnel+mytunnel') -> tunnelName mytunnel", () => {
    deepStrictEqual(decodeAuthority('tunnel+mytunnel'), {
      family: 'tunnel',
      target: {tunnelName: 'mytunnel'},
      rawHostString: 'mytunnel',
    });
  });

  it('F-8103 AC-28: a name holding : @ / or %2B, or 100 characters, is taken whole as the name', () => {
    const long = 'n'.repeat(100);
    deepStrictEqual(
      ['a:b', 'a@b', 'a/b', 'a%2Bb', long].map(name =>
        decodeAuthority(`tunnel+${name}`),
      ),
      ['a:b', 'a@b', 'a/b', 'a%2Bb', long].map(name => ({
        family: 'tunnel',
        target: {tunnelName: name},
        rawHostString: name,
      })),
    );
  });

  it("F-8103 AC-15: decodeAuthority('tunnel+') -> malformed empty", () => {
    deepStrictEqual(decodeAuthority('tunnel+'), {
      malformed: {family: 'tunnel', payload: '', reason: 'empty'},
    });
  });

  it('F-8103 AC-10, AC-28: a + anywhere in the payload (a+b, a+, +a) -> malformed plus', () => {
    deepStrictEqual(
      ['a+b', 'a+', '+a', '+'].map(payload =>
        decodeAuthority(`tunnel+${payload}`),
      ),
      ['a+b', 'a+', '+a', '+'].map(payload => ({
        malformed: {family: 'tunnel', payload, reason: 'plus'},
      })),
    );
  });

  it('encode of a tunnel target -> its name', () => {
    strictEqual(tunnelCodec.encode({tunnelName: 'my/tunnel'}), 'my/tunnel');
  });

  it('label of a tunnel target -> the tunnel name', () => {
    strictEqual(tunnelCodec.label({tunnelName: 'mytunnel'}), 'mytunnel');
  });
});
