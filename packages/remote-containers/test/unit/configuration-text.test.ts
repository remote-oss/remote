import {deepStrictEqual} from 'node:assert';
import {
  decodeConfiguration,
  hasContainerSource,
  labelOf,
  parseConfiguration,
} from '../../src/config/configuration-text.ts';

const TEXT = '{"name":"N"}';

function utf16Little(text: string): Uint8Array {
  return Uint8Array.from([0xff, 0xfe, ...Buffer.from(text, 'utf16le')]);
}

function utf16Big(text: string): Uint8Array {
  const little = Buffer.from(text, 'utf16le');
  const bigEndian = Buffer.alloc(little.length);
  for (let index = 0; index < little.length; index += 2) {
    bigEndian[index] = little[index + 1] ?? 0;
    bigEndian[index + 1] = little[index] ?? 0;
  }
  return Uint8Array.from([0xfe, 0xff, ...bigEndian]);
}

function translate(template: string): string {
  return template;
}

describe('the text of a configuration (card containers-13)', () => {
  it('F-0301 AC-39: UTF-8, with or without a mark, and UTF-16 of either order with a mark, decode to the same text', () => {
    deepStrictEqual(
      [
        Buffer.from(TEXT),
        Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from(TEXT)]),
        utf16Little(TEXT),
        utf16Big(TEXT),
      ].map(decodeConfiguration),
      [TEXT, TEXT, TEXT, TEXT],
    );
  });

  it('F-0301 BR-14: a UTF-16 text of an odd number of bytes loses its last byte and decodes', () => {
    deepStrictEqual(
      decodeConfiguration(
        Uint8Array.from([0xfe, 0xff, 0x00, 0x7b, 0x00, 0x7d, 0x00]),
      ),
      '{}',
    );
  });

  it('F-0301 AC-26: a comment and a trailing comma are read', () => {
    deepStrictEqual(
      parseConfiguration('{\n  // a note\n  "name": "N",\n  "image": "i",\n}'),
      {name: 'N', image: 'i'},
    );
  });

  it('F-0301 AC-31: a configuration with no closing brace gives its members', () => {
    deepStrictEqual(parseConfiguration('{"name":"Delta","image":"img"'), {
      name: 'Delta',
      image: 'img',
    });
  });

  it('F-0301 AC-30: a configuration cut after "image": gives its name', () => {
    deepStrictEqual(
      parseConfiguration('{ "name": "Gamma", "image": ')?.name,
      'Gamma',
    );
  });

  it('F-0301 7.E1: no text, blank text, an array, a number and null give no object', () => {
    deepStrictEqual(['', '   ', '[1]', '42', 'null'].map(parseConfiguration), [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('F-0301 AC-4, AC-47: with no name a place is labelled by its own fallback', () => {
    deepStrictEqual(
      (
        [
          {kind: 'dotfile'},
          {kind: 'main'},
          {kind: 'subfolder', name: 'a'},
        ] as const
      ).map(place => labelOf(place, {}, translate)),
      ['Project Root', 'Main', 'a'],
    );
  });

  it('F-0301 AC-76: an empty name takes the fallback, and a name that is not a text does too', () => {
    deepStrictEqual(
      [{name: ''}, {name: 5}, undefined].map(parsed =>
        labelOf({kind: 'subfolder', name: 'e'}, parsed, translate),
      ),
      ['e', 'e', 'e'],
    );
  });

  it('F-0301 AC-25: a name is kept as written, with its unsubstituted variables', () => {
    deepStrictEqual(
      labelOf({kind: 'main'}, {name: 'Config-${localEnv:USER}-A'}, translate),
      'Config-${localEnv:USER}-A',
    );
  });

  it('F-0301 7.E2: an image, a Dockerfile, a Compose file or a build Dockerfile is a container source', () => {
    deepStrictEqual(
      [
        {image: 'i'},
        {dockerFile: 'D'},
        {dockerComposeFile: 'c.yml'},
        {build: {dockerfile: 'D'}},
        {image: 42},
      ].map(hasContainerSource),
      [true, true, true, true, true],
    );
  });

  it('F-0301 AC-10: a configuration with only a name, an empty build or a build that is not an object has none', () => {
    deepStrictEqual(
      [
        {name: 'x'},
        {build: {}},
        {build: 'D'},
        {build: null},
        {build: ['D']},
      ].map(hasContainerSource),
      [false, false, false, false, false],
    );
  });
});
