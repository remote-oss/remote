import {deepStrictEqual} from 'node:assert';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {
  ACKNOWLEDGMENT_KEY,
  readAcknowledgment,
  writeAcknowledgment,
} from '../../src/config-watch/acknowledgment.ts';
import {
  bytesFingerprint,
  compactJsonOf,
  configurationFingerprint,
} from '../../src/config-watch/fingerprint.ts';
import {watchedFilesOf} from '../../src/config-watch/watched-files.ts';

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function hashOf(text: string): string {
  return configurationFingerprint(bytesOf(text));
}

describe('the fingerprints of the files a container is built from (card containers-141)', () => {
  it('F-0303 AC-23: comments, blank lines, spaces and a missing final brace give the same fingerprint', () => {
    const plain = hashOf('{"image":"a","containerEnv":{"X":"1"}}');
    deepStrictEqual(
      [
        '{\n  // a comment\n  "image": "a",\n\n  /* more */ "containerEnv": { "X": "1" }\n}\n',
        '{"image":"a","containerEnv":{"X":"1"}',
        '{"image":"a","containerEnv":{"X":"1"},}',
      ].map(hashOf),
      [plain, plain, plain],
    );
  });

  it('F-0303 AC-23: a reordered key, a changed value, and a changed value with the brace missing each give another fingerprint', () => {
    const plain = hashOf('{"image":"a","name":"n"}');
    deepStrictEqual(
      [
        '{"name":"n","image":"a"}',
        '{"image":"b","name":"n"}',
        '{"image":"b","name":"n"',
      ].map(text => hashOf(text) === plain),
      [false, false, false],
    );
  });

  it('F-0303 BR-13: the compact JSON keeps the file’s order, even for integer-like keys, and has no spaces', () => {
    deepStrictEqual(
      compactJsonOf('{"b":1,"8080":2,"a":[1, "x"]}'),
      '{"b":1,"8080":2,"a":[1,"x"]}',
    );
  });

  it('F-0303 BR-13: values of every kind are written as JSON', () => {
    deepStrictEqual(
      compactJsonOf('{"a":true,"b":null,"c":1.5,"d":"q\\"","e":{},"f":[]}'),
      '{"a":true,"b":null,"c":1.5,"d":"q\\"","e":{},"f":[]}',
    );
  });

  it('F-0303 AC-14: a property that has no value yet is left out', () => {
    deepStrictEqual(compactJsonOf('{"a":1,"b":'), '{"a":1}');
  });

  it('F-0303 BR-13: a key that appears twice keeps its first place and its last value', () => {
    deepStrictEqual(compactJsonOf('{"a":1,"b":2,"a":3}'), '{"a":3,"b":2}');
  });

  it('F-0303 BR-13: a text that is not JSON at all hashes the empty string', () => {
    deepStrictEqual(
      [compactJsonOf(''), hashOf('')],
      ['', createHash('sha256').update('').digest('hex')],
    );
  });

  it('F-0303 BR-13: a byte-order mark of UTF-8 does not count', () => {
    deepStrictEqual(
      configurationFingerprint(
        Uint8Array.from([0xef, 0xbb, 0xbf, ...bytesOf('{"a":1}')]),
      ),
      hashOf('{"a":1}'),
    );
  });

  it('F-0303 AC-24: a Dockerfile’s fingerprint counts a comment line and blank lines', () => {
    deepStrictEqual(
      bytesFingerprint(bytesOf('FROM a\n')) ===
        bytesFingerprint(bytesOf('FROM a\n# c\n\n')),
      false,
    );
  });

  it('F-0303 BR-13: the fingerprint of the bytes abc is the known SHA-256', () => {
    deepStrictEqual(
      bytesFingerprint(bytesOf('abc')),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

/** A memento that holds one value under any key. */
function mementoOf(stored?: unknown) {
  const writes: unknown[] = [];
  return {
    writes,
    get: (key: string) => (key === ACKNOWLEDGMENT_KEY ? stored : undefined),
    update: (key: string, value: unknown) => {
      writes.push([key, value]);
      return Promise.resolve();
    },
  };
}

describe('the acknowledgment of the configuration files (card containers-141)', () => {
  it('F-0303 §9: the observed shape is read as a map of identifiers to fingerprints', () => {
    deepStrictEqual(
      readAcknowledgment(
        mementoOf({
          configurationState: {
            contentHashes: {'devcontainer.json': 'h1', Dockerfile: 'h2'},
          },
        }),
      ),
      new Map([
        ['devcontainer.json', 'h1'],
        ['Dockerfile', 'h2'],
      ]),
    );
  });

  for (const [name, stored] of [
    ['nothing stored', undefined],
    ['a value that is not an object', 'x'],
    ['an array', []],
    ['no configurationState', {}],
    ['a configurationState that is not an object', {configurationState: 5}],
    ['no contentHashes', {configurationState: {}}],
    [
      'contentHashes that is not an object',
      {configurationState: {contentHashes: 1}},
    ],
    ['an empty contentHashes', {configurationState: {contentHashes: {}}}],
    [
      'no string entry',
      {configurationState: {contentHashes: {first: 1, second: null}}},
    ],
  ] as const) {
    it(`F-0303 BR-9a: ${name} reads as nothing stored`, () => {
      deepStrictEqual(readAcknowledgment(mementoOf(stored)), undefined);
    });
  }

  it('F-0303 §9: entries that are not strings are dropped', () => {
    deepStrictEqual(
      readAcknowledgment(
        mementoOf({
          configurationState: {contentHashes: {first: 'h', second: 1}},
        }),
      ),
      new Map([['first', 'h']]),
    );
  });

  it('F-0303 §9: the write gives exactly the observed shape', async () => {
    const memento = mementoOf();
    await writeAcknowledgment(memento, new Map([['devcontainer.json', 'h']]));
    deepStrictEqual(memento.writes, [
      [
        ACKNOWLEDGMENT_KEY,
        {configurationState: {contentHashes: {'devcontainer.json': 'h'}}},
      ],
    ]);
  });
});

describe('the files a configuration is watched with (card containers-141)', () => {
  const FILE = '/w/.devcontainer/devcontainer.json';

  it('F-0303 BR-2: an image configuration watches only itself', () => {
    deepStrictEqual(
      [...watchedFilesOf({image: 'x'}, FILE)],
      [['devcontainer.json', FILE]],
    );
  });

  it('F-0303 AC-25, BR-2: build.dockerfile beats dockerFile, and the legacy dockerFile alone is watched', () => {
    deepStrictEqual(
      [
        [
          ...watchedFilesOf(
            {build: {dockerfile: 'A'}, dockerFile: 'B'},
            FILE,
          ).keys(),
        ],
        [...watchedFilesOf({dockerFile: 'B'}, FILE).keys()],
      ],
      [
        ['devcontainer.json', 'A'],
        ['devcontainer.json', 'B'],
      ],
    );
  });

  it('F-0303 AC-17: a Dockerfile outside the folder is named verbatim, with its resolved path', () => {
    deepStrictEqual(
      [...watchedFilesOf({build: {dockerfile: '../OutsideDockerfile'}}, FILE)],
      [
        ['devcontainer.json', FILE],
        ['../OutsideDockerfile', '/w/OutsideDockerfile'],
      ],
    );
  });

  it('F-0303 AC-28: a root .devcontainer.json is named with its leading dot', () => {
    deepStrictEqual(
      [...watchedFilesOf({}, '/w/.devcontainer.json').keys()],
      ['.devcontainer.json'],
    );
  });

  it('F-0303 BR-2: an empty value, a value with a variable and a value that is not a string watch no Dockerfile', () => {
    deepStrictEqual(
      [
        {dockerFile: ''},
        {dockerFile: '${localWorkspaceFolder}/D'},
        {dockerFile: 5},
        undefined,
      ].map(each => [...watchedFilesOf(each, FILE).keys()]),
      Array.from({length: 4}, () => ['devcontainer.json']),
    );
  });

  it('F-0303 BR-2, AC-6: the compose files are watched by their values as written, and the service’s Dockerfile by its path from the configuration’s folder', () => {
    deepStrictEqual(
      [
        {dockerComposeFile: 'compose.yml'},
        {dockerComposeFile: ['a.yml', '../b.yml']},
        {dockerComposeFile: ['', '${localEnv:X}.yml', 'c.yml']},
        {dockerComposeFile: 3},
      ].map(each => [...watchedFilesOf(each, FILE).keys()]),
      [
        ['devcontainer.json', 'compose.yml'],
        ['devcontainer.json', 'a.yml', '../b.yml'],
        ['devcontainer.json', 'c.yml'],
        ['devcontainer.json'],
      ],
    );
  });

  it('F-0303 AC-26, AC-27: a service’s Dockerfile is named by its path from the configuration’s folder, inside it, beside it and above it', () => {
    deepStrictEqual(
      ['sub/Df.dev', 'Df.app', '../Df.root'].map(
        name =>
          [
            ...watchedFilesOf(
              {},
              FILE,
              path.resolve(path.dirname(FILE), name),
            ).keys(),
          ][1],
      ),
      ['sub/Df.dev', 'Df.app', '../Df.root'],
    );
  });
});
