import {deepStrictEqual, strictEqual} from 'node:assert';
import {
  containerCodec,
  decodeAuthority,
  encodeAuthority,
  type ContainerFamily,
  type ContainerTarget,
} from '../../src/index.ts';

const FAMILIES = [
  'dev-container',
  'attached-container',
  'k8s-container',
  'apple-container',
  'exec',
] as const satisfies readonly ContainerFamily[];

/** The authority's re-encode, naming the refusal instead of throwing. */
function encoded(authority: string): string {
  const outcome = decodeAuthority(authority);
  return 'malformed' in outcome
    ? `malformed:${outcome.malformed.reason}`
    : encodeAuthority(outcome);
}

describe('container codecs (card authority-01 table)', () => {
  it("decodeAuthority('dev-container+abcd@ssh-remote+h') -> payload abcd with the outer hop", () => {
    deepStrictEqual(decodeAuthority('dev-container+abcd@ssh-remote+h'), {
      family: 'dev-container',
      target: {
        payload: 'abcd',
        outer: {
          family: 'ssh-remote',
          target: {kind: 'host', hostName: 'h'},
          rawHostString: 'h',
        },
      },
      rawHostString: 'abcd@ssh-remote+h',
    });
  });

  it("decodeAuthority('attached-container+abcd') -> payload abcd without an outer", () => {
    deepStrictEqual(decodeAuthority('attached-container+abcd'), {
      family: 'attached-container',
      target: {payload: 'abcd'},
      rawHostString: 'abcd',
    });
  });

  it('each of the five container families -> containerCodec(f).decode works and the registry dispatches to it', () => {
    const decodes = FAMILIES.map(family =>
      containerCodec(family).decode('abcd@ssh-remote+h'),
    );
    deepStrictEqual(
      [
        decodes.every(outcome => 'target' in outcome),
        FAMILIES.map(family => decodeAuthority(`${family}+abcd`)),
      ],
      [
        true,
        FAMILIES.map(family => ({
          family,
          target: {payload: 'abcd'},
          rawHostString: 'abcd',
        })),
      ],
    );
  });

  it('label of a container target -> the payload text exactly as written', () => {
    const container = containerCodec('k8s-container');
    strictEqual(
      container.label({payload: 'abcd@ssh-remote+h'}),
      'abcd@ssh-remote+h',
    );
  });

  it('encode of a container target with an outer -> payload plus the outer authority', () => {
    const container = containerCodec('apple-container');
    const target: ContainerTarget = {
      payload: 'abcd',
      outer: {
        family: 'ssh-remote',
        target: {kind: 'host', hostName: 'h'},
        rawHostString: 'h',
      },
    };
    deepStrictEqual(
      [container.encode(target), encoded('apple-container+abcd@ssh-remote+h')],
      ['abcd@ssh-remote+h', 'apple-container+abcd@ssh-remote+h'],
    );
  });

  it('decode of a container payload with an unknown outer family -> malformed badOuter of that family', () => {
    const container = containerCodec('exec');
    deepStrictEqual(container.decode('abcd@nope+x'), {
      malformed: {family: 'exec', payload: 'abcd@nope+x', reason: 'badOuter'},
    });
  });
});
